# The engine — jobs, queue, worker, ComfyUI, voice, caption

```
Browser ──► Next.js app ──► Postgres   jobs, assets, job_inputs
   ▲            │  ▲
   │ SSE        │  └────── Redis       frozen:queue · frozen:engine · frozen:events · frozen:control
   └────────────┘             ▲
                              │            ┌──► ComfyUI ──────────► images, videos
                              │            ├──► sdcpp/ (sd-cli) ──► images: GGUF text encoders, Iris
                           Worker ─────────┼──► tts/server.py ────► voice clips
                                           └──► caption/server.py ► descriptions and prompts
```

Two processes share this repo:

- The **app** (Next.js) validates input, writes rows, pushes job ids to Redis and reads
  results. It never calls an engine.
- The **worker** (`bun run worker` → `tests/worker.spec.ts` → `src/worker/`) is the only
  client of the engines. It runs one job at a time: one GPU, and the models don't fit side
  by side.

And four engines do the generating:

- **ComfyUI**, for image, video and cutout jobs. It is a separate program, started by hand
  or by `launcher/Frozen.ps1`; the worker waits for it and never starts or stops it.
- **stable-diffusion.cpp** (`sdcpp/bin/sd-cli.exe`), for the image jobs ComfyUI can't run:
  those with a text encoder that comes as a GGUF, which includes every Iris job. The
  worker runs it once per job. See [stable-diffusion.cpp](#stable-diffusioncpp).
- The **voice service** (`tts/server.py`), for voice jobs. It belongs to this project: the
  worker starts it when the first voice job arrives and stops it when it exits. See
  [the voice engine](#the-voice-engine).
- The **captioning service** (`caption/server.py`), for caption jobs, owned by the worker
  in the same way. See [the caption engine](#the-caption-engine).

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

| Status      | Set by | When                                                                              |
| ----------- | ------ | --------------------------------------------------------------------------------- |
| `queued`    | app    | `createJob` / `rerollJob` wrote the row                                           |
| `running`   | worker | It took the id off the queue and the job's engine is up                           |
| `succeeded` | worker | The engine finished and the files became `assets` rows (a caption: `jobs.result`) |
| `failed`    | worker | Anything threw; the message is in `jobs.error`                                    |
| `canceled`  | either | The app (still queued) or the worker (running, after interrupt)                   |

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
or caption job takes one image; the form queues one job per image. A voice job keeps its
whole script in `jobs.prompt` and makes one clip per line (`scriptLines` in `@/libs/job`
is the one place that splits it).

### Running it

`worker/index.ts` pops an id and calls `runJob`, which re-reads the row (a job no longer
`queued` was canceled or deleted while waiting, and is skipped), waits for ComfyUI when
the job runs on it (`runsOnComfy`), marks it `running`, and hands it to `processJob`
(`worker/process.ts`). A voice job goes straight to `runVoiceJob` and a caption job to
`runCaptionJob` (both below). The others run on ComfyUI:

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
  interrupt the prompt on ComfyUI, or stop the job's Python service. The run ends as
  `canceled`.

### Recovery

When the worker starts, it puts Redis back in step with Postgres: a job still `running`
belonged to a worker that is gone and becomes `failed`; a `queued` job missing from the
list is pushed again, oldest first. On `SIGINT` it interrupts the running job, marks it
failed, stops the Python services and deletes its status key.

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

| File        | Builds                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.ts`  | `addImage`, on the model's family: Qwen-Image 2.1 (text to image, an edit with references, a Turbo build on its fixed schedule) or MOSS-Image (text to image). Optional LoRA and cutout copy |
| `video.ts`  | Wan 2.2 I2V: one or more passes (`planSegments`), joined; the first frame is drawn with `addImage` when no image is given                                                                    |
| `cutout.ts` | BiRefNet background removal for one image                                                                                                                                                    |

Rules that keep them honest:

- **The model is the job's choice.** Each form starts with a `ModelSelect` over what
  `Engine.Models` lists for its kind, and the pick is stored in the job's params
  (`params.model`). For video one choice is a pair of Wan files (`Engine.VideoModel`),
  matched up by name in `pairVideoModels`. The Image form has a second one for the text
  encoder (`params.textEncoder`), since more than one build of it can be installed.
- **The Image form runs more than one family** (`Media.ImageFamily`: Qwen-Image 2.1,
  MOSS-Image, Iris). A file's family is read from its name (`imageFamily` in
  `@/libs/image-model`), `Engine.Models.image` lists each family's models, text encoders,
  VAE and LoRAs, and `IMAGE_FAMILY_SAMPLING` holds how each is sampled and whether it can
  edit. Picking a model of another family resets the form's sampling to that family's. A
  new family needs: its patterns in `discoverModels`, an entry in those constants, and an
  `add…Image` builder that `addImage` dispatches to. One that runs on stable-diffusion.cpp
  instead is found in `withSdCppModels` and given its arguments in `runSdCppJob`.
- **A model that runs one way only says so in code, not in the form's values.** A Turbo
  image model (`isTurboImageModel`, by file name) always gets `IMAGE_TURBO`: the builder
  ignores the job's steps, CFG and sampler, `toImageParams` stores what really ran, and
  the form shows those settings disabled. It can't edit (`canEditImages`), and neither can
  MOSS-Image, so the form and `createJob` both refuse references with them.
- **GGUF files go through ComfyUI-GGUF's loaders** (`isGgufFile`), and only for diffusion
  models. One written by stable-diffusion.cpp has no `general.architecture` and fails to
  load until a copy with that field is made; a Qwen3-VL text encoder as GGUF loads but is
  mistaken for another model's encoder, so `discoverModels` doesn't list those.
- **Model file names are never hard-coded.** `discoverModels()` (`comfy/discover.ts`) asks
  ComfyUI which files it has and matches them by pattern; the worker adds the voice and
  caption engines (`findVoiceModels`, `findCaptionModels`), and the result
  (`Engine.Models`) travels in the engine status. A builder throws a plain message when
  its models are missing, and the form already blocks submission with a note.
- **What a model needs is written where it is used**, as a comment with the reason: the
  sampler per mode, the negative prompt that must not be empty, the 32px size grid. Those
  were found by testing; don't "simplify" them away.
- **Sizes and lengths are computed in one place** (`@/constants/media.ts`,
  `@/libs/video-plan.ts`) and used by both the form's summary line and the builder, so the
  UI never promises what the workflow doesn't do.
- Check a node's inputs against the running ComfyUI before using it:
  `curl -s http://127.0.0.1:8188/object_info/<NodeClass>`.

## stable-diffusion.cpp

A second image engine, for what ComfyUI can't do: read a Qwen3-VL text encoder from a GGUF
file, and run Iris models. `runSdCppJob` (`worker/sdcpp.ts`) runs `sd-cli` once for the
job.

- **Which engine runs a job follows from its text encoder** (`imageEngine` in
  `@/libs/image-model`): a GGUF one means stable-diffusion.cpp. There is no engine
  setting; the form marks those encoders "sd.cpp" and says what picking one does.
- **What it adds to `Engine.Models`** (`withSdCppModels`): those encoders, appended to the
  Qwen family's list, and the whole Iris family, which has no VAE (`vae: null`) and whose
  encoders are all GGUFs. `textEncodersFor` offers a Qwen model a GGUF encoder only when
  it is a Turbo model in a GGUF file, the one combination that is set up and was tried.
- **Two ways to sample.** A Turbo model gets `IMAGE_TURBO` whatever the job says. Iris
  gets the job's steps, CFG, sampler (`SAMPLER_NAMES` maps the form's names to the
  program's) and negative prompt.
- **Files are found by name** in the folders of `SDCPP_MODEL_DIRS`, searched with their
  subfolders (`modelFiles`). With ComfyUI's models folder in that list, both engines use
  one copy of the model and the VAE.
- **One process per job.** It loads the models, draws every image of the job and exits, so
  it holds no VRAM between jobs and `claimGpu(null)` clears the card for it first.
  Canceling kills the process.
- **Progress is read from its log**: stage lines become labels (`stageLabel`), and the
  sampler's progress bars the count. Its bars drawn with `#` are file reads and ignored.
- **No VAE tiling.** With `--vae-tiling` the decode took 16 seconds instead of 2 on a 16
  GB card, and the largest size the form offers decodes without it.
- **No cut-out copy**: that is made by ComfyUI inside the same workflow. `toImageParams`
  drops the option for these jobs and the form says so.
- **Not waited for like ComfyUI.** `runsOnComfy` is false for these jobs. Iris is listed
  and runs with ComfyUI down; the Qwen models are only known while it is up.

```sh
sdcpp/bin/sd-cli.exe --list-devices     # which GPU it will use
sdcpp/bin/sd-cli.exe --help
```

## The Python services

The voice and caption engines are each a small HTTP service in Python, with an environment
and a model folder of their own. `worker/service.ts` (`createPythonService`) is what the
worker runs them with, and what a third one would use:

- **The worker owns the process.** It starts the service for the first job that needs it
  (`start`), reuses one that already answers, and stops them all on exit (`stopServices`).
  The service is given the worker's process id and exits when that process is gone, so a
  killed worker doesn't leave a model in VRAM.
- **Don't watch stdin for that.** A thread blocked reading a stdin pipe deadlocks the
  whole service on Windows as soon as the model's libraries start a child process while
  loading. The parent is watched by process id (`exit_with_parent` in the servers), and
  the service is started with stdin closed.
- **Stopping kills the tree.** On Windows the environment's `python.exe` is a launcher
  with the real interpreter as its child; `stop` uses `taskkill /T`. Stopping is also how
  a running job is canceled.
- **A request is answered as a stream** of JSON events, one per line (`stream`), which the
  job's runner turns into progress labels and results.
- **A service can have several models.** They are the folders beside its default one
  (`TTS_MODEL_DIR`, `CAPTION_MODEL_DIR`), found by `findModelFolders` and listed in
  `Engine.Models` with the default first. The service is started with that parent folder
  (`--models-root`) and every request names the folder to use (`model`, from the job's
  params). It holds one model at a time and swaps when a job names another.
- **Every service has `GET /health`** (`{ status, loaded, device }`, answered as soon as
  Python is up, before anything heavy loads) **and `POST /unload`**, which drops the model
  and its VRAM until the next request. `claimGpu` relies on both.

## The voice engine

Voice jobs don't touch ComfyUI. `runVoiceJob` (`worker/voice.ts`) talks to
`tts/server.py`, a small HTTP service around Japanese Parler-TTS that listens on
`127.0.0.1:<TTS_PORT>`:

| Request          | Does                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /health`    | `{ status, loaded, device }`. Answers as soon as Python is up; nothing heavy is loaded yet           |
| `POST /generate` | Speaks `lines` (`{ text, file }`) with one `description` and `seed`; streams one JSON event per line |
| `POST /unload`   | Drops the model, and its VRAM, until the next `/generate`                                            |

- **Installed or not** is read from disk, by `findVoiceModels()`: the environment's
  Python, the script, and at least one model folder with weights and the two tokenizers.
  That is all `Engine.Models.voice` means; nothing is started to find out.
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
tts/.venv/Scripts/python.exe tts/server.py --models-root tts/models --output-root D:/tmp
curl -s -X POST http://127.0.0.1:8191/generate -H "Content-Type: application/json" \
  -d '{"model":"japanese-parler-tts-mini","lines":[{"text":"こんにちは。","file":"D:/tmp/a/hello.wav"}],"description":"JSUT speaks at a moderate pace in a very clear recording.","seed":1}'
```

## The caption engine

Caption jobs don't touch ComfyUI either. `runCaptionJob` (`worker/caption.ts`) talks to
`caption/server.py`, which keeps a vision-language model (Ministral 3 8B, an uncensored
fine-tune made for captioning) and listens on `127.0.0.1:<CAPTION_PORT>`:

| Request         | Does                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| `POST /caption` | Reads one `image` (a path) in a `mode` and `style`, with a `prompt`; streams JSON events |
| `GET /health`   | As above                                                                                 |
| `POST /unload`  | As above                                                                                 |

- **The result is text, so it lives on the job**: `jobs.result` (`Media.Caption`:
  `description`, `positive`, `negative`), not an `assets` row. The job's image is its one
  input, which is also its cover in the recent strip. Captions don't appear in the
  gallery, which lists assets; they have the Caption page (`/caption`), whose recent strip
  lists caption jobs only, as the studio's lists everything else.
- **Two modes** (`params.mode`). `prompts` writes a description and a positive and a
  negative prompt, and the job's prompt is optional guidance. `answer` does whatever the
  job's prompt says with the image, in plain text: the reply is stored as `description`,
  with both prompts empty. The user's text is `jobs.prompt`, as for every other kind.
- **One answer, three fields** (in `prompts` mode). The model is asked for a JSON object.
  `parse_answer` reads it, picks the fields out one by one when the JSON is broken or cut
  off, and failing that keeps the whole answer as the description.
- **The negative prompt is advice.** What to keep out can't be seen in an image; the model
  suggests what suits that kind of image. The UI says so next to it.
- **Greedy decoding with a repetition penalty.** No seed: the same image and settings give
  the same text, so there is no "Reroll". Without the penalty the model repeats its own
  sentences until the token limit.
- **FP8 weights stay FP8** (`keep_in_fp8`). PyTorch can't compute in FP8, so loading
  widens the weights to 16 bits, about 18 GB for this model. Each layer whose values
  survive the trip to FP8 and back keeps them in 8 bits and widens them only while it
  computes: about 10 GB, and nothing lost. A model stored in full precision is left as it
  loaded.
- **Any vision-language model works.** The service loads a model through transformers'
  Auto classes, so a folder with a `config.json` and weights under `caption/models` is a
  model the form can pick; its name in the UI is the folder's.
- **It only reads images** from under the folders it was started with (`--image-root`):
  Frozen's subfolders of ComfyUI's input and output directories.
- **Python packages** are in `caption/requirements.txt`. The environment is separate from
  the voice one because the two need different major versions of transformers.

```sh
caption/.venv/Scripts/python.exe caption/server.py --models-root caption/models --image-root D:/tmp
curl -s -X POST http://127.0.0.1:8192/caption -H "Content-Type: application/json" \
  -d '{"model":"Ministral-3-8B-Uncensored-FP8","image":"D:/tmp/apple.png","mode":"prompts","style":"prose","prompt":""}'
```

### Adding a kind of job

1. `Media.JobKind` and a `…Params` type in `src/types/schema.d.ts`; add it to `JOB_KINDS`
   and its labels in `constants/media.ts`.
2. A validator in `actions/jobs/validator.zod.ts`, added to `jobValidator`; a `to…Params`
   in `@/libs/job` and a branch in `createJob`.
3. What it needs installed, in `Engine.Models`: from ComfyUI in `discoverModels`, from
   elsewhere in `allModels` (`worker/engine.ts`).
4. How it runs: a builder in `comfy/graphs/` and a `case` in `processJob`, or, off
   ComfyUI, its own runner called from the top of `processJob` as `runVoiceJob` is (and
   the kind added to `runsOnComfy`). Either way it sets `control.cancel` and ends by
   inserting `assets`, or for a result that is text, by writing `jobs.result`.
5. A form in `(studio)/components/`, starting with a `ModelSelect` when the kind has
   models to choose from, mounted in `studio-forms.tsx` with its icon (or, like Caption,
   on a page of its own with a link in the header), and its result: in `job-result.tsx`,
   or a view of its own picked in `job-canvas.tsx` (`voice-result.tsx`,
   `caption-result.tsx`).
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
- **The engines take turns** (`claimGpu` in `worker/service.ts`). Before a voice or
  caption job the worker asks ComfyUI to drop its models (`freeComfyMemory`) and the other
  service to unload; before a ComfyUI job both services unload; before a
  stable-diffusion.cpp job all three do. The voice model takes about 4 GB and loads in a
  few seconds; the caption model takes about 10 GB and half a minute; ComfyUI's take
  longer to come back. Jobs of one kind in a row pay nothing.
