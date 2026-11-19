declare namespace Media {
  export type JobKind = "image" | "video" | "cutout" | "voice"

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

  export type JobParams = ImageParams | VideoParams | CutoutParams | VoiceParams
}

declare namespace Engine {
  /**
   * What the worker found installed, per job kind: model files in ComfyUI, and the text-to-speech engine
   * beside this project. `null` means that kind can't run yet.
   */
  export type Models = {
    image: { models: string[]; textEncoder: string; vae: string } | null
    video: {
      highNoise: string
      lowNoise: string
      textEncoder: string
      vae: string
      fastHighNoise: string | null
      fastLowNoise: string | null
    } | null
    cutout: { model: string } | null
    voice: { model: string } | null
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
