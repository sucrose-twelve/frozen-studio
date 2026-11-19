import { readEngineStatus } from "@/libs/queue"

/**
 * The worker's last status for a page's first render (`/api/events` streams it from there). `null` means the
 * worker isn't running, or Redis can't be reached, which amounts to the same thing for the user.
 */
export async function readEngine() {
  return readEngineStatus().catch(() => null)
}
