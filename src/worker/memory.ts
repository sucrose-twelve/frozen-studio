import { execFile } from "node:child_process"
import os from "node:os"

const MEBIBYTE = 1024 ** 2

/**
 * The first GPU's dedicated memory, used and total, from `nvidia-smi` (in MiB). Unlike the per-process
 * counter in `gpu.ts`, this total counts every program on the card, ComfyUI and the services included.
 *
 * @returns `null` without an NVIDIA driver, or when it doesn't answer in time
 */
function readVram(): Promise<Engine.MemoryUsage | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 5_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null)

        const [used, total] = (stdout.split(/\r?\n/)[0] ?? "")
          .split(",")
          .map((value) => Number(value.trim()))
        resolve(
          Number.isFinite(used) && total > 0
            ? { used: used * MEBIBYTE, total: total * MEBIBYTE }
            : null
        )
      }
    )
  })
}

/**
 * System RAM and the GPU's VRAM, as the header's memory chip shows them.
 */
export async function readMemory(): Promise<Engine.Memory> {
  const total = os.totalmem()

  return {
    ram: { used: total - os.freemem(), total },
    vram: await readVram()
  }
}
