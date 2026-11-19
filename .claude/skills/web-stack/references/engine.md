# The engine — jobs, queue, worker, ComfyUI, voice

```
Browser ──► Next.js app ──► Postgres   jobs, assets, job_inputs
   ▲            │  ▲
   │ SSE        │  └────── Redis       frozen:queue · frozen:engine · frozen:events · frozen:control
   └────────────┘             ▲
                              │            ┌──► ComfyUI ──────────► images, videos
                           Worker ─────────┤
                                           └──► tts/server.py ────► voice clips
```

Two processes share this repo:

- The **app** (Next.js) validates input, writes rows, pushes job ids to Redis and reads
  results. It never calls an engine.
- The **worker** (`bun run worker` → `tests/worker.spec.ts` → `src/worker/`) is the only
  client of the engines. It runs one job at a time: one GPU, and the models don't fit side
  by side.

And two engines do the generating:

- **ComfyUI**, for image, video and cutout jobs. It is a separate program, started by hand
  or by `launcher/Frozen.ps1`; the worker waits for it and never starts or stops it.
- The **voice service** (`tts/server.py`), for voice jobs. It belongs to this project: the
  worker starts it when the first voice job arrives and stops it when it exits. See
  [the voice engine](#the-voice-engine).

There is exactly one worker. A second one refuses to start while the first is alive (it
watches whether the status in Redis keeps getting newer), since it would run a second job
on the same GPU and fail the first worker's job as interrupted.

Postgres is the record; Redis is the transport. If they disagree, Postgres wins (see
[recovery](#recovery)).

## Redis

All names are in `REDIS_KEYS` (`@/constants`) and prefixed `frozen:`.

| Name             | Type    | Written by | Read by  | Holds                                                     |
| ---------------- | ------- | ---------- | -------- | --------------------------------------------------------- |
| `frozen:queue`   | list    | app        | worker   | Job ids. `LPUSH` to add, `BRPOP` to take, `LREM` to drop  |
| `frozen:engine`  | string  | worker     | app      | JSON `Engine.Status`, rewritten every 4 s with a 15 s TTL |
| `frozen:events`  | pub/sub | worker/app | browsers | JSON `Engine.Event`, relayed by `/api/events`             |
| `frozen:control` | pub/sub | app        | worker   | JSON `Engine.Control` (`{ type: "cancel", id }`)          |

A missing `frozen:engine` key means the worker isn't running: the header says "Worker
offline" and the forms can't know what is installed.

App code uses `@/libs/queue` (`enqueueJobs`, `dequeueJobs`, `requestCancel`,
`publishEvent`, `readEngineStatus`), never raw commands.

## A job's life

| Status      | Set by | When                                                            |
| ----------- | ------ | --------------------------------------------------------------- |
| `queued`    | app    | `createJob` / `rerollJob` wrote the row                         |
| `running`   | worker | It took the id off the queue and the job's engine is up         |
| `succeeded` | worker | The engine finished and the files became `assets` rows          |
| `failed`    | worker | Anything threw; the message is in `jobs.error`                  |
| `canceled`  | either | The app (still queued) or the worker (running, after interrupt) |

Every change is published as `{ type: "job", id, status, error? }`.

### Queueing a job

`createJob` (`actions/jobs/create.ts`):

1. Parses the form with `jobValidator` (a union on `kind`).
2. Turns the form into stored **params** (`toImageParams` / `toVideoParams` /
   `toVoiceParams` in `@/libs/job`): resolves the pixel size, picks a random seed when
   none was given, and drops options the installed models can't honour (fast mode without
   the LoRAs).
3. Inserts the `jobs` row and its `job_inputs` (the reference images, in order).
4. Pushes the id onto the queue and returns it, so the client can put the job on the
   canvas.

`params` (`Media.JobParams`) is what actually ran, complete enough to run it again:
"Reroll" copies it with a new seed, "Reuse settings" loads it back into the form. A cutout
job takes one image; the form queues one job per image. A voice job keeps its whole script
in `jobs.prompt` and makes one clip per line (`scriptLines` in `@/libs/job` is the one
place that splits it).

### Running it

`worker/index.ts` pops an id and calls `runJob`, which re-reads the row (a job no longer
`queued` was canceled or deleted while waiting, and is skipped), waits for ComfyUI unless
it is a voice job, marks it `running`, and hands it to `processJob` (`worker/process.ts`).
A voice job goes straight to `runVoiceJob` (below). The others run on ComfyUI:

1. Load the job's inputs and turn each into the name ComfyUI's `LoadImage` takes
   (`comfyImageName`).
2. Build the workflow for the job's kind (below).
3. `POST /prompt`, and set `control.cancel` to interrupt that prompt.
4. `watchPrompt` follows the run on ComfyUI's websocket (`worker/comfy-socket.ts`): which
   node is executing, sampler progress, the end or the error. If the socket drops, it
   falls back to polling `/history`.
5. Each node start looks up its **label** and publishes
   `{ type: "progress", id, label, value, max }`; `max` is 0 while there is nothing to
   count, which the canvas shows as an indeterminate bar.
6. Read which files the save nodes wrote from the history, and insert them as `assets`.

### Canceling

- Still `queued`: the app flips the row to `canceled` itself (a conditional update, so it
  can't race the worker), removes the id from the list, and publishes the event.
- `running`: the app publishes a cancel on `frozen:control`. The worker sets
  `control.isCanceled` and calls `control.cancel`, which whatever runs the job has set:
  interrupt the prompt on ComfyUI, or stop the voice service. The run ends as `canceled`.

### Recovery

When the worker starts, it puts Redis back in step with Postgres: a job still `running`
belonged to a worker that is gone and becomes `failed`; a `queued` job missing from the
list is pushed again, oldest first. On `SIGINT` it interrupts the running job, marks it
failed, stops the voice service and deletes its status key.

## Building workflows

A workflow is ComfyUI's API-format JSON: `{ "<id>": { class_type, inputs } }`. They are
built in code, one file per job kind in `src/libs/comfy/graphs/`, with `GraphBuilder`
(`builder.ts`):

```ts
const builder = new GraphBuilder()
const image = builder.add("LoadImage", { image: name }, "Reading the image")
const mask = output(image, 1)
const saved = builder.add("SaveImage", {
  images: image,
  filename_prefix: outputPrefix(jobId, "image")
})
builder.output(saved, "output", "image")

return builder.build()
```

- `add(classType, inputs, label?)` returns a reference to the node's first output; pass it
  as another node's input to wire them. `output(ref, n)` is its n-th output.
- The optional **label** is what the user reads while that node runs ("Painting", "Part
  2/3: drawing the motion"). Label the nodes that take time; the rest inherit the last
  label. Write labels as plain progress text, capitalised, no trailing period.
- `builder.output(saveNode, role, kind)` marks a save node's files as results. Only marked
  nodes become assets, each with that `role`.
- Shared pieces live in `shared.ts`: `outputPrefix`, `loadReference` (flattens
  transparency onto white, which the models need), `removeBackground`.

| File        | Builds                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `image.ts`  | Qwen-Image 2.1: text to image, or an edit when references are given. Optional cutout copy                                     |
| `video.ts`  | Wan 2.2 I2V: one or more passes (`planSegments`), joined; the first frame is drawn with `addQwenImage` when no image is given |
| `cutout.ts` | BiRefNet background removal for one image                                                                                     |

Rules that keep them honest:

- **Model file names are never hard-coded.** `discoverModels()` (`comfy/discover.ts`) asks
  ComfyUI which files it has and matches them by pattern; the worker adds the voice engine
  (`findVoiceModel`), and the result (`Engine.Models`) travels in the engine status. A
  builder throws a plain message when its models are missing, and the form already blocks
  submission with a note.
- **What a model needs is written where it is used**, as a comment with the reason: the
  sampler per mode, the negative prompt that must not be empty, the 32px size grid. Those
  were found by testing; don't "simplify" them away.
- **Sizes and lengths are computed in one place** (`@/constants/media.ts`,
  `@/libs/video-plan.ts`) and used by both the form's summary line and the builder, so the
  UI never promises what the workflow doesn't do.
- Check a node's inputs against the running ComfyUI before using it:
  `curl -s http://127.0.0.1:8188/object_info/<NodeClass>`.

## The voice engine

Voice jobs don't touch ComfyUI. `runVoiceJob` (`worker/voice.ts`) talks to
`tts/server.py`, a small HTTP service around Japanese Parler-TTS that listens on
`127.0.0.1:<TTS_PORT>`:

| Request          | Does                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /health`    | `{ status, loaded, device }`. Answers as soon as Python is up; nothing heavy is loaded yet           |
| `POST /generate` | Speaks `lines` (`{ text, file }`) with one `description` and `seed`; streams one JSON event per line |
| `POST /unload`   | Drops the model, and its VRAM, until the next `/generate`                                            |

- **Installed or not** is read from disk, by `findVoiceModel()`: the environment's Python,
  the script, and the model's weights. That is all `Engine.Models.voice` means; nothing is
  started to find out.
- **The worker owns the process.** It starts the service for the first voice job
  (`startVoiceEngine`), reuses one that already answers, and stops it on exit. The service
  is given the worker's process id and exits when that process is gone, so a killed worker
  doesn't leave the model in VRAM.
- **Don't watch stdin for that.** A thread blocked reading a stdin pipe deadlocks the
  whole service on Windows as soon as the model's libraries start a child process while
  loading. The parent is watched by process id (`exit_with_parent` in `server.py`), and
  the service is started with stdin closed.
- **Stopping kills the tree.** On Windows the environment's `python.exe` is a launcher
  with the real interpreter as its child; `stopVoiceEngine` uses `taskkill /T`. Stopping
  is also how a running voice job is canceled.
- **Events** from `/generate` (`loading`, `line`, `saved`, `done`, `error`) become
  progress labels ("Loading the voice model", "Speaking · 2 / 5") and, for `saved`, an
  `assets` row of kind `audio`.
- **The voice** is not a speaker id. The model is told what the speaker sounds like in
  English (`params.description`); the presets in `VOICE_PRESETS` are such descriptions,
  and "JSUT" in one names a speaker the model knows. It only has female voices.
- **The text** gets furigana before it is spoken (`add_ruby`), because the model was
  trained that way and misreads bare kanji. Each clip is normalised to one peak level.
- **Python packages** are pinned in `tts/requirements.txt`, with the reason next to each
  pin that isn't obvious. PyTorch must be the CUDA 12.8 build for RTX 50-series cards.

A request can be tried by hand, with the service started in a terminal:

```sh
tts/.venv/Scripts/python.exe tts/server.py --model-dir tts/models/japanese-parler-tts-mini --output-root D:/tmp
curl -s -X POST http://127.0.0.1:8191/generate -H "Content-Type: application/json" \
  -d '{"lines":[{"text":"こんにちは。","file":"D:/tmp/a/hello.wav"}],"description":"JSUT speaks at a moderate pace in a very clear recording.","seed":1}'
```

### Adding a kind of job

1. `Media.JobKind` and a `…Params` type in `src/types/schema.d.ts`; add it to `JOB_KINDS`
   and its labels in `constants/media.ts`.
2. A validator in `actions/jobs/validator.zod.ts`, added to `jobValidator`; a `to…Params`
   in `@/libs/job` and a branch in `createJob`.
3. What it needs installed, in `Engine.Models`: from ComfyUI in `discoverModels`, from
   elsewhere in `allModels` (`worker/engine.ts`).
4. How it runs: a builder in `comfy/graphs/` and a `case` in `processJob`, or, off
   ComfyUI, its own runner called from the top of `processJob` as `runVoiceJob` is. Either
   way it sets `control.cancel` and ends by inserting `assets`.
5. A form in `(studio)/components/`, mounted in `studio-forms.tsx` with its icon, and its
   result: in `job-result.tsx`, or a view of its own picked in `job-canvas.tsx`
   (`voice-result.tsx`).
6. The gallery tile and the recent strip, when the result isn't a picture.

## Media on disk

Frozen keeps no media folder of its own. Files live in the directories ComfyUI was started
with (`COMFY_INPUT_DIR`, `COMFY_OUTPUT_DIR`), inside a `frozen/` subfolder
(`MEDIA_FOLDER`):

| What             | Where                                     | Written by        |
| ---------------- | ----------------------------------------- | ----------------- |
| Reference upload | `<input>/frozen/<uuid>.png`               | `/api/uploads`    |
| Job results      | `<output>/frozen/<jobId>/<name>_…`        | ComfyUI           |
| Voice clips      | `<output>/frozen/<jobId>/voice_0000N.wav` | the voice service |

- An `assets` row stores `root` (`input` or `output`) and a `path` relative to it, with
  forward slashes. `assetFilePath()` resolves it and refuses a path that leaves the root.
- The browser only ever sees an asset **id**: `/api/media/<id>`.
- Uploads are converted to PNG in the browser and capped at 2048px a side
  (`@/libs/upload`), so ComfyUI never meets an odd format.
- An earlier result can be a reference: `LoadImage` reads from the output directory when
  the name ends in ` [output]` (`comfyImageName`).
- Asset **kinds**: `image`, `video`, `audio`. An audio asset has no pixel size; its
  `width` and `height` are 0, and its `position` is the line of the script it speaks.
- Asset **roles**: `upload` (a reference), `output` (the result), `cutout` (its
  transparent copy), `frame` (a saved video frame), `still` (the first frame drawn for a
  text-to-video).
- Deleting a job removes its rows (assets cascade) and its folder. Uploads stay: other
  jobs may use them.
- The voice service only writes under the folder it was started with (`--output-root`).

## The GPU

- The worker reports which other programs hold VRAM (`worker/gpu.ts`, a Windows
  performance counter read through PowerShell). From 1 GB up the header warns: with a game
  open, the video models spill into shared memory and a job that takes a minute takes ten.
- The two Wan models don't fit together in 16 GB, so every video pass loads one, then the
  other. A long or multi-keyframe video pays that swap per pass.
- **The two engines take turns.** Before a voice job the worker asks ComfyUI to drop its
  models (`freeComfyMemory`); before a ComfyUI job it has the voice model unloaded
  (`unloadVoiceModel`). The voice model takes about 4 GB and loads in a few seconds;
  ComfyUI's take longer to come back. Jobs of one kind in a row pay nothing.
