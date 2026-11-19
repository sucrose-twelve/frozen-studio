# Frozen

A local media studio: a web UI for generating images and videos with the models that
ComfyUI has installed on this machine. Forms on the left, the result on the right, every
result kept in a gallery.

| Mode    | What it does                                                                                                                                          | Model          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Image   | Text to image, or an edit / mix of up to 4 reference images. Can also save a transparent cutout of the result                                         | Qwen-Image 2.1 |
| Video   | Text to video, image to video, or a video through up to 6 keyframes (optionally looping). Frames can be saved, cut out, and built into a sprite sheet | Wan 2.2 I2V    |
| Cutout  | Background removal for up to 12 images at once                                                                                                        | BiRefNet       |
| Gallery | Every result, with favorites. A result can be rerolled, have its settings reused, or be sent on to another form                                       | —              |

Text to speech is planned and not built yet.

## How it fits together

```
Browser ──► Next.js app ──► Postgres   jobs, assets, job inputs
   ▲            │  ▲
   │ SSE        │  └────── Redis       queue (list), engine status (key), events + control (pub/sub)
   └────────────┘             ▲
                              │
                           Worker ──► ComfyUI ──► files on disk
```

- The **app** never talks to ComfyUI. Submitting a form validates it, writes a `jobs` row
  and pushes the job id onto a Redis list.
- The **worker** (`bun run worker`) is the only ComfyUI client. It takes one job at a time
  (one GPU), builds the ComfyUI workflow for it, follows its progress over ComfyUI's
  websocket, and records the files it produced as `assets` rows.
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

## Run

```sh
bun run dev              # the app on http://localhost:8190, and the worker
```

Start ComfyUI first, or at any point: until it is up, the header says "ComfyUI offline"
and jobs wait in the queue.

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
```

Conventions for the code live in `.claude/skills/web-stack/`.

## Good to know

- **VRAM.** A game or another GPU program running at the same time pushes the models into
  shared memory and generation crawls. The header warns when another program holds VRAM.
- **Long videos** are made in passes of up to 5 seconds. Each pass loads the high-noise
  and then the low-noise model, so the time grows with every pass.
- **Deleting a job** deletes its files from disk. Uploaded reference images are kept.
- **No sign-in.** The app listens on localhost only.
