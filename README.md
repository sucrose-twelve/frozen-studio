# Frozen

A local media studio: a web UI for generating images, videos and voice lines, and for
describing images, with models that run on this machine. Forms on the left, the result on
the right, every result kept in a gallery.

| Mode    | What it does                                                                                                                                                                                                                              | Model                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Image   | Text to image, or an edit / mix of up to 4 reference images (Qwen-Image only). Can also save a transparent cutout of the result                                                                                                           | Qwen-Image 2.1, MOSS-Image, Iris |
| Video   | Text to video, image to video, or a video through up to 6 keyframes (optionally looping). Frames can be saved, cut out, and built into a sprite sheet, exported as a zip (PNG sheet, a README with frame count and speed, a WebM preview) | Wan 2.2 I2V, LTX 2.5             |
| Cutout  | Background removal for up to 12 images at once                                                                                                                                                                                            | BiRefNet                         |
| Voice   | Japanese text to speech: a script becomes one WAV clip per line, in a voice shaped by a description                                                                                                                                       | Japanese Parler-TTS              |
| Caption | Image and text to text: a detailed description of each image with a positive and a negative prompt that ask for it again, or an answer to whatever the prompt asks about it. The text can be sent on to the Image or Video form           | Ministral 3 8B                   |
| Gallery | Every result, with favorites. A result can be rerolled, have its settings reused, or be sent on to another form                                                                                                                           | —                                |

## How it fits together

```
Browser ──► Next.js app ──► Postgres   jobs, assets, job inputs
   ▲            │  ▲
   │ SSE        │  └────── Redis       queue (list), engine status (key), events + control (pub/sub)
   └────────────┘             ▲
                              │            ┌──► ComfyUI ──────────► images, videos
                              │            ├──► sdcpp/ (sd-cli) ──► images from GGUF text encoders
                           Worker ─────────┼──► tts/server.py ────► voice clips
                                           └──► caption/server.py ► descriptions and prompts
```

- The **app** never talks to an engine. Submitting a form validates it, writes a `jobs`
  row and pushes the job id onto a Redis list.
- The **worker** (`bun run worker`) is the only client of the engines. It takes one job at
  a time (one GPU), runs it, follows its progress, and records the files it produced as
  `assets` rows.
- Images, videos and cutouts run on **ComfyUI**, which is started separately. Voice runs
  on a small **text-to-speech service** in `tts/` and captions on a **captioning service**
  in `caption/`; the worker starts each itself when a job needs it. An image job whose
  text encoder is a GGUF runs on **stable-diffusion.cpp** instead, a program in `sdcpp/`
  the worker runs once per job. They all share the GPU: whichever works next gets the VRAM
  the others were holding.
- Progress reaches the browser as Server-Sent Events: the worker publishes to Redis,
  `/api/events` relays it.
- Media stays where ComfyUI puts it. Frozen writes into a `frozen/` subfolder of ComfyUI's
  input and output directories, and serves files by asset id through `/api/media/[id]`.

## Requirements

- [bun](https://bun.sh) 1.4 and Node 24
- Postgres and Redis (e.g. Docker in WSL), with an empty database for the app
- ComfyUI 0.44+ running on this machine, with:

  | For    | Files (matched by name)                                                                                                                                                                                                                                                         |
  | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Image  | a Qwen-Image 2.1 diffusion model (safetensors or GGUF, a Turbo build included), a `qwen3vl` 8B text encoder as safetensors, `qwen_image_2.1_vae`. And / or a MOSS-Image diffusion model, the `qwen3.5_9b` text encoder, `flux2-vae` (optional: LoRAs with `moss` in their name) |
  | Video  | Wan 2.2 I2V high- and low-noise GGUFs (needs the ComfyUI-GGUF node), the `umt5` text encoder, the Wan 2.1 VAE                                                                                                                                                                   |
  | Video  | And / or LTX 2.5: a diffusion model with `ltx25` in its name (GGUF or safetensors), its `gemma4` text encoder with `ltx` in the name, its video VAE. Text to video and one image to video, at 24 fps                                                                            |
  | Fast   | the `wan2.2_i2v_lightx2v` high- and low-noise LoRAs (optional: 4-step videos)                                                                                                                                                                                                   |
  | Cutout | any model in `models/background_removal`                                                                                                                                                                                                                                        |

- For Voice (optional): [uv](https://docs.astral.sh/uv/) to set up its Python environment,
  and about 10 GB of disk
- For Caption (optional): uv again, about 16 GB of disk, and a card with 12 GB of VRAM or
  more
- For GGUF text encoders (optional): stable-diffusion.cpp, about 1.3 GB of disk

A mode whose models are missing is disabled in the UI with a note saying what it needs.

## Setup

```sh
cp .env.example .env     # then fill in the database, Redis and ComfyUI values
bun install
bun run drizzle:migrate
```

`COMFY_INPUT_DIR` and `COMFY_OUTPUT_DIR` must be the directories ComfyUI itself was
started with: the worker hands ComfyUI paths relative to them, and the app reads the same
files from disk.

### Voice (optional)

The text-to-speech service has its own Python environment in `tts/.venv` and its model in
`tts/models`; neither is committed. From the project root:

```sh
uv venv tts/.venv --python 3.12
uv pip install --python tts/.venv/Scripts/python.exe torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python tts/.venv/Scripts/python.exe -r tts/requirements.txt
tts/.venv/Scripts/python.exe tts/download_model.py
```

That is about 3.3 GB of PyTorch (the CUDA 12.8 build, which RTX 50-series cards need), a
few hundred MB of other packages, and a 3.5 GB model
([2121-8/japanese-parler-tts-mini](https://huggingface.co/2121-8/japanese-parler-tts-mini)).
Restart the worker afterwards; the Voice form unlocks once it sees the environment and the
model in place. There is nothing to start by hand.

### stable-diffusion.cpp (optional)

ComfyUI can't use a Qwen3-VL text encoder that comes as a GGUF (the abliterated ones are
published that way).
[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) can, and Frozen
runs it for the jobs that pick such an encoder. From its
[releases](https://github.com/leejet/stable-diffusion.cpp/releases), unpack into
`sdcpp/bin` (not committed):

- `sd-…-bin-win-cuda12-x64.zip`, the program (`sd-cli.exe`), about 390 MB
- `cudart-sd-bin-win-cu12-x64.zip`, the CUDA libraries it needs beside it, about 540 MB

It takes model files from the folders in `SDCPP_MODEL_DIRS` (`sdcpp/models` unless set),
searched with their subfolders. Add ComfyUI's models folder there, after a `;`, and both
engines use one copy of a file. Two sets of files are recognised, by name:

- a Turbo build of Qwen-Image 2.1 as a GGUF, a `qwen3vl` 8B text encoder as a GGUF, and
  `qwen_image_2.1_vae`
- an Iris model as a GGUF (`iris` in its name) and a `qwen3vl` 4B text encoder as a GGUF;
  Iris needs no VAE, and ComfyUI can't run it at all

Restart the worker afterwards: with a Turbo model picked, the Image form's Text encoder
list then offers the GGUF encoders, marked "sd.cpp", and Iris models appear in its Model
list.

### Caption (optional)

The captioning service is set up the same way, in `caption/.venv` and `caption/models`:

```sh
uv venv caption/.venv --python 3.12
uv pip install --python caption/.venv/Scripts/python.exe torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python caption/.venv/Scripts/python.exe -r caption/requirements.txt
caption/.venv/Scripts/python.exe caption/download_model.py
```

PyTorch comes from uv's cache when Voice was set up first; the model is 11.8 GB
([Felldude/Ministral-3-8B-Uncensored-FP8](https://huggingface.co/Felldude/Ministral-3-8B-Uncensored-FP8)).
Restart the worker afterwards.

Other vision-language models can sit beside it: every folder under `caption/models` with a
`config.json` and `.safetensors` weights is offered in the Caption form's Model list, and
`caption/download_model.py <repository>` fetches one from Hugging Face.
`CAPTION_MODEL_DIR` only says which one the form starts on. Anything transformers loads as
an image-text-to-text model works, as long as it fits the card: weights stored in FP8 stay
in FP8, everything else loads at 16 bits, so a full-precision 8B model needs about 18 GB.

## Run

### One click (Windows)

`launcher/Frozen.ps1` starts everything and opens the app in the browser: ComfyUI without
its desktop window, the app, and the worker. Put it on the Desktop once:

```sh
powershell -ExecutionPolicy Bypass -File launcher/Frozen.ps1 -InstallShortcut
```

Then double-click **Frozen**. It sits in the tray: right-click the icon to open the app or
the logs folder, or to quit. `launcher/Frozen.ps1 -Quit` does the same as the tray's "Quit
Frozen", from a terminal.

Quitting leaves nothing of Frozen running and gives the VRAM back. It stops what the
launcher started, and the voice and caption services and stable-diffusion.cpp whoever
started them. A ComfyUI that was already running is used as it is and left running, but
asked to drop its models. If a launcher was killed instead of quit, the next one stops
what it left behind before starting again.

The app runs as a production build. The launcher builds it when there is no build yet or
the code has changed since the last one, which adds about half a minute to that start;
otherwise the app is up in a few seconds. If the build fails, it runs the dev server
instead and says so. To get the dev server on purpose, where an edit shows without a
restart, start it with `-Dev`.

It finds ComfyUI through Comfy Desktop's settings, starts it with the folders from `.env`,
and holds back VRAM for any other program that is using the card. Output goes to `logs/`.

### By hand

```sh
bun run dev              # the app on http://localhost:8190, and the worker
```

Start ComfyUI first, or at any point: until it is up, the header says "ComfyUI offline"
and image, video and cutout jobs wait in the queue. Voice jobs don't need it.

| Script                      | What it does                                             |
| --------------------------- | -------------------------------------------------------- |
| `bun run dev`               | App (`start:dev`) and worker together                    |
| `bun run start:dev`         | Only the Next.js dev server                              |
| `bun run worker`            | Only the queue worker                                    |
| `bun run build`             | Production build (type-checks everything)                |
| `bun run start:prod`        | Serve the production build                               |
| `bun run drizzle:generate`  | Write a migration from the schema                        |
| `bun run drizzle:migrate`   | Apply migrations                                         |
| `bun tests/status.spec.ts`  | Print the worker's status, the queue and the newest jobs |
| `bun tests/job.spec.ts "…"` | Queue an image job from the command line                 |

The `tests/` folder holds scripts, not automated tests.

## Layout

```
src/
├── actions/      Server Actions and readers, by domain: jobs/, assets/, engine/
├── app/
│   ├── (studio)/ The studio (/) and the gallery (/gallery), with their components
│   └── api/      events (SSE), media/[id] (files), uploads (reference images)
├── components/   Shared UI: header, engine status, event stream
├── constants/    Value lists and labels, Redis key names, env
├── drizzle/      Schema, relations, migrations
├── libs/         Queue, Redis, media paths, ComfyUI client and workflow builders
├── stores/       The zustand store fed by the event stream
├── styles/       Theme (the four palette colours) and custom utilities
└── worker/       The queue worker
tts/              The text-to-speech service (Python): server.py, requirements.txt
caption/          The captioning service (Python): server.py, requirements.txt
sdcpp/            stable-diffusion.cpp, unpacked here (not committed)
launcher/         Frozen.ps1: starts ComfyUI, the app and the worker in one click
```

Conventions for the code live in `.claude/skills/web-stack/`.

## Good to know

- **VRAM.** A game or another GPU program running at the same time pushes the models into
  shared memory and generation crawls. The header warns when another program holds VRAM.
- **Long videos** are made in passes of up to 5 seconds. Each pass loads the high-noise
  and then the low-noise model, so the time grows with every pass.
- **Negative prompts** work in the Image form always, and in the Video form only with Fast
  mode off: the 4-step schedule ignores them, and the full one takes about two minutes per
  second of video. Voice has none; its description does the steering.
- **Voice.** The model speaks Japanese, with female voices only: asking for a man lowers
  the pitch a little and nothing more. A line may be up to 160 characters, about the 30
  seconds the model can speak in one go. The first job after an image or video job takes
  longer, while the voice model loads back into VRAM.
- **Caption.** A caption takes about a minute: half of it is the model loading, which the
  next caption in a row doesn't pay again. The description and the positive prompt are
  read from the image; the negative prompt can't be, and is the model's advice for that
  kind of image. Captions are text, so they are kept on the Caption page, in its recent
  strip, and not in the gallery.
- **Models.** The Image, Video, Voice and Caption forms each start with a Model list of
  what is installed for them: the Qwen-Image files, the Wan 2.2 high/low pairs and the LTX
  2.5 files ComfyUI has, and the model folders under `tts/models` and `caption/models`.
  Nothing needs editing in `.env` to switch. The Image form also lists the text encoders
  that fit its model.
- **MOSS-Image** is the family the Image form starts on when it is installed, and what
  draws the first frame of a text-to-video; Qwen-Image 2.1 comes after it. It has its own
  text encoder and VAE, and picking a model of another family switches the form to that
  family's settings (MOSS-Image: 25 steps, CFG 2.5). It only draws new images here: its
  editing needs a separate LoRA that isn't set up. A LoRA made for it can be picked under
  Advanced, with a strength; most LoRAs only show their effect with their trigger word at
  the start of the prompt.
- **Iris** is a third family in the Image form, a smaller model that draws pixels directly
  (no VAE). It runs on stable-diffusion.cpp only, with 30 steps at CFG 3; 20 steps is
  close, and it takes a negative prompt. It only draws new images.
- **Turbo image models** (a Qwen-Image 2.1 file with "Turbo" in its name) draw in 8 steps,
  about 15 seconds an image. Their schedule is fixed: the steps, guidance and sampler
  can't be changed, and a negative prompt is not read. They only draw new images: given a
  reference image they return it burnt, so the form keeps edits on the other models. One
  in a GGUF file is paired with the GGUF text encoders alone, when there are any, and so
  runs on stable-diffusion.cpp.
- **GGUF image models.** A GGUF made with stable-diffusion.cpp carries no metadata, and
  ComfyUI-GGUF then can't tell what model it is ("Unknown model architecture"). It loads
  once the file names its architecture: copy it with gguf-py, adding
  `general.architecture` (`qwen_image` for Qwen-Image 2.1). A Qwen3-VL text encoder as a
  GGUF does not work in ComfyUI at all: it recognises that encoder by its vision half,
  which a GGUF leaves out.
- **stable-diffusion.cpp** is what runs a job with such a GGUF text encoder, and every
  Iris job. It is only set up for new images, on Turbo models and on Iris, and it loads
  its models for every job: a Turbo image takes about 15 seconds however many came before,
  an Iris image about 30 at its 30 steps. It can't save the cut-out copy in the same job;
  "Cut out" on the result does that.
- **Deleting a job** deletes its files from disk. Uploaded reference images are kept.
- **No sign-in.** The app listens on localhost only.
