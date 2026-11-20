"""
Frozen's text-to-speech service: the voice models behind a small local HTTP API.

The queue worker starts this process when a voice job arrives and is its only client. It listens on
127.0.0.1 and writes files only under --output-root.

    GET  /health    {"status": "ok", "loaded": false, "model": null, "device": null}
    POST /generate  {"model": "<folder name>", "engine": "parler", "lines": [{"text": "...", "file": "<path>.wav"}],
                     "description": "...", "seed": 1}
                    answers with one JSON object per line, as things happen:
                        {"event": "loading"}
                        {"event": "line", "index": 0}
                        {"event": "saved", "index": 0, "file": "...", "seconds": 3.2, "sampleRate": 44100}
                        {"event": "done"}  or  {"event": "error", "message": "..."}
    POST /unload    frees the model, and with it the VRAM, until the next /generate

A model is a folder under --models-root, named in each request together with its engine: the family of
model it is, which decides how it is loaded and spoken with (see ENGINES). The families need different
versions of the same libraries, so each Python environment runs its own copy of this service, and only
has the packages of its own engines; the worker knows which one to ask.

A model loads, with everything heavy (torch, transformers), on the first /generate that asks for it, so
the process starts at once and holds no VRAM while nobody is using it. One model is held at a time: asking
for another drops the one in memory first.

The worker passes its own process id (--parent-pid). When that process is gone, the service exits rather
than linger with the model in VRAM.
"""

import argparse
import gc
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# About -1 dBFS: as loud as a clip can go while leaving a little headroom for later processing
TARGET_PEAK = 0.89


def log(message):
    print(f"[tts] {message}", file=sys.stderr, flush=True)


def seed_everything(seed):
    """Makes a generation repeatable: the same seed, text and description give the same clip."""
    import torch

    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


class Engine:
    """
    One family of voice model: how it loads from a folder and speaks a line. `begin` is called once per
    job, before its first line, and `release` when the model is dropped.
    """

    def __init__(self):
        self.model = None
        self.device = None

    def begin(self):
        pass

    def release(self):
        pass


class ParlerEngine(Engine):
    """
    Japanese Parler-TTS. The description is read by a small text encoder that only knows the words of its
    training captions (pitch, pace, expressiveness, recording quality), and the model has one female voice.
    """

    def __init__(self):
        super().__init__()
        self.prompt_tokenizer = None
        self.description_tokenizer = None
        self.tagger = None
        self.kakasi = None

    def load(self, model_dir):
        import torch
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer

        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        # This model has its own tokenizers, one for the spoken text and one for the voice description;
        # the ones Parler-TTS ships with don't fit it
        self.prompt_tokenizer = AutoTokenizer.from_pretrained(
            model_dir, subfolder="prompt_tokenizer", local_files_only=True
        )
        self.description_tokenizer = AutoTokenizer.from_pretrained(
            model_dir, subfolder="description_tokenizer", local_files_only=True
        )
        self.model = ParlerTTSForConditionalGeneration.from_pretrained(
            model_dir, local_files_only=True
        ).to(self.device)
        self.model.eval()

    def add_ruby(self, text):
        """
        Writes the reading after every word that isn't already kana: 石炭 becomes 石炭[せきたん].

        The model was trained on text prepared this way, and without it kanji are often misread. The
        logic follows RubyInserter (https://github.com/getuka/RubyInserter, MIT), the tool the model card
        asks for.
        """
        if self.tagger is None:
            import MeCab
            from pykakasi import kakasi

            self.tagger = MeCab.Tagger()
            self.kakasi = kakasi()

        def hiragana(value):
            return "".join(part["hira"] for part in self.kakasi.convert(value))

        pieces = []
        for line in self.tagger.parse(text).splitlines():
            # Only the lines that describe a word have tabs: surface, pronunciation, reading, lemma, …
            if "\t" not in line:
                continue

            parts = line.split("\t")
            surface = parts[0]
            if parts[1] == "":
                reading = hiragana(parts[3])
                pieces.append(surface if reading == surface else f"{surface}[{reading}]")
            elif hiragana(parts[2]) == surface or hiragana(parts[1]) == surface:
                pieces.append(surface)
            else:
                pieces.append(f"{surface}[{hiragana(parts[1])}]")

        return "".join(pieces)

    def speak(self, text, description):
        import torch

        described = self.description_tokenizer(description, return_tensors="pt").to(self.device)
        prompt = self.prompt_tokenizer(self.add_ruby(text), return_tensors="pt").to(self.device)

        with torch.inference_mode():
            generation = self.model.generate(
                input_ids=described.input_ids,
                attention_mask=described.attention_mask,
                prompt_input_ids=prompt.input_ids,
                prompt_attention_mask=prompt.attention_mask,
            )

        return generation.cpu().numpy().squeeze(), self.model.config.sampling_rate


class QwenDesignEngine(Engine):
    """
    Qwen3-TTS VoiceDesign: the voice is made up from a description in plain language (age, gender, pitch,
    mood, pace), which the model reads as an instruction. It speaks ten languages; the script here is
    Japanese, and saying so keeps a line written only in kanji from being read as Chinese.

    Every line is made up afresh from the description. The shared seed keeps the lines of a job close, but
    not identical: holding one voice needs the family's voice-cloning model, which is not set up.
    """

    def load(self, model_dir):
        import torch
        from qwen_tts import Qwen3TTSModel

        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = Qwen3TTSModel.from_pretrained(
            model_dir,
            device_map=self.device,
            dtype=torch.bfloat16 if self.device != "cpu" else torch.float32,
        )

    def speak(self, text, description):
        waves, sample_rate = self.model.generate_voice_design(
            text=text, language="Japanese", instruct=description
        )
        return waves[0], sample_rate


class VoxCpmEngine(Engine):
    """
    VoxCPM2: the description goes in parentheses in front of the text, and the model makes up a voice to
    match. It works out the language from the text itself (thirty of them, Thai included) and speaks at
    48 kHz.

    A voice made up twice from one description is two different voices, even with the same seed. So only
    the first line of a job is designed; the others clone that line's clip, which the same model can do,
    and the job stays one speaker.
    """

    def __init__(self):
        super().__init__()
        # The first line's clip, on disk, for the later lines to clone
        self.reference = None

    def begin(self):
        self.release()

    def release(self):
        if self.reference and os.path.exists(self.reference):
            os.remove(self.reference)
        self.reference = None

    def load(self, model_dir):
        import torch
        from voxcpm import VoxCPM

        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        # The denoiser only cleans up reference recordings for voice cloning, and is fetched from the
        # network when asked for: neither is wanted here
        self.model = VoxCPM.from_pretrained(model_dir, load_denoiser=False)

    def speak(self, text, description):
        import tempfile

        import soundfile

        sample_rate = self.model.tts_model.sample_rate
        if self.reference:
            wave = self.model.generate(
                text=text, reference_wav_path=self.reference, cfg_value=2.0, inference_timesteps=10
            )
            return wave, sample_rate

        # A closing parenthesis inside the description would end it early
        described = description.replace("(", " ").replace(")", " ").strip()
        wave = self.model.generate(
            text=f"({described}){text}", cfg_value=2.0, inference_timesteps=10
        )
        handle, self.reference = tempfile.mkstemp(prefix="frozen-voice-", suffix=".wav")
        os.close(handle)
        soundfile.write(self.reference, wave, sample_rate)
        return wave, sample_rate


# The families of model this service can run, by the name the worker asks for them with. An environment
# only has the packages of some of them; asking for another fails at its import, with a plain message.
ENGINES = {"parler": ParlerEngine, "qwen": QwenDesignEngine, "voxcpm": VoxCpmEngine}


class Voice:
    """The model in use: loaded on first use, and swapped when another is asked for."""

    def __init__(self, models_root):
        self.models_root = models_root
        # The folder name of the model in memory
        self.name = None
        self.engine = None
        # One generation at a time: one GPU, and the worker sends one job at a time anyway
        self.lock = threading.Lock()

    @property
    def is_loaded(self):
        return self.engine is not None

    @property
    def device(self):
        return self.engine.device if self.engine else None

    def folder(self, name):
        """
        The folder of a model, by name. Models are the folders directly under the models root, so a name
        that is a path, or that names nothing there, is refused.
        """
        path = os.path.join(self.models_root, name)
        if name in ("", ".", "..") or os.path.basename(name) != name or not os.path.isdir(path):
            raise ValueError(f"no model named {name!r}")
        return path

    def load(self, name, kind):
        if self.is_loaded and self.name == name:
            return

        # One model at a time
        self.unload()
        model_dir = self.folder(name)
        started = time.monotonic()
        engine = ENGINES[kind]()
        try:
            engine.load(model_dir)
        except ImportError as error:
            raise RuntimeError(
                f"this Python environment can't run {kind} models ({error.name} is not installed)"
            ) from error

        self.engine = engine
        self.name = name
        log(f"{name} loaded on {engine.device} in {time.monotonic() - started:.1f}s")

    def unload(self):
        if not self.is_loaded:
            return

        import torch

        log(f"{self.name} unloaded")
        self.engine.release()
        self.engine = None
        self.name = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def speak(self, text, description, seed):
        """
        Generates one line of speech.

        The same seed is set before every line, so the lines of a job share as much of the voice as the
        description leaves open.

        Returns the samples (mono float32) and the sample rate.
        """
        import numpy

        seed_everything(seed)
        samples, sample_rate = self.engine.speak(text, description)
        samples = numpy.asarray(samples, dtype="float32").reshape(-1)
        # The models don't speak at one level, from each other or from line to line (Parler peaks around
        # -10 dBFS). Every clip is brought up to the same peak so a set of lines sits together.
        peak = float(abs(samples).max()) if samples.size else 0.0
        if peak > 0:
            samples = samples * (TARGET_PEAK / peak)

        return samples, int(sample_rate)


def inside(root, file_path):
    """Whether file_path lies under root, after resolving symlinks and `..`."""
    root = os.path.normcase(os.path.realpath(root))
    target = os.path.normcase(os.path.realpath(file_path))
    return target.startswith(root + os.sep)


def make_handler(voice, output_root):
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
                    "loaded": voice.is_loaded,
                    "model": voice.name,
                    "device": voice.device,
                },
            )

        def do_POST(self):
            if self.path == "/unload":
                with voice.lock:
                    voice.unload()
                return self.send_json(200, {"status": "ok"})
            if self.path == "/generate":
                return self.generate()

            self.send_json(404, {"message": "Not found"})

        def generate(self):
            try:
                body = self.read_json()
                model = str(body["model"])
                voice.folder(model)
                # Requests from before there was more than one family name none
                kind = str(body.get("engine", "parler"))
                if kind not in ENGINES:
                    raise ValueError(f"no engine named {kind!r}")
                lines = body["lines"]
                description = str(body["description"])
                seed = int(body["seed"])
                for line in lines:
                    if not inside(output_root, line["file"]):
                        raise ValueError(f"{line['file']} is outside the output folder")
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
                with voice.lock:
                    if voice.name != model:
                        emit({"event": "loading"})
                        voice.load(model, kind)

                    import soundfile

                    voice.engine.begin()
                    for index, line in enumerate(lines):
                        emit({"event": "line", "index": index})
                        started = time.monotonic()
                        samples, sample_rate = voice.speak(str(line["text"]), description, seed)

                        os.makedirs(os.path.dirname(line["file"]), exist_ok=True)
                        soundfile.write(line["file"], samples, sample_rate, subtype="PCM_16")
                        seconds = len(samples) / sample_rate
                        log(f"line {index + 1}/{len(lines)}: {seconds:.1f}s of audio in {time.monotonic() - started:.1f}s")
                        emit(
                            {
                                "event": "saved",
                                "index": index,
                                "file": line["file"],
                                "seconds": round(seconds, 3),
                                "sampleRate": sample_rate,
                            }
                        )

                    emit({"event": "done"})
            except (BrokenPipeError, ConnectionError):
                # The worker hung up (a canceled job): nobody is left to tell
                log("client disconnected, generation stopped")
            except Exception as error:  # noqa: BLE001 - whatever went wrong, the worker has to hear it
                log(f"generation failed: {error!r}")
                try:
                    emit({"event": "error", "message": str(error) or error.__class__.__name__})
                except OSError:
                    pass

    return Handler


def exit_with_parent(parent_pid):
    """
    Blocks until the process that started this one is gone, then exits.

    Watching stdin for end-of-file would be simpler, and on Windows it deadlocks: while a thread sits in a
    read on a stdin pipe, the child processes the model's libraries start during loading never come up, and
    the whole service hangs. So the parent is watched by its process id instead.
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
    parser = argparse.ArgumentParser(description="Frozen's text-to-speech service")
    parser.add_argument("--port", type=int, default=8191)
    parser.add_argument(
        "--models-root", required=True, help="Folder with one folder per model inside"
    )
    parser.add_argument("--output-root", required=True, help="Files may only be written under here")
    parser.add_argument(
        "--parent-pid",
        type=int,
        help="Exit when this process is gone. Without it the service runs until it is stopped",
    )
    args = parser.parse_args()

    voice = Voice(os.path.abspath(args.models_root))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(voice, args.output_root))
    if args.parent_pid:
        threading.Thread(target=exit_with_parent, args=(args.parent_pid,), daemon=True).start()

    log(f"listening on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
