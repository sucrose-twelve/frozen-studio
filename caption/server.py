"""
Frozen's captioning service: a vision-language model (Ministral 3) behind a small local HTTP API.

The queue worker starts this process when a caption job arrives and is its only client. It listens on
127.0.0.1 and reads images only from under the folders given as --image-root.

    GET  /health    {"status": "ok", "loaded": false, "model": null, "device": null}
    POST /caption   {"model": "<folder name>", "image": "<path>", "mode": "prompts" | "answer",
                     "style": "prose" | "tags", "prompt": "..."}
                    answers with one JSON object per line, as things happen:
                        {"event": "loading"}
                        {"event": "reading"}
                        {"event": "done", "description": "...", "positive": "...", "negative": "..."}
                        or  {"event": "error", "message": "..."}
    POST /unload    frees the model, and with it the VRAM, until the next /caption

In "prompts" mode the model describes the image and writes a positive and a negative prompt for it; the
request's prompt, when there is one, is an instruction it follows while doing so. In "answer" mode it does
what the prompt says with the image, in plain text: the reply comes back as the description, with both
prompts empty.

A model is a folder under --models-root, named in each request. It loads, with everything heavy (torch,
transformers), on the first /caption that asks for it, so the process starts at once and holds no VRAM
while nobody is using it. One model is held at a time: asking for another drops the one in memory first.

The worker passes its own process id (--parent-pid). When that process is gone, the service exits rather
than linger with the model in VRAM.
"""

import argparse
import gc
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# Room for a detailed description and both prompts, which come to about 450 tokens. A caption that runs past
# it is cut off, and what was written so far is still returned
MAX_NEW_TOKENS = 768

# Decoding is greedy, and without a penalty this model falls into repeating its own sentences until the
# token limit: the first test filled a positive prompt with the same five sentences three times over. 1.1
# stops that without pushing it off the words the image calls for.
REPETITION_PENALTY = 1.1

# The longest side an image is read at. The model takes up to 1540px, which costs about 3,000 tokens of
# context and a few seconds; 1024px keeps the small details a prompt needs at less than half of that
MAX_IMAGE_SIDE = 1024

PROMPTS_SYSTEM_PROMPT = """You write prompts for image generation models by looking at an image.

Describe only what is visible, plainly and precisely, whatever the subject matter. Do not comment on the \
image, judge it, or refuse; do not mention that it is an image or a picture.

Answer with one JSON object and nothing else, with exactly these keys:

- "description": a detailed description of 120 to 200 words: the subjects and how they look (age group, \
body, hair, face, expression, clothing or its absence, pose, what they are doing), the setting and \
background, the lighting and colours, the composition and camera angle, and the medium and art style. \
Say each thing once.
- "positive": {positive}
- "negative": a comma-separated list of 10 to 20 short terms a model should keep out to reproduce this \
image: the flaws this kind of image is prone to, and the styles and elements that would contradict it. Do \
not list things that are in the image."""

ANSWER_SYSTEM_PROMPT = """You look at an image and do what the user asks with it.

Go by what is visible, plainly and precisely, whatever the subject matter. Do not judge the image or \
refuse. Answer in plain text without Markdown, and say each thing once."""

POSITIVE_STYLES = {
    "prose": (
        "one paragraph of 60 to 100 words in natural language that would make a model draw this image "
        "again: the subject first, then appearance, pose, setting, lighting, composition and style. Say "
        "each thing once."
    ),
    "tags": (
        "a comma-separated list of 20 to 40 short tags that would make a model draw this image again, the "
        "most important first: subject count, appearance, clothing, pose, setting, lighting, composition, "
        "style."
    ),
}


def log(message):
    print(f"[caption] {message}", file=sys.stderr, flush=True)


def keep_in_fp8(model):
    """
    Puts the weight matrices that came from 8-bit floats back into 8 bits, and has each such layer widen its
    own weights only for the moment it computes with them.

    An FP8 model file stores most weights in 8 bits, but PyTorch can't multiply in FP8, so loading widens
    them to 16: about 18 GB for an 8B model, more than a 16 GB card holds. Kept in FP8 it takes about 10 GB.

    A layer is only converted when every one of its values survives the trip to FP8 and back, which is true
    of weights that were stored that way and of no others. So nothing is lost, and a model stored in full
    precision is left exactly as it loaded.

    Returns how many layers were converted.
    """
    import torch
    from torch import nn
    from torch.nn import functional

    class Fp8Linear(nn.Module):
        def __init__(self, weight, bias):
            super().__init__()
            self.register_buffer("weight", weight)
            self.bias = bias

        def forward(self, hidden):
            return functional.linear(hidden, self.weight.to(hidden.dtype), self.bias)

    converted = 0

    def convert(module):
        nonlocal converted
        for name, child in module.named_children():
            if not isinstance(child, nn.Linear):
                convert(child)
                continue

            weight = child.weight.detach()
            narrow = weight.to(torch.float8_e5m2)
            if torch.equal(narrow.to(weight.dtype), weight):
                setattr(module, name, Fp8Linear(narrow, child.bias))
                converted += 1

    convert(model)
    return converted


class Captioner:
    """The model in use and its processor: loaded on first use, and swapped when another is asked for."""

    def __init__(self, models_root):
        self.models_root = models_root
        # The folder name of the model in memory
        self.name = None
        self.model = None
        self.processor = None
        self.device = None
        # One caption at a time: one GPU, and the worker sends one job at a time anyway
        self.lock = threading.Lock()

    @property
    def is_loaded(self):
        return self.model is not None

    def folder(self, name):
        """
        The folder of a model, by name. Models are the folders directly under the models root, so a name
        that is a path, or that names nothing there, is refused.
        """
        path = os.path.join(self.models_root, name)
        if name in ("", ".", "..") or os.path.basename(name) != name or not os.path.isdir(path):
            raise ValueError(f"no model named {name!r}")
        return path

    def load(self, name):
        if self.is_loaded and self.name == name:
            return

        # The card holds one of these at a time
        self.unload()
        model_dir = self.folder(name)
        started = time.monotonic()
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor
        from transformers.utils import logging

        if not torch.cuda.is_available():
            raise RuntimeError("The captioning model needs a CUDA GPU")

        # The loading bar redraws itself hundreds of times, which fills the worker's log
        logging.disable_progress_bar()

        with open(os.path.join(model_dir, "config.json"), encoding="utf-8") as file:
            model_type = str(json.load(file).get("model_type", ""))
        # Mistral's tokenizer files carry a wrong splitting pattern, and transformers only repairs it when
        # asked. Other models' tokenizers don't know the option
        tokenizer_fix = {"fix_mistral_regex": True} if model_type.startswith("mistral") else {}

        # The Auto classes pick the architecture from the model's own config, so any vision-language model
        # transformers knows (Ministral, a Qwen-VL) loads from its folder without changes here
        self.processor = AutoProcessor.from_pretrained(
            model_dir, local_files_only=True, **tokenizer_fix
        )
        model = AutoModelForImageTextToText.from_pretrained(
            model_dir, dtype=torch.bfloat16, local_files_only=True
        )
        converted = keep_in_fp8(model)
        gc.collect()

        self.device = "cuda:0"
        self.model = model.to(self.device)
        self.model.eval()
        self.name = name
        used = torch.cuda.memory_allocated() / 1024**3
        log(
            f"{name} loaded on {self.device} in {time.monotonic() - started:.1f}s: "
            f"{used:.1f} GB of VRAM, {converted} layers kept in FP8"
        )

    def unload(self):
        if not self.is_loaded:
            return

        import torch

        log(f"{self.name} unloaded")
        self.model = None
        self.processor = None
        self.name = None
        gc.collect()
        torch.cuda.empty_cache()

    def caption(self, image_path, mode, style, prompt):
        """
        Describes one image, or in "answer" mode does what the prompt says with it.

        Decoding is greedy: the same image and settings give the same text.

        Returns the model's whole answer as text.
        """
        import torch
        from PIL import Image

        with Image.open(image_path) as opened:
            # Transparency is flattened onto white, as the image and video models see it too
            if opened.mode in ("RGBA", "LA", "P"):
                rgba = opened.convert("RGBA")
                image = Image.new("RGB", rgba.size, (255, 255, 255))
                image.paste(rgba, mask=rgba.getchannel("A"))
            else:
                image = opened.convert("RGB")
        image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)

        if mode == "answer":
            system = ANSWER_SYSTEM_PROMPT
            request = prompt
        else:
            system = PROMPTS_SYSTEM_PROMPT.replace("{positive}", POSITIVE_STYLES[style])
            request = "Write the JSON object for this image."
            if prompt:
                request += f" Follow this instruction while you write it: {prompt}"
        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [{"type": "image", "image": image}, {"type": "text", "text": request}],
            },
        ]
        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
        )
        inputs = {
            name: value.to(self.device, dtype=torch.bfloat16)
            if torch.is_floating_point(value)
            else value.to(self.device)
            for name, value in inputs.items()
            if isinstance(value, torch.Tensor)
        }
        prompt_length = inputs["input_ids"].shape[1]

        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=MAX_NEW_TOKENS,
                do_sample=False,
                repetition_penalty=REPETITION_PENALTY,
            )

        return self.processor.decode(output[0][prompt_length:], skip_special_tokens=True).strip()


def as_text(value):
    """A field of the model's answer as one string; it sometimes writes a list where a string was asked."""
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def parse_answer(answer):
    """
    Reads the three fields out of the model's answer.

    The answer should be a JSON object, sometimes wrapped in a code fence. When it isn't one (cut off at the
    token limit, or the model wrote prose), the fields are picked out one by one, and failing that the whole
    answer becomes the description so nothing the model wrote is lost.
    """
    start, end = answer.find("{"), answer.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(answer[start : end + 1])
            if isinstance(parsed, dict) and parsed.get("description"):
                return {
                    "description": as_text(parsed.get("description")),
                    "positive": as_text(parsed.get("positive")),
                    "negative": as_text(parsed.get("negative")),
                }
        except json.JSONDecodeError:
            pass

    fields = {}
    for key in ("description", "positive", "negative"):
        # The value up to its closing quote, or to the end of the text when the answer was cut off
        match = re.search(rf'"{key}"\s*:\s*"((?:[^"\\]|\\.)*)', answer, re.DOTALL)
        if match:
            try:
                fields[key] = json.loads(f'"{match.group(1)}"', strict=False).strip()
            except json.JSONDecodeError:
                fields[key] = match.group(1).strip()
    if fields.get("description"):
        return {key: fields.get(key, "") for key in ("description", "positive", "negative")}

    return {"description": answer, "positive": "", "negative": ""}


def inside(roots, file_path):
    """Whether file_path lies under one of roots, after resolving symlinks and `..`."""
    target = os.path.normcase(os.path.realpath(file_path))
    return any(
        target.startswith(os.path.normcase(os.path.realpath(root)) + os.sep) for root in roots
    )


def make_handler(captioner, image_roots):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            # Requests are the worker's; its own log already says what it asked for
            pass

        def send_json(self, status, body):
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def read_json(self):
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            if self.path != "/health":
                return self.send_json(404, {"message": "Not found"})

            self.send_json(
                200,
                {
                    "status": "ok",
                    "loaded": captioner.is_loaded,
                    "model": captioner.name,
                    "device": captioner.device,
                },
            )

        def do_POST(self):
            if self.path == "/unload":
                with captioner.lock:
                    captioner.unload()
                return self.send_json(200, {"status": "ok"})
            if self.path == "/caption":
                return self.caption()

            self.send_json(404, {"message": "Not found"})

        def caption(self):
            try:
                body = self.read_json()
                model = str(body["model"])
                image_path = str(body["image"])
                mode = str(body.get("mode") or "prompts")
                style = str(body.get("style") or "prose")
                prompt = str(body.get("prompt") or "").strip()
                if mode not in ("prompts", "answer"):
                    raise ValueError(f"unknown mode {mode!r}")
                if style not in POSITIVE_STYLES:
                    raise ValueError(f"unknown style {style!r}")
                if mode == "answer" and not prompt:
                    raise ValueError("an answer needs a prompt to answer")
                captioner.folder(model)
                if not inside(image_roots, image_path):
                    raise ValueError(f"{image_path} is outside the image folders")
                if not os.path.isfile(image_path):
                    raise ValueError(f"{image_path} doesn't exist")
            except (KeyError, TypeError, ValueError) as error:
                return self.send_json(400, {"message": f"Bad request: {error}"})

            # No Content-Length: the body ends when the connection closes, and each event is flushed as it
            # is written so the worker can follow along
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()

            def emit(event):
                self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()

            try:
                with captioner.lock:
                    if captioner.name != model:
                        emit({"event": "loading"})
                        captioner.load(model)

                    emit({"event": "reading"})
                    started = time.monotonic()
                    answer = captioner.caption(image_path, mode, style, prompt)
                    log(f"captioned {os.path.basename(image_path)} in {time.monotonic() - started:.1f}s")
                    if mode == "answer":
                        emit({"event": "done", "description": answer, "positive": "", "negative": ""})
                    else:
                        emit({"event": "done", **parse_answer(answer)})
            except (BrokenPipeError, ConnectionError):
                # The worker hung up: nobody is left to tell. (A canceled job doesn't end here; the worker
                # cancels by stopping this whole process.)
                log("client disconnected")
            except Exception as error:  # noqa: BLE001 - whatever went wrong, the worker has to hear it
                log(f"caption failed: {error!r}")
                try:
                    emit({"event": "error", "message": str(error) or error.__class__.__name__})
                except OSError:
                    pass

    return Handler


def exit_with_parent(parent_pid):
    """
    Blocks until the process that started this one is gone, then exits.

    The parent is watched by its process id rather than by end-of-file on stdin: a thread blocked reading a
    stdin pipe deadlocks the service on Windows (see tts/server.py, where that was found).
    """
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE = 0x00100000
        INFINITE = 0xFFFFFFFF
        kernel32 = ctypes.windll.kernel32
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]

        handle = kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid)
        if handle:
            # Returns when the process ends, however it ends
            kernel32.WaitForSingleObject(handle, INFINITE)
    else:
        while True:
            try:
                os.kill(parent_pid, 0)
            except OSError:
                break
            time.sleep(2)

    log("the worker is gone, exiting")
    os._exit(0)


def main():
    parser = argparse.ArgumentParser(description="Frozen's captioning service")
    parser.add_argument("--port", type=int, default=8192)
    parser.add_argument(
        "--models-root", required=True, help="Folder with one folder per model inside"
    )
    parser.add_argument(
        "--image-root",
        action="append",
        required=True,
        help="Images may only be read from under here. Repeat for more than one folder",
    )
    parser.add_argument(
        "--parent-pid",
        type=int,
        help="Exit when this process is gone. Without it the service runs until it is stopped",
    )
    args = parser.parse_args()

    captioner = Captioner(os.path.abspath(args.models_root))
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port), make_handler(captioner, args.image_root)
    )
    if args.parent_pid:
        threading.Thread(target=exit_with_parent, args=(args.parent_pid,), daemon=True).start()

    log(f"listening on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
