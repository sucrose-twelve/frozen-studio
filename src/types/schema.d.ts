declare namespace Media {
  export type JobKind = "image" | "video" | "cutout"

  export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

  export type AssetKind = "image" | "video"

  /**
   * What an asset is to its job:
   *
   * - `upload`: a reference image the user added (no job made it)
   * - `output`: the result itself, an image or a video
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
    seed: number
    shouldSaveFrames: boolean
    shouldRemoveBackground: boolean
  }

  export type CutoutParams = {
    kind: "cutout"
  }

  export type JobParams = ImageParams | VideoParams | CutoutParams
}

declare namespace Engine {
  /**
   * The model files the worker found in ComfyUI, per job kind. `null` means that kind can't run yet.
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
