# The engine — jobs, queue, worker, ComfyUI, voice, caption, chat

```
Browser ──► Next.js app ──► Postgres   jobs, assets, job_inputs
   ▲            │  ▲
   │ SSE        │  └────── Redis       frozen:queue · frozen:engine · frozen:events · frozen:control
   └────────────┘             ▲
                              │            ┌──► ComfyUI ──────────► images, cutouts
                              │            ├──► sdcpp/ (sd-cli) ──► images: GGUF text encoders, Iris
                           Worker ─────────┼──► tts/server.py ────► voice clips
                                           ├──► caption/server.py ► descriptions and prompts
                                           └──► chat/ llama-server ► chat replies
```

Two processes share this repo:

- The **app** (Next.js) validates input, writes rows, pushes job ids to Redis and reads
  results. It never calls an engine.
- The **worker** (`bun run worker` → `tests/worker.spec.ts` → `src/worker/`) is the only
  client of the engines. It runs one job at a time: one GPU, and the models don't fit side
  by side.

And five engines do the generating:

- **ComfyUI**, for image and cutout jobs. It is a separate program, started by hand or by
  `launcher/Frozen.ps1`; the worker waits for it and never starts or stops it.
- **stable-diffusion.cpp** (`sdcpp/bin/sd-cli.exe`), for the image jobs ComfyUI can't run:
  those with a text encoder that comes as a GGUF, which includes every Iris job. The
  worker runs it once per job. See [stable-diffusion.cpp](#stable-diffusioncpp).
- The **voice service** (`tts/server.py`), for voice jobs. It belongs to this project: the
  worker starts it when the first voice job arrives and stops it when it exits. See
  [the voice engine](#the-voice-engine).
- The **captioning service** (`caption/server.py`), for caption jobs, owned by the worker
  in the same way. See [the caption engine](#the-caption-engine).
- **llama.cpp's server** (`chat/bin/llama/llama-server.exe`), for chat replies, also owned
  by the worker. See [the chat engine](#the-chat-engine).

There is exactly one worker. A second one refuses to start while the first is alive (it
watches whether the status in Redis keeps getting newer), since it would run a second job
on the same GPU and fail the first worker's job as interrupted.

Postgres is the record; Redis is the transport. If they disagree, Postgres wins (see
[recovery](#recovery)).

## Redis

All names are in `REDIS_KEYS` (`@/constants`) and prefixed `frozen:`.

| Name             | Type    | Written by | Read by  | Holds                                                                                             |
| ---------------- | ------- | ---------- | -------- | ------------------------------------------------------------------------------------------------- |
| `frozen:queue`   | list    | app        | worker   | Job ids. `LPUSH` to add, `BRPOP` to take, `LREM` to drop. A chat reply is `RPUSH`ed, to the front |
| `frozen:engine`  | string  | worker     | app      | JSON `Engine.Status`, rewritten every 4 s with a 15 s TTL                                         |
| `frozen:events`  | pub/sub | worker/app | browsers | JSON `Engine.Event`, relayed by `/api/events`                                                     |
| `frozen:control` | pub/sub | app        | worker   | JSON `Engine.Control` (`{ type: "cancel", id }`)                                                  |

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

Every change is published as `{ type: "job", id, status, error? }`. A chat reply also
publishes its text so far as `{ type: "chat", id, messageId, text }`.

### Queueing a job

`createJob` (`actions/jobs/create.ts`):

1. Parses the form with `jobValidator` (a union on `kind`).
2. Turns the form into stored **params** (`toImageParams` / `toVoiceParams` /
   `toCaptionParams` in `@/libs/job`): resolves the pixel size, picks a random seed when
   none was given, and drops options the engine can't honour (a cutout copy on
   stable-diffusion.cpp).
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

| File        | Builds                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `image.ts`  | `addImage`, on the model's family: Qwen-Image 2.1 (text to image, an edit with references, a Turbo build on its fixed schedule) or MOSS-Image (text to image, an edit with its edit LoRA). Optional LoRA and cutout copy |
| `cutout.ts` | BiRefNet background removal for one image                                                                                                                                                                                |

Rules that keep them honest:

- **The model is the job's choice.** Each form starts with a `ModelSelect` over what
  `Engine.Models` lists for its kind, and the pick is stored in the job's params
  (`params.model`). The Image form has a second one for the text encoder
  (`params.textEncoder`), since more than one build of it can be installed.
- **The Image form runs more than one family** (`Media.ImageFamily`: Qwen-Image 2.1,
  MOSS-Image, Iris). A file's family is read from its name (`imageFamily` in
  `@/libs/image-model`), `Engine.Models.image` lists each family's models, text encoders,
  VAE and LoRAs, and `IMAGE_FAMILY_SAMPLING` holds how each is sampled and whether it can
  edit. Picking a model of another family resets the form's sampling to that family's. The
  order of `IMAGE_FAMILIES` is the order of the Model list, so its first installed family
  is the default: what the form starts on. A new family needs: its patterns in
  `discoverModels`, an entry in those constants, and an `add…Image` builder that
  `addImage` dispatches to. One that runs on stable-diffusion.cpp instead is found in
  `withSdCppModels` and given its arguments in `runSdCppJob`.
- **A model that runs one way only says so in code, not in the form's values.** A Turbo
  image model (`isTurboImageModel`, by file name) always gets `IMAGE_TURBO`: the builder
  ignores the job's steps, CFG and sampler, `toImageParams` stores what really ran, and
  the form shows those settings disabled. It can't edit (`canEditImages`), so the form and
  `createJob` both refuse references with it.
- **Editing is the family's to describe** (`editing` in `IMAGE_FAMILY_SAMPLING`): built in
  (Qwen-Image), through an edit LoRA (MOSS-Image, `Engine.ImageModels.editLora`), or not
  at all. The edit LoRA is found by `discoverModels` and added by the builder itself; it
  is not one of the LoRAs the form offers. A family whose edits are sampled differently
  says so too (`edit`), and the form swaps those settings in and out with the first and
  the last reference (`imageSamplingDefaults`).
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
- **Sizes are computed in one place** (`IMAGE_SIZES` in `@/constants/media.ts`) and used
  by both the form's summary line and the builder, so the UI never promises what the
  workflow doesn't do.
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
  encoders are all GGUFs. `textEncodersFor` pairs a Turbo model in a GGUF file with the
  GGUF encoders and nothing else (ComfyUI's only when there are none), and gives every
  other Qwen model ComfyUI's encoders.
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
`tts/server.py`, a small HTTP service around the voice models that listens on
`127.0.0.1:<TTS_PORT>`:

| Request          | Does                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /health`    | `{ status, loaded, device }`. Answers as soon as Python is up; nothing heavy is loaded yet           |
| `POST /generate` | Speaks `lines` (`{ text, file }`) with one `description` and `seed`; streams one JSON event per line |
| `POST /unload`   | Drops the model, and its VRAM, until the next `/generate`                                            |

- **Two families of model** (`Media.VoiceFamily`, read from the folder's name by
  `voiceFamily`): VoxCPM2 (the default) and Qwen3-TTS VoiceDesign. Each is an `Engine`
  class in `server.py` (how it loads, how it speaks a line), and a request names the one
  its model needs (`engine`). Both run from one Python environment, `tts/.venv-design`
  (`TTS_PYTHON`).
- **GPU or CPU** (`TTS_DEVICE`, passed as `--device`): `cuda` loads on the GPU when there
  is one, `cpu` keeps the models in RAM. The service on the CPU is created with
  `onGpu: false`, so `claimGpu` leaves it out both ways: it neither unloads the chat or
  ComfyUI models before a voice job nor is unloaded by them. On the CPU, VoxCPM2 runs in
  float32 (`VoxCpmEngine.load` wraps the library's `pick_runtime_dtype`): the checkpoint's
  bfloat16 was 1.8× slower on the owner's i7-14700F and drifted into retried lines. A line
  of about 4 s took VoxCPM2 4–5 s on the GPU and 27–30 s on that CPU; Qwen3-TTS 7–12 s on
  the GPU and 23 s on the CPU.
- **Installed or not** is read from disk, by `findVoiceModels()`: the script, and every
  environment's Python, and every model folder that holds its family's files (`IS_MODEL`).
  That is all `Engine.Models.voice` means; nothing is started to find out.
- **The worker owns the process.** It starts the service for the first voice job (`start`
  of `createPythonService`), reuses one that already answers, and stops it on exit. The
  service is given the worker's process id and exits when that process is gone, so a
  killed worker doesn't leave the model in VRAM.
- **Don't watch stdin for that.** A thread blocked reading a stdin pipe deadlocks the
  whole service on Windows as soon as the model's libraries start a child process while
  loading. The parent is watched by process id (`exit_with_parent` in `server.py`), and
  the service is started with stdin closed.
- **Stopping kills the tree.** On Windows the environment's `python.exe` is a launcher
  with the real interpreter as its child; its `stop` uses `taskkill /T`. Stopping is also
  how a running voice job is canceled.
- **Events** from `/generate` (`loading`, `line`, `saved`, `done`, `error`) become
  progress labels ("Loading the voice model", "Speaking · 2 / 5") and, for `saved`, an
  `assets` row of kind `audio`.
- **The voice** is not a speaker id. The model is told what the speaker sounds like
  (`params.description`), and the presets in `VOICE_PRESETS` are such descriptions, in
  plain words; both families make a voice up from them. The form's advice per family is
  `VOICE_FAMILY_NOTES`.
- **One job, one speaker.** Every line gets the same seed, but a voice made up twice from
  one description is two voices, so VoxCPM2 only designs the first line and clones its
  clip for the rest (`VoxCpmEngine`); Qwen3-TTS would need its cloning model for that,
  which isn't set up, and its lines can differ a little.
- **The text** goes in as it is. Qwen3-TTS is told the script is Japanese; VoxCPM2 works
  the language out. Each clip is normalised to one peak level.
- **Python packages** are in `tts/requirements.txt`, with the reason next to each pin that
  isn't obvious. PyTorch must be the CUDA 12.8 build for RTX 50-series cards.

A request can be tried by hand, with the service started in a terminal:

```sh
tts/.venv-design/Scripts/python.exe tts/server.py --models-root tts/models --output-root D:/tmp
curl -s -X POST http://127.0.0.1:8191/generate -H "Content-Type: application/json" \
  -d '{"model":"VoxCPM2","engine":"voxcpm","lines":[{"text":"こんにちは。","file":"D:/tmp/a/hello.wav"}],"description":"A calm woman with a warm voice.","seed":1}'
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

## The chat engine

A chat reply is a job of kind `chat`, queued by the Chat page's actions
(`app/(studio)/chat/actions/create.ts`), not by `createJob`. The app saves the user's
message and an **empty assistant message**, then a job whose params name the chat and that
message (`Media.ChatParams`), and `RPUSH`es it so it runs next: someone is waiting for it.
One reply at a time per chat; the actions refuse a second.

`runChatJob` (`worker/chat.ts`) talks to `llama-server`, which `worker/llama.ts` runs:

- **One process, one model.** It is started with
  `--model <file> --ctx-size CHAT_CONTEXT --parallel 1 --flash-attn on`, every layer on
  the GPU. A job that names another model restarts it; `unload` stops it (a 10 GB model
  reads back from disk in a few seconds). It is in the same registry as the Python
  services (`registerService`), so `claimGpu` clears the card for it, other jobs make it
  let go, and the header lists it.
- **It can't watch the worker's process.** Its pid is kept in
  `chat/bin/llama/llama-server.pid`, and the next start (or `stop`) kills a server a
  killed worker left behind. The launcher's Quit stops anything running from `chat/`.
- **The prompt is built in the worker** (`@/libs/chat-prompt`): the card section by
  section (`chatSystemText`), then the conversation path (`messagePath` in `@/libs/chat`)
  up to the reply's parent, with `{{char}}` / `{{user}}` filled in. Its format follows the
  model's name (`chatFormat`): ChatML for Qwen, ending on an empty `<think>` block so
  Qwen3 answers without reasoning first; Mistral's `[INST]` turns for Mistral Nemo builds,
  with the system text inside the first `[INST]` (Rocinante's card says not to use
  `[SYSTEM_PROMPT]`); anything else through the file's own template (`/apply-template`).
  The two hand-written formats were tested with a Thai card; don't fold them into the
  template path.
- **The context is a budget.** Tokens are counted by the server (`/tokenize`). Past
  `CHAT_SUMMARY.triggerShare` of it (the context less `maxTokens`), the reply first has
  the chat model **summarize the older turns** (`summarize` in `worker/chat.ts`,
  `summarySystemText`): the summary so far plus the turns after it become one new summary,
  saved on the last turn it covers (`chat_messages.summary`), and the newest turns stay
  word for word: `keepShare` of the room the card leaves under the trigger. The prompt
  carries the newest summary on the branch as "The story so far" in the system text and
  the turns after its message. The job reports "Summarizing the story so far" while it
  writes (a few seconds). If the prompt still doesn't fit, the oldest turns are dropped,
  never the card or the first turn left. The Chat page shows the summary in its right
  panel, where it can be edited (`updateStory`); editing a message clears the summaries on
  it and under it.
- **Streaming.** `/completion` with `stream: true`. Every `CHAT_STREAM_INTERVAL_MS` the
  text so far goes out as a `chat` event (the whole text, so a page that opens mid-reply
  catches up), and every `CHAT_SAVE_INTERVAL_MS` it is written to the message, so a worker
  that dies loses little.
- **Stopping** aborts the request; the server and its model stay. The reply keeps what was
  written, and the job ends `canceled`.
- **Sampling** is the chat's (`chats.settings`), copied into the job's params:
  temperature, min-p (top-p and top-k off), a light repeat penalty, and DRY.
- **Against replies that copy the last one.** At temperature 0.7 Qwen3 began copying its
  previous reply from about the fifth turn (same opening, the user's words echoed back,
  same closing line). Three things stop it, all tested together: DRY looks back
  `CHAT_DRY.range` tokens (llama-server's default of 64 is less than a paragraph of Thai),
  the default temperature is 0.85, and the system text ends with a "How to reply" rule
  (`chatSystemText`). DRY over the whole context broke Thai spelling and names the
  character had to recall, so the range stays at a few replies and runs under
  `CHAT_DRY.allowedLength` tokens go free. Don't add names to DRY's sequence breakers: a
  paragraph with the name in it then repeats unchecked.

```sh
chat/bin/llama/llama-server.exe --model chat/models/<file>.gguf --n-gpu-layers 99 --ctx-size 16384 --port 8194
curl -s http://127.0.0.1:8194/completion -d '{"prompt":"Hello","n_predict":16}'
```

### Spoken messages

A **speech job** (`kind: "speech"`, `worker/speech.ts`) says a chat message aloud in its
character's voice, or, with `messageId` null, makes the character's **voice sample**. The
voice is set in the character editor (`characters.voice`: model, description, language,
seed, sample). Both kinds are `RPUSH`ed like a reply.

- **What is spoken** is the dialogue only (`dialogueOf` in `@/libs/chat`: the parts in
  quotes, or the text less its `*actions*`). When the character speaks Japanese and the
  dialogue has no kana, the **chat model translates it** (`translationSystemText`, low
  temperature), so the job claims the GPU for llama first and the voice model after. The
  text that was spoken is kept on the message (`speech_text`) and shown under the player.
- **One voice.** The sample is made up once from the description (a new seed each time);
  every message after it is spoken by **cloning the sample** (`reference` in
  `tts/server.py`). Only VoxCPM2 clones; the other families make a voice up per message. A
  new sample replaces the old one and deletes the old clip.
- **One clip per message.** The lines (`speechLines`, at most `SPEECH_MAX_LINE_LENGTH`
  characters, cut at sentence ends) are written into one file (`joined`), a short pause
  apart: `<output>/frozen/<jobId>/speech.wav`. It is an asset of the speech job, kept out
  of the gallery (`readGallery` skips speech jobs).
- **Cleanup.** Editing a message drops its clip (`deleteSpeech`); deleting messages, a
  chat or a character deletes their speech jobs and clips.
- **Timing, measured:** a sample took 53 s the first time (VoxCPM2 loading); a
  300-character Japanese line took about 70 s: a few seconds to translate (Qwen3-14B
  reloading) and about one second of compute per second of audio. The next reply then
  reloads the chat model.

Chat and speech jobs (`CHAT_JOB_KINDS`) stay out of the studio's job UI: no toast
(`job-toasts.tsx` skips them), no refresh of other pages when one ends (`job-events.tsx`),
no recent strip and no gallery. A failed reply or speech shows its error on its message.

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
6. The gallery and the recent strip, when the result isn't a picture: the gallery shows
   one kind at a time (`GALLERY_KINDS`), pictures as a grid of tiles, voice clips as a
   list of the rows the studio shows them in (`voice-clip.tsx`).

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
- Asset **kinds**: `image`, `audio`. An audio asset has no pixel size; its `width` and
  `height` are 0, and its `position` is the line of the script it speaks.
- Asset **roles**: `upload` (a reference), `output` (the result), `cutout` (its
  transparent copy).
- Deleting a job removes its rows (assets cascade) and its folder. Uploads stay: other
  jobs may use them.
- The voice service only writes under the folder it was started with (`--output-root`).

## The GPU

- The worker reports which other programs hold VRAM (`worker/gpu.ts`, a Windows
  performance counter read through PowerShell). From 1 GB up the header warns: with a game
  open, the models spill into shared memory and a job that takes a minute takes ten.
- **The engines take turns** (`claimGpu` in `worker/service.ts`). Before a voice, caption
  or chat job the worker asks ComfyUI to drop its models (`freeComfyMemory`) and the other
  services to unload; before a ComfyUI job they all unload; before a stable-diffusion.cpp
  job everything does. The voice model takes about 4 GB and loads in a few seconds; the
  caption model takes about 10 GB and half a minute; a chat model 13–14 GB with its
  context, and a few seconds; ComfyUI's take longer to come back. Jobs of one kind in a
  row pay nothing. A service with `onGpu: false` (the voice with `TTS_DEVICE=cpu`) takes
  no part.
