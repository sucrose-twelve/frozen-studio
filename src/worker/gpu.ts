import { execFile } from "node:child_process"

import { VRAM_USER_MIN_GB } from "@/constants"

/**
 * Processes that always hold some VRAM on a desktop, and ComfyUI itself (`python`): not worth reporting.
 */
const IGNORED_PROCESSES = new Set(["dwm", "explorer", "python", "idle", "system"])

/**
 * Dedicated VRAM per process, from Windows' "GPU Process Memory" performance counter. NVML has no
 * per-process numbers under WDDM, so `nvidia-smi` can't answer this.
 */
const QUERY = [
  "$ErrorActionPreference='Stop'",
  "(Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples",
  "| Where-Object CookedValue -gt 50MB",
  "| ForEach-Object { $id=[int]([regex]::Match($_.InstanceName,'pid_(\\d+)').Groups[1].Value);",
  "[pscustomobject]@{ name=(Get-Process -Id $id -ErrorAction SilentlyContinue).Name; bytes=[int64]$_.CookedValue } }",
  "| ConvertTo-Json -Compress"
].join(" ")

type CounterRow = {
  name: string | null
  bytes: number
}

/**
 * Other programs holding VRAM right now, largest first. On Windows ComfyUI can't see their share, so it
 * overfills the card, the driver spills into system RAM, and the big models crawl or hang.
 *
 * @returns An empty list off Windows, or when the counter can't be read
 */
export function readVramUsers(): Promise<Engine.VramUser[]> {
  if (process.platform !== "win32") return Promise.resolve([])

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", QUERY],
      { timeout: 15_000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout.trim()) return resolve([])

        try {
          const parsed = JSON.parse(stdout) as CounterRow | CounterRow[]
          const rows = Array.isArray(parsed) ? parsed : [parsed]

          resolve(
            rows
              .filter((row) => row.name && !IGNORED_PROCESSES.has(row.name.toLowerCase()))
              .map((row) => ({
                name: row.name!,
                gigabytes: Math.round((row.bytes / 1024 ** 3) * 10) / 10
              }))
              .filter((user) => user.gigabytes >= VRAM_USER_MIN_GB)
              .toSorted((a, b) => b.gigabytes - a.gigabytes)
          )
        } catch {
          resolve([])
        }
      }
    )
  })
}
