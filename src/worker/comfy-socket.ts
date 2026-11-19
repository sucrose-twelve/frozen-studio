import { randomUUID } from "node:crypto"

import { comfySocketUrl, readHistory, type ComfyHistory } from "@/libs/comfy/client"

/**
 * The run was stopped on request (`execution_interrupted`), not by a failure.
 */
export class CanceledError extends Error {}

type ComfyMessage = {
  type: string
  data?: {
    prompt_id?: string
    node?: string | null
    value?: number
    max?: number
    exception_type?: string
    exception_message?: string
  }
}

type Watcher = {
  promptId: string
  onNode: (nodeId: string) => void
  onProgress: (nodeId: string | null, value: number, max: number) => void
  settle: (error: Error | null) => void
}

/**
 * How often a run's history is checked in case a websocket message was missed, and how many checks in a row
 * may fail before ComfyUI is taken for gone.
 */
const POLL_MS = 3_000
const MAX_FAILED_POLLS = 10

/**
 * How many times, and how far apart, the record of a finished run is asked for before giving up on it.
 */
const HISTORY_ATTEMPTS = 12
const HISTORY_RETRY_MS = 300

/**
 * ComfyUI's websocket identifies each listener by a client id, and sends a run's events to the client that
 * queued it.
 */
export const clientId = randomUUID()

let socket: WebSocket | null = null
let watcher: Watcher | null = null

function handleMessage(event: MessageEvent) {
  // Binary frames are latent previews, which the worker doesn't use
  if (typeof event.data !== "string" || !watcher) return

  let message: ComfyMessage
  try {
    message = JSON.parse(event.data)
  } catch {
    return
  }

  const data = message.data
  if (!data || data.prompt_id !== watcher.promptId) return

  switch (message.type) {
    case "executing":
      if (data.node) watcher.onNode(data.node)
      break
    case "progress":
      watcher.onProgress(data.node ?? null, data.value ?? 0, data.max ?? 0)
      break
    case "execution_success":
      watcher.settle(null)
      break
    case "execution_interrupted":
      watcher.settle(new CanceledError("Canceled"))
      break
    case "execution_error":
      watcher.settle(new Error(describeFailure(data)))
      break
  }
}

function describeFailure(data: { exception_type?: string; exception_message?: string }) {
  const text = [data.exception_type, data.exception_message?.trim()]
    .filter(Boolean)
    .join(": ")
  return text || "ComfyUI reported an error"
}

/**
 * Opens the websocket and keeps it open: a closed socket (ComfyUI restarted) reconnects after a pause.
 * Progress is a nicety on top of the history polling in `watchPrompt`, so nothing waits on this.
 */
export function connectComfySocket() {
  const open = () => {
    socket = new WebSocket(comfySocketUrl(clientId))
    socket.addEventListener("message", handleMessage)
    socket.addEventListener("close", () => setTimeout(open, 3_000))
    socket.addEventListener("error", () => socket?.close())
  }

  open()
}

/**
 * How a finished run ended, read from its history record.
 */
function outcomeOf(history: ComfyHistory) {
  const status = history.status
  if (!status) return null
  if (status.completed) return { error: null }
  if (status.status_str !== "error") return null

  const messages = status.messages ?? []
  if (messages.some(([type]) => type === "execution_interrupted")) {
    return { error: new CanceledError("Canceled") }
  }

  const failure = messages.find(([type]) => type === "execution_error")?.[1]
  return {
    error: new Error(failure ? describeFailure(failure) : "ComfyUI reported an error")
  }
}

/**
 * The record of a run that has just ended.
 *
 * ComfyUI announces the end over the websocket a moment before it files the record, so a read made right
 * away can come up empty. It is there within a few hundred milliseconds; this allows a few seconds.
 */
async function readFinishedHistory(promptId: string) {
  for (let attempt = 0; attempt < HISTORY_ATTEMPTS; attempt++) {
    const history = await readHistory(promptId).catch(() => null)
    if (history) return history

    await new Promise((resolve) => setTimeout(resolve, HISTORY_RETRY_MS))
  }

  return null
}

/**
 * Waits for a queued run to end, reporting its progress on the way.
 *
 * The websocket gives the live events; the run's history is polled as well, so a missed message or a dropped
 * socket can't leave the job hanging.
 *
 * @param promptId - The id `queuePrompt` returned
 * @param onNode - A node started running
 * @param onProgress - A sampler step (or another counted step) finished
 * @returns The run's history record
 * @throws {CanceledError} When the run was interrupted
 * @throws {Error} When the run failed, or ComfyUI stopped answering
 */
export function watchPrompt(
  promptId: string,
  onNode: Watcher["onNode"],
  onProgress: Watcher["onProgress"]
) {
  return new Promise<ComfyHistory>((resolve, reject) => {
    let isSettled = false
    let failedPolls = 0

    const finish = async (error: Error | null) => {
      if (isSettled) return
      isSettled = true
      clearInterval(poll)
      watcher = null

      if (error) return reject(error)

      const history = await readFinishedHistory(promptId)
      if (history) resolve(history)
      else reject(new Error("ComfyUI finished the run but has no record of it"))
    }

    const poll = setInterval(async () => {
      try {
        const history = await readHistory(promptId)
        failedPolls = 0

        const outcome = history ? outcomeOf(history) : null
        if (outcome) void finish(outcome.error)
      } catch {
        failedPolls += 1
        if (failedPolls >= MAX_FAILED_POLLS) {
          void finish(new Error("ComfyUI stopped responding during the run"))
        }
      }
    }, POLL_MS)

    watcher = { promptId, onNode, onProgress, settle: (error) => void finish(error) }
  })
}
