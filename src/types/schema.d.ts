declare namespace Media {
  export type JobKind = "image" | "video" | "cutout" | "voice" | "caption"

  /**
   * The kinds whose forms share the studio page. A caption job has a page of its own.
   */
  export type StudioMode = Exclude<JobKind, "caption">

  export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

  export type AssetKind = "image" | "video" | "audio"

  /**
   * What an asset is to its job:
   *
   * - `upload`: a reference image the user added (no job made it)
   * - `output`: the result itself: an image, a video, or one spoken line
   * - `cutout`: an image with its background removed (transparent PNG)
   * - `frame`: one frame of a video, kept for sprite sheets
   * - `still`: the first frame a text-to-video job drew before animating it
   */
  export type AssetRole = "upload" | "output" | "cutout" | "frame" | "still"

  /**
   * Which ComfyUI directory `assets.path` is relative to.
   */
  export type AssetRoot = "input" | "output"

  export type Aspect = "1:1" | "3:4" | "2:3" | "9:16" | "4:3" | "3:2" | "16:9"

  export type ImageTier = "standard" | "large" | "extra"

  /**
   * Samplers offered for image jobs, by the names ComfyUI gives them.
   */
  export type ImageSampler = "euler_ancestral" | "euler" | "dpmpp_2m" | "er_sde"

  export type VideoResolution = 480 | 720

  export type ImageParams = {
    kind: "image"
    model: string
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
    seed: number
    shouldRemoveBackground: boolean
  }

  export type VideoParams = {
    kind: "video"
    /**
     * Which pair of Wan files runs the job (`Engine.VideoModel.name`). Jobs from before there was a choice
     * have none, and run on the first pair installed.
     */
    model?: string
    seconds: number
    resolution: VideoResolution
    /**
     * Used when there is no reference image; otherwise the first reference decides the shape.
     */
    aspect: Aspect
    /**
     * The image model that draws the first frame of a text-to-video job, `null` with references.
     */
    imageModel: string | null
    isStaticCamera: boolean
    isLoop: boolean
    isFast: boolean
    steps: number
    cfg: number
    /**
     * What to keep out of the video, on top of the list Wan always gets (`WAN_NEGATIVE_PROMPT`). Without
     * effect in fast mode, which runs at CFG 1. Jobs from before the option existed have no value.
     */
    negative?: string
    seed: number
    shouldSaveFrames: boolean
    shouldRemoveBackground: boolean
  }

  export type CutoutParams = {
    kind: "cutout"
  }

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
     * What the model is told about the speaker, in English. This is what shapes the voice.
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
   * How a caption job writes its positive prompt: a paragraph (what Qwen-Image and Wan read best) or a
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

  export type JobParams =
    ImageParams | VideoParams | CutoutParams | VoiceParams | CaptionParams

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
    image: { models: string[]; textEncoder: string; vae: string } | null
    video: {
      models: VideoModel[]
      textEncoder: string
      vae: string
      fastHighNoise: string | null
      fastLowNoise: string | null
    } | null
    cutout: { model: string } | null
    voice: { models: string[] } | null
    caption: { models: string[] } | null
  }

  /**
   * Wan 2.2 comes as two files that work in turn: the high-noise model lays out the motion, the low-noise
   * model draws the detail. One pair is one choice in the Video form, named after what the two file names
   * share.
   */
  export type VideoModel = {
    name: string
    highNoise: string
    lowNoise: string
  }

  /**
   * Another program holding VRAM, e.g. a game. ComfyUI can't see it on Windows and overfills the card.
   */
  export type VramUser = {
    name: string
    gigabytes: number
  }

  /**
   * What the worker writes to Redis every few seconds. A missing key means the worker isn't running.
   */
  export type Status = {
    isComfyOnline: boolean
    models: Models
    vramUsers: VramUser[]
    runningJobId: string | null
    queued: number
    updatedAt: number
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
    | { type: "job"; id: string; status: Media.JobStatus; error?: string }
    | ({ type: "progress"; id: string } & Progress)
    | { type: "engine"; engine: Status }

  /**
   * What the app tells the worker over Redis.
   */
  export type Control = { type: "cancel"; id: string }
}
