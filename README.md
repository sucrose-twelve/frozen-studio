# Frozen

A local media studio: a web UI for generating images, videos and voice lines with models
that run on this machine. Forms on the left, the result on the right, every result kept in
a gallery.

| Mode    | What it does                                                                                                                                                                                                                              | Model               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Image   | Text to image, or an edit / mix of up to 4 reference images. Can also save a transparent cutout of the result                                                                                                                             | Qwen-Image 2.1      |
| Video   | Text to video, image to video, or a video through up to 6 keyframes (optionally looping). Frames can be saved, cut out, and built into a sprite sheet, exported as a zip (PNG sheet, a README with frame count and speed, a WebM preview) | Wan 2.2 I2V         |
| Cutout  | Background removal for up to 12 images at once                                                                                                                                                                                            | BiRefNet            |
| Voice   | Japanese text to speech: a script becomes one WAV clip per line, in a voice shaped by a description                                                                                                                                       | Japanese Parler-TTS |
| Gallery | Every result, with favorites. A result can be rerolled, have its settings reused, or be sent on to another form                                                                                                                           | —                   |

## How it fits together

```
Browser ──► Next.js app ──► Postgres   jobs, assets, job inputs
   ▲            │  ▲
   │ SSE        │  └────── Redis       queue (list), engine status (key), events + control (pub/sub)
   └────────────┘             ▲
                              │            ┌──► ComfyUI ──────────► images, videos
                           Worker ─────────┤
                                           └──► tts/server.py ────► voice clips
```

- The **app** never talks to an engine. Submitting a form validates it, writes a `jobs`
  row and pushes the job id onto a Redis list.
- The **worker** (`bun run worker`) is the only client of the engines. It takes one job at
  a time (one GPU), runs it, follows its progress, and records the files it produced as
  `assets` rows.
- Images, videos and cutouts run on **ComfyUI**, which is started separately. Voice runs
  on a small **text-to-speech service** in `tts/`, which the worker starts itself when a
  voice job arrives. The two share the GPU: whichever works next gets the VRAM the other
  was holding.
- Progress reaches the browser as Server-Sent Events: the worker publishes to Redis,
  `/api/events` relays it.
- Media stays where ComfyUI puts it. Frozen writes into a `frozen/` subfolder of ComfyUI's
  input and output directories, and serves files by asset id through `/api/media/[id]`.

## Requirements

- [bun](https://bun.sh) 1.4 and Node 24
- Postgres and Redis (e.g. Docker in WSL), with an empty database for the app
- ComfyUI 0.44+ running on this machine, with:

  | For    | Files (matched by name)                                                                                       |
  | ------ | ------------------------------------------------------------------------------------------------------------- |
  | Image  | a Qwen-Image 2.1 diffusion model, the `qwen3vl` text encoder, `qwen_image_2.1_vae`                            |
  | Video  | Wan 2.2 I2V high- and low-noise GGUFs (needs the ComfyUI-GGUF node), the `umt5` text encoder, the Wan 2.1 VAE |
  | Fast   | the `wan2.2_i2v_lightx2v` high- and low-noise LoRAs (optional: 4-step videos)                                 |
  | Cutout | any model in `models/background_removal`                                                                      |

- For Voice (optional): [uv](https://docs.astral.sh/uv/) to set up its Python environment,
  and about 10 GB of disk

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

## Run

### One click (Windows)

`launcher/Frozen.ps1` starts everything and opens the app in the browser: ComfyUI without
its desktop window, the app, and the worker. Put it on the Desktop once:

```sh
powershell -ExecutionPolicy Bypass -File launcher/Frozen.ps1 -InstallShortcut
```

Then double-click **Frozen**. It sits in the tray: right-click the icon to open the app or
the logs folder, or to quit, which stops what it started. A ComfyUI that was already
running is used as it is and left running. `launcher/Frozen.ps1 -Quit` does the same as
the tray's "Quit Frozen", from a terminal.

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
- **Deleting a job** deletes its files from disk. Uploaded reference images are kept.
- **No sign-in.** The app listens on localhost only.
