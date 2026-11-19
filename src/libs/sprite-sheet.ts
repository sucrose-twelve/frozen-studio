/**
 * What a sprite sheet's README says about it. Everything a game engine needs to slice and play the sheet.
 */
export type SpriteSheetInfo = {
  /**
   * The base name of the exported files, without an extension.
   */
  name: string
  frames: number
  /**
   * Playback speed in frames per second. A fraction when every third frame of a 16 fps video is kept.
   */
  fps: number
  columns: number
  rows: number
  frameWidth: number
  frameHeight: number
  hasAlpha: boolean
  /**
   * Which frames of the video the sheet was built from.
   */
  source: { fps: number; every: number; start: number }
  /**
   * The file name of the animated preview, or `null` when the browser couldn't record one.
   */
  preview: string | null
}

/**
 * The previews are for a quick look, not for use in a game: the long side is capped.
 */
const PREVIEW_MAX_SIDE = 512

const PREVIEW_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]

/**
 * A number with at most two decimals and no trailing zeros: `8`, `5.33`.
 */
function formatNumber(value: number) {
  return String(Number(value.toFixed(2)))
}

function ordinal(value: number) {
  const tens = value % 100
  const suffix =
    tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th")

  return `${value}${suffix}`
}

/**
 * The README that travels with an exported sprite sheet: the numbers as a table, how to set it up in Godot
 * and Unity, the arithmetic for anything else, and the same numbers as JSON for a script to read.
 */
export function describeSpriteSheet(info: SpriteSheetInfo) {
  const { name, frames, columns, rows, frameWidth, frameHeight } = info
  const fps = formatNumber(info.fps)
  const frameMs = formatNumber(1_000 / info.fps)
  const emptyCells = columns * rows - frames
  const lastFrame = frames - 1
  const kept =
    info.source.every === 1 ? "every frame" : `every ${ordinal(info.source.every)} frame`

  const table = [
    ["Sheet", `\`${name}.png\` (${columns * frameWidth} × ${rows * frameHeight} px)`],
    ...(info.preview ? [["Preview", `\`${info.preview}\``]] : []),
    ["Frames", String(frames)],
    ["Speed", `${fps} fps (${frameMs} ms per frame)`],
    ["Length", `${formatNumber(frames / info.fps)} s`],
    ["Grid", `${columns} columns × ${rows} rows`],
    ["Frame size", `${frameWidth} × ${frameHeight} px`],
    ["Order", "Left to right, then top to bottom"],
    [
      "Empty cells",
      emptyCells === 0 ? "None" : `${emptyCells}, at the end of the last row`
    ],
    ["Background", info.hasAlpha ? "Transparent" : "Opaque"],
    [
      "Source",
      `${kept} of a ${formatNumber(info.source.fps)} fps video, from frame ${info.source.start}`
    ]
  ]

  const data = {
    image: `${name}.png`,
    frames,
    fps: Number(info.fps.toFixed(4)),
    frameDurationMs: Number((1_000 / info.fps).toFixed(2)),
    columns,
    rows,
    frameWidth,
    frameHeight
  }

  return [
    `# ${name}`,
    "",
    "A sprite sheet exported from Frozen.",
    "",
    "| Property | Value |",
    "| --- | --- |",
    ...table.map(([property, value]) => `| ${property} | ${value} |`),
    "",
    "## Godot 4",
    "",
    `**AnimatedSprite2D**: in the SpriteFrames editor choose *Add frames from sprite sheet*, pick \`${name}.png\`, set Horizontal to ${columns} and Vertical to ${rows}, select the first ${frames} frames and add them. Set the animation's speed to ${fps} FPS.`,
    "",
    `**Sprite2D**: set \`hframes = ${columns}\` and \`vframes = ${rows}\`, then animate \`frame\` from 0 to ${lastFrame} at ${fps} fps.`,
    "",
    "## Unity",
    "",
    `Set the texture's Sprite Mode to Multiple and slice it in the Sprite Editor with Grid By Cell Size, ${frameWidth} × ${frameHeight}. Use the first ${frames} sprites in an animation clip with a sample rate of ${fps}.`,
    "",
    "## Anything else",
    "",
    `Frame \`i\`, counting from 0, is the ${frameWidth} × ${frameHeight} rectangle at \`x = (i % ${columns}) * ${frameWidth}\`, \`y = floor(i / ${columns}) * ${frameHeight}\`. Show each frame for ${frameMs} ms.`,
    "",
    "```json",
    JSON.stringify(data, null, 2),
    "```",
    ""
  ].join("\n")
}

/**
 * Records frames as a short WebM that plays at `fps`, for the preview that goes with a sprite sheet.
 *
 * The browser's recorder works in real time, so this takes as long as the animation lasts: every frame is
 * drawn, handed to the recorder, and left on screen for its share of a second.
 *
 * @param frames - The frames in order, all of one size
 * @param size - The size of one frame on the sheet; the preview is scaled down from it when large
 * @returns The video, or `null` when this browser can't record a canvas as WebM
 */
export async function recordPreview(
  frames: HTMLImageElement[],
  size: { width: number; height: number },
  fps: number
) {
  if (typeof MediaRecorder === "undefined" || frames.length === 0) return null

  const mimeType = PREVIEW_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!mimeType || !context || !("captureStream" in canvas)) return null

  // Video encoders want even sides
  const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(size.width, size.height))
  canvas.width = Math.max(2, Math.round((size.width * scale) / 2) * 2)
  canvas.height = Math.max(2, Math.round((size.height * scale) / 2) * 2)

  // A rate of 0 means a frame is captured only when asked for, so each one is captured exactly once
  const stream = canvas.captureStream(0)
  const [track] = stream.getVideoTracks() as CanvasCaptureMediaStreamTrack[]
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()
  for (const frame of frames) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(frame, 0, 0, canvas.width, canvas.height)
    track.requestFrame()
    await new Promise((resolve) => setTimeout(resolve, 1_000 / fps))
  }
  recorder.stop()
  await stopped
  stream.getTracks().forEach((item) => item.stop())

  return new Blob(chunks, { type: "video/webm" })
}

/**
 * Hands a file made in the browser to the user as a download.
 */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  // The download reads the URL after the click returns, so it is freed a little later
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}
