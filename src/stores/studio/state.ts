import { createStore } from "zustand"

import type { AssetView, JobDetail } from "@/actions/jobs/read"

/**
 * What the event stream has said about a job since the page rendered. `status` is unset until a status event
 * arrives, in which case the status the server rendered still stands.
 *
 * `brief` names the job for its toast: it comes with the queued event, or from the server for a job that
 * was already active when the page rendered.
 */
export type JobLive = {
  status?: Media.JobStatus
  error?: string
  progress: Engine.Progress | null
  brief?: Engine.JobBrief
}

/**
 * A request to fill a form from a result: "use as reference", "describe", "reuse settings". The form of that
 * `kind` applies it once; a new object means a new request.
 *
 * - `references`: images to put in the form's reference slots
 * - `source`: a job whose prompt and settings to copy, or `null` to keep what the form has
 * - `prompt`: text a caption wrote, for the form's prompt fields; the negative prompt is left alone when the
 *   caption has none. With it the request is only about the text: the form's references and settings stay
 *   as they are
 */
export type Prefill = {
  kind: Media.JobKind
  references: AssetView[]
  source: JobDetail | null
  prompt?: { positive: string; negative?: string }
}

/**
 * A chat reply as the worker last sent it, while it is written: its text so far, and the job writing it.
 */
export type ReplyLive = {
  jobId: string
  text: string
}

type State = {
  engine: Engine.Status | null
  jobs: Record<string, JobLive>
  /**
   * Chat replies by message id.
   */
  replies: Record<string, ReplyLive>
  prefill: Prefill | null
}

type Actions = {
  applyEvent: (event: Engine.Event) => void
  requestPrefill: (prefill: Prefill) => void
}

export type StudioState = State & Actions

export const createStudioStore = (initialState: Pick<State, "engine" | "jobs">) =>
  createStore<StudioState>()((setState) => ({
    ...initialState,
    replies: {},
    prefill: null,
    requestPrefill: (prefill) => setState({ prefill }),
    applyEvent: (event) =>
      setState((state) => {
        switch (event.type) {
          case "engine":
            return { engine: event.engine }
          case "job":
            return {
              jobs: {
                ...state.jobs,
                [event.id]: {
                  status: event.status,
                  error: event.error,
                  progress: null,
                  brief: event.brief ?? state.jobs[event.id]?.brief
                }
              }
            }
          case "progress":
            return {
              jobs: {
                ...state.jobs,
                [event.id]: {
                  ...state.jobs[event.id],
                  progress: { label: event.label, value: event.value, max: event.max }
                }
              }
            }
          case "chat":
            return {
              replies: {
                ...state.replies,
                [event.messageId]: { jobId: event.id, text: event.text }
              }
            }
        }
      })
  }))

export type StudioStore = ReturnType<typeof createStudioStore>
