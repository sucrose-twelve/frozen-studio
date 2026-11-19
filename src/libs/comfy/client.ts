import { COMFY } from "@/constants/env"

export type ComfyGraph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

/**
 * A file ComfyUI wrote, as its history lists it. `subfolder` is relative to the output directory.
 */
export type ComfyFile = {
  filename: string
  subfolder: string
  type: string
}

export type ComfyHistory = {
  status?: {
    status_str: string
    completed: boolean
    messages?: [string, Record<string, unknown>][]
  }
  outputs?: Record<string, Record<string, unknown>>
}

type QueueResponse = {
  prompt_id?: string
  error?: { message?: string; details?: string }
  node_errors?: Record<
    string,
    { class_type?: string; errors?: { message?: string; details?: string }[] }
  >
}

/**
 * A request ComfyUI answered with an error, e.g. a workflow it refused to queue.
 */
export class ComfyError extends Error {}

async function request(pathname: string, init?: RequestInit, timeoutMs = 15_000) {
  return fetch(`${COMFY.url}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  })
}

async function post(pathname: string, body: unknown) {
  return request(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
}

/**
 * Turns ComfyUI's validation answer into one readable message: the summary, then each node's complaint.
 */
function describeQueueError(response: QueueResponse) {
  const lines: string[] = []
  if (response.error?.message) {
    lines.push(
      [response.error.message, response.error.details].filter(Boolean).join(": ")
    )
  }

  for (const [nodeId, node] of Object.entries(response.node_errors ?? {})) {
    for (const error of node.errors ?? []) {
      const text = [error.message, error.details].filter(Boolean).join(": ")
      lines.push(`[${node.class_type ?? nodeId}] ${text}`)
    }
  }

  return lines.join("\n") || "ComfyUI refused the workflow"
}

export async function isComfyOnline() {
  try {
    const response = await request("/system_stats", undefined, 2_500)
    return response.ok
  } catch {
    return false
  }
}

/**
 * The choices of a node's combo input, which for loader nodes is the list of installed model files.
 *
 * @param nodeClass - A ComfyUI node class, e.g. `"VAELoader"`
 * @param input - The combo input's name, e.g. `"vae_name"`
 * @returns The file names, or an empty list when the node isn't installed
 */
export async function readComboOptions(nodeClass: string, input: string) {
  const response = await request(`/object_info/${encodeURIComponent(nodeClass)}`)
  if (!response.ok) return []

  const info = (await response.json()) as Record<
    string,
    { input?: Record<string, Record<string, unknown[]>> }
  >
  const inputs = info[nodeClass]?.input
  const spec = inputs?.required?.[input] ?? inputs?.optional?.[input]
  if (!spec) return []

  // Older nodes list the choices first; newer ones say "COMBO" and put them in the options object
  if (Array.isArray(spec[0])) return spec[0] as string[]
  const options = (spec[1] as { options?: string[] } | undefined)?.options
  return options ?? []
}

/**
 * Queues a workflow.
 *
 * @param graph - The workflow in ComfyUI's API format
 * @param clientId - The websocket client that should receive this run's progress
 * @returns ComfyUI's prompt id
 * @throws {ComfyError} When ComfyUI rejects the workflow
 */
export async function queuePrompt(graph: ComfyGraph, clientId: string) {
  const response = await post("/prompt", { prompt: graph, client_id: clientId })
  const body = (await response.json().catch(() => ({}))) as QueueResponse
  if (!response.ok || !body.prompt_id) throw new ComfyError(describeQueueError(body))

  return body.prompt_id
}

/**
 * The record of a finished run, or `null` while it is still queued or running.
 */
export async function readHistory(promptId: string) {
  const response = await request(`/history/${promptId}`)
  if (!response.ok) return null

  const history = (await response.json()) as Record<string, ComfyHistory>
  return history[promptId] ?? null
}

/**
 * Stops a run: takes it off ComfyUI's queue if it hasn't started, and interrupts it if it has.
 */
export async function cancelPrompt(promptId: string) {
  await post("/queue", { delete: [promptId] }).catch(() => null)
  await post("/interrupt", { prompt_id: promptId }).catch(() => null)
}

export function comfySocketUrl(clientId: string) {
  const url = new URL(COMFY.url)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws"
  url.searchParams.set("clientId", clientId)

  return url.toString()
}
