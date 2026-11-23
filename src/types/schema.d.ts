declare namespace Media {
  export type JobKind = "image" | "cutout" | "voice" | "caption"

  /**
   * The kinds whose forms share the studio page. A caption job has a page of its own.
   */
  export type StudioMode = Exclude<JobKind, "caption">

  export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

  export type AssetKind = "image" | "audio"

  /**
   * What the gallery shows at a time: one kind of result, or the cutouts, which are images but are kept
   * apart from the images they were cut from.
   */
  export type GalleryKind = AssetKind | "cutout"

  /**
   * What an asset is to its job:
   *
   * - `upload`: a reference image the user added (no job made it)
   * - `output`: the result itself: an image, or one spoken line
   * - `cutout`: an image with its background removed (transparent PNG)
   */
  export type AssetRole = "upload" | "output" | "cutout"

  /**
   * Which ComfyUI directory `assets.path` is relative to.
   */
  export type AssetRoot = "input" | "output"

  export type Aspect = "1:1" | "3:4" | "2:3" | "9:16" | "4:3" | "3:2" | "16:9"

  export type ImageTier = "standard" | "large" | "extra"

  /**
   * The model families the Image form can run. Each has its own text encoder, VAE and workflow; which one
   * a model file belongs to is read from its name (`imageFamily`).
   */
  export type ImageFamily = "qwen" | "moss" | "iris"

  /**
   * What runs an image job: ComfyUI, or stable-diffusion.cpp for the files only it can read.
   */
  export type ImageEngine = "comfy" | "sdcpp"

  /**
   * Samplers offered for image jobs, by the names ComfyUI gives them.
   */
  export type ImageSampler = "euler_ancestral" | "euler" | "dpmpp_2m" | "er_sde"

  export type ImageParams = {
    kind: "image"
    model: string
    /**
     * The text encoder that reads the prompt (one of `Engine.Models.image.textEncoders`). Jobs from before
     * there was a choice have none, and run on the first one installed.
     */
    textEncoder?: string
    negative: string
    /**
     * `null` follows the first reference image, so `width` / `height` are `null` too.
     */
    aspect: Aspect | null
    tier: ImageTier
    width: number | null
    height: number | null
    count: number
    steps: number
    cfg: number
    /**
     * `null` leaves the choice to the mode (`IMAGE_DEFAULT_SAMPLERS`). Jobs from before the option existed
     * have no value at all, which means the same.
     */
    sampler?: ImageSampler | null
    /**
     * A LoRA applied to the model (one of its family's `loras`), and how strongly. `null`, or no value on
     * jobs from before the option existed, runs the model as it is.
     */
    lora?: { name: string; strength: number } | null
    seed: number
    shouldRemoveBackground: boolean
  }

  export type CutoutParams = {
    kind: "cutout"
  }

  /**
   * The families of voice model. They differ in what a description can ask for, and each is loaded and
   * spoken with in its own way; which one a model folder belongs to is read from its name (`voiceFamily`).
   */
  export type VoiceFamily = "parler" | "qwen" | "voxcpm"

  /**
   * A voice job speaks its prompt, one clip per line.
   */
  export type VoiceParams = {
    kind: "voice"
    model: string
    /**
     * The preset the description came from (`VOICE_PRESETS`), or `"custom"` when it was edited.
     */
    voice: string
    /**
     * What the model is told about the speaker. This is what shapes the voice; how much of it a model
     * takes in depends on its family.
     */
    description: string
    seed: number
  }

  /**
   * What a caption job writes about its image:
   *
   * - `prompts`: a description, and a positive and a negative prompt that ask for the image again
   * - `answer`: whatever the job's prompt asks for, as plain text
   */
  export type CaptionMode = "prompts" | "answer"

  /**
   * How a caption job writes its positive prompt: a paragraph (what Qwen-Image reads best) or a
   * list of tags.
   */
  export type CaptionStyle = "prose" | "tags"

  /**
   * A caption job has a vision-language model read its one reference image. What the user tells the model
   * is the job's prompt: an instruction to follow in `prompts` mode (optional), the thing to answer in
   * `answer` mode. It has no seed: the model decodes greedily, so the same image and settings give the same
   * text.
   */
  export type CaptionParams = {
    kind: "caption"
    model: string
    mode: CaptionMode
    /**
     * Only used in `prompts` mode.
     */
    style: CaptionStyle
  }

  export type JobParams = ImageParams | CutoutParams | VoiceParams | CaptionParams

  /**
   * What a caption job wrote. It is text, not a file, so it is kept on the job (`jobs.result`) instead of
   * as an asset.
   *
   * - `description`: what is in the image, in full sentences. For an `answer` job, the model's reply
   * - `positive`: a prompt that asks for the image again. Empty for an `answer` job
   * - `negative`: what to keep out. The model can't see this in the image; it is its advice for the kind
   *   of image, and empty when it gave none
   */
  export type Caption = {
    description: string
    positive: string
    negative: string
  }
}

declare namespace Engine {
  /**
   * What the worker found installed, per job kind: model files in ComfyUI, and the text-to-speech and
   * captioning engines beside this project. `null` means that kind can't run yet.
   */
  export type Models = {
    /**
     * The families that have everything they need, each with at least one model. `null` when none has.
     */
    image: Partial<Record<Media.ImageFamily, ImageModels>> | null
    cutout: { model: string } | null
    voice: { models: string[] } | null
    caption: { models: string[] } | null
  }

  /**
   * What one image model family has installed.
   *
   * - `textEncoders` has at least one name, and the first is the one a job gets when it names none
   * - `vae` is `null` for a family that needs none (Iris draws pixels directly)
   * - `loras` are the LoRAs made for this family that the user can pick; it is empty when there are none
   * - `editLora` is the LoRA a family needs before it can take reference images (MOSS-Image). `null`
   *   when it isn't installed, and for a family that edits without one or not at all
   */
  export type ImageModels = {
    models: string[]
    textEncoders: string[]
    vae: string | null
    loras: string[]
    editLora: string | null
  }

  /**
   * Another program holding VRAM, e.g. a game. ComfyUI can't see it on Windows and overfills the card.
   */
  export type VramUser = {
    name: string
    gigabytes: number
  }

  /**
   * How a program the worker depends on is doing:
   *
   * - `online`: it answers
   * - `loaded`: a Python service that answers and holds its model in VRAM
   * - `standby`: a Python service that isn't running; the worker starts it for the first job that needs it
   * - `offline`: it should answer and doesn't
   */
  export type ServiceState = "online" | "loaded" | "standby" | "offline"

  /**
   * One program in the header's status list, as the worker last saw it.
   */
  export type Service = {
    name: string
    state: ServiceState
    /**
     * Where it listens, e.g. `127.0.0.1:8188`.
     */
    address: string
  }

  /**
   * How much of a memory is taken, in bytes.
   */
  export type MemoryUsage = {
    used: number
    total: number
  }

  /**
   * The machine's memory as the worker last read it. `vram` is `null` when `nvidia-smi` can't be run.
   */
  export type Memory = {
    ram: MemoryUsage
    vram: MemoryUsage | null
  }

  /**
   * What the worker writes to Redis every few seconds. A missing key means the worker isn't running.
   *
   * `services` are the programs the worker reached on its last check: ComfyUI, Postgres, Redis and the
   * Python services.
   */
  export type Status = {
    isComfyOnline: boolean
    models: Models
    vramUsers: VramUser[]
    services: Service[]
    memory: Memory
    runningJobId: string | null
    queued: number
    updatedAt: number
  }

  /**
   * What a browser needs to name a job before it has loaded the job itself.
   */
  export type JobBrief = {
    id: string
    kind: Media.JobKind
    prompt: string
  }

  export type Progress = {
    label: string
    value: number
    max: number
  }

  /**
   * What `/api/events` streams to the browser.
   */
  export type Event =
    | {
        type: "job"
        id: string
        status: Media.JobStatus
        error?: string
        /**
         * Sent with `queued`, so a page can name a job it has never loaded.
         */
        brief?: JobBrief
      }
    | ({ type: "progress"; id: string } & Progress)
    | { type: "engine"; engine: Status }

  /**
   * What the app tells the worker over Redis.
   */
  export type Control = { type: "cancel"; id: string }
}
