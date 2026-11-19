# Frozen launcher
#
# One click starts everything Frozen needs and opens it in the browser:
#
#   - ComfyUI, headless (no Comfy Desktop window), unless it is already running
#   - the app on http://localhost:8190, unless it is already running
#   - the queue worker, which also starts the voice service when a voice job needs it
#
# The app runs as a production build (`start:prod`). The build is made here when there is none, or when the
# code has changed since the last one, which adds about half a minute to that start. If the build fails,
# the dev server runs instead, so a half-finished change never keeps Frozen from opening.
#
# It then sits in the tray. Right-click the icon to open the app, read the logs, or quit. Quitting stops
# what this launcher started and nothing else: a ComfyUI that was already running is left alone.
#
#   powershell -ExecutionPolicy Bypass -File launcher\Frozen.ps1                    start
#   powershell -ExecutionPolicy Bypass -File launcher\Frozen.ps1 -Dev               start with the dev server
#   powershell -ExecutionPolicy Bypass -File launcher\Frozen.ps1 -InstallShortcut   put "Frozen" on the Desktop
#   powershell -ExecutionPolicy Bypass -File launcher\Frozen.ps1 -Quit              stop the one in the tray
#
# The file is plain ASCII on purpose: Windows PowerShell reads a script without a byte-order mark in the
# system code page, and anything else in here would come out garbled.

param(
    [switch]$Dev,
    [switch]$InstallShortcut,
    [switch]$Quit
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
$IconFile = Join-Path $PSScriptRoot 'frozen.ico'
# The port is the one `start:prod` and `start:dev` in package.json listen on
$AppUrl = 'http://localhost:8190'

# ---------- icon ----------

# The app's mark (public\static\favicon.svg) drawn at any size: a night square with a frost snowflake.
function New-FrozenBitmap([int]$Size) {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # The drawing is laid out on the favicon's 32-unit grid
    $unit = $Size / 32.0
    $corner = [float](16 * $unit)
    $far = [float]($Size - $corner)
    $square = New-Object System.Drawing.Drawing2D.GraphicsPath
    $square.AddArc(0, 0, $corner, $corner, 180, 90)
    $square.AddArc($far, 0, $corner, $corner, 270, 90)
    $square.AddArc($far, $far, $corner, $corner, 0, 90)
    $square.AddArc(0, $far, $corner, $corner, 90, 90)
    $square.CloseFigure()
    $night = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#131b2b'))
    $graphics.FillPath($night, $square)

    $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#cfeae0'), [float](2 * $unit))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $strokes = @(
        @(16, 6, 16, 26), @(7.3, 11, 24.7, 21), @(24.7, 11, 7.3, 21),
        @(13, 8, 16, 11), @(16, 11, 19, 8), @(13, 24, 16, 21), @(16, 21, 19, 24)
    )
    foreach ($stroke in $strokes) {
        $graphics.DrawLine($pen, [float]($stroke[0] * $unit), [float]($stroke[1] * $unit), [float]($stroke[2] * $unit), [float]($stroke[3] * $unit))
    }

    $graphics.Dispose()
    return $bitmap
}

# Writes the mark as an .ico with PNG images inside, which is what a shortcut can point at. (Saving a
# System.Drawing.Icon would give 16 colours.)
function Save-FrozenIcon([string]$Path) {
    $sizes = @(256, 48, 32, 16)
    $images = @()
    foreach ($size in $sizes) {
        $stream = New-Object System.IO.MemoryStream
        (New-FrozenBitmap $size).Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $images += , $stream.ToArray()
    }

    $file = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($file)
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($index = 0; $index -lt $sizes.Count; $index++) {
        # A side of 256 is written as 0
        $side = if ($sizes[$index] -ge 256) { 0 } else { $sizes[$index] }
        $writer.Write([byte]$side)
        $writer.Write([byte]$side)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$index].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$index].Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($Path, $file.ToArray())
}

if ($InstallShortcut) {
    Save-FrozenIcon $IconFile
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Frozen.lnk'
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    # Windows PowerShell by full path, whichever PowerShell this was run from
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    $shortcut.WorkingDirectory = $Root
    $shortcut.IconLocation = "$IconFile,0"
    $shortcut.Description = 'Frozen: local media studio'
    # 7 = minimized, so the console doesn't flash on screen before it hides
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Output "Shortcut written to $shortcutPath"
    return
}

# ---------- helpers ----------

function Show-Error([string]$Message) {
    [System.Windows.Forms.MessageBox]::Show($Message, 'Frozen', 'OK', 'Error') | Out-Null
}

function Test-Url([string]$Url) {
    try {
        Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

# The project's .env as a table. Only the ComfyUI settings are used here; nothing from it is shown or logged.
function Read-DotEnv {
    $values = @{}
    $file = Join-Path $Root '.env'
    if (Test-Path $file) {
        foreach ($line in Get-Content $file -Encoding UTF8) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
                $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
            }
        }
    }
    return $values
}

function Stop-Tree($Process) {
    if ($Process -and -not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null }
}

# Starts a program without a window, its output going to logs\<name>.log (and <name>.err.log).
function Start-Hidden([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $LogDir "$Name.log") `
        -RedirectStandardError (Join-Path $LogDir "$Name.err.log")
    # Asking for the handle now is what lets ExitCode be read once the process has ended
    $null = $process.Handle
    return $process
}

# Whether the production build is missing, or older than something it is built from. `next start` serves
# the build as it stands, so a change made since then has to be built in before it shows.
function Test-BuildIsStale {
    $buildId = Join-Path $Root '.next\BUILD_ID'
    if (-not (Test-Path $buildId)) { return $true }

    $builtAt = (Get-Item $buildId).LastWriteTimeUtc
    $sources = @(Get-ChildItem (Join-Path $Root 'src'), (Join-Path $Root 'public') -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($name in @('package.json', 'bun.lock', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', '.env')) {
        $file = Join-Path $Root $name
        if (Test-Path $file) { $sources += Get-Item $file -Force }
    }

    return [bool]($sources | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1)
}

# ---------- quitting from outside ----------

# A signal shared by name. `-Quit` raises it, and the launcher in the tray stops everything when it sees it:
# the same as "Quit Frozen" in its menu, for scripts and for when the tray icon is out of reach.
$quitSignal = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::ManualReset, 'Local\FrozenLauncherQuit')
if ($Quit) {
    [void]$quitSignal.Set()
    return
}

# ---------- one launcher at a time ----------

$mutex = New-Object System.Threading.Mutex($false, 'Local\FrozenLauncher')
if (-not $mutex.WaitOne(0)) {
    # Already in the tray: a second click just brings the app up
    Start-Process $AppUrl
    return
}
[void]$quitSignal.Reset()

$settings = Read-DotEnv
$comfyUrl = if ($settings['COMFY_URL']) { $settings['COMFY_URL'].TrimEnd('/') } else { 'http://127.0.0.1:8188' }
$comfyPort = ([uri]$comfyUrl).Port

$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) {
    Show-Error "bun was not found on this computer's PATH.`n`nInstall it from https://bun.sh, then start Frozen again."
    return
}
if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Show-Error "The project's packages are not installed yet.`n`nRun `"bun install`" in $Root, then start Frozen again."
    return
}

New-Item -ItemType Directory -Force $LogDir | Out-Null
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

# What this launcher started, by name. Only these are stopped on quit.
$script:started = @{}
$script:notes = @()
$script:hasOpened = $false

# ---------- ComfyUI ----------

if (-not (Test-Url "$comfyUrl/system_stats")) {
    # Comfy Desktop's own configuration says where ComfyUI is installed and where its models are, so the
    # headless server sees exactly what the desktop app would.
    try {
        $configDir = Join-Path $env:APPDATA 'Comfy Desktop'
        $desktop = Get-Content (Join-Path $configDir 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $installs = @((Get-Content (Join-Path $configDir 'installations.json') -Raw -Encoding UTF8 | ConvertFrom-Json) |
            Where-Object { $_.installPath -and (Test-Path $_.installPath) })
        $lastId = try { (Get-Content (Join-Path $configDir 'last-session.json') -Raw | ConvertFrom-Json).installationId } catch { $null }
        $install = $installs | Where-Object { $_.id -eq $lastId } | Select-Object -First 1
        if (-not $install) { $install = $installs | Select-Object -First 1 }
        if (-not $install) { throw 'No ComfyUI installed through Comfy Desktop was found.' }

        $comfyDir = $install.installPath
        $python = Join-Path $comfyDir 'ComfyUI\.venv\Scripts\python.exe'
        $modelPaths = Join-Path $configDir "instance-model-paths\$($install.id).yaml"
        if (-not (Test-Path $python)) { throw "ComfyUI's Python was not found: $python" }
        if (-not (Test-Path $modelPaths)) { throw "ComfyUI's model folder settings were not found: $modelPaths" }

        # The app reads and writes these folders too, so its settings win over Comfy Desktop's
        $inputDir = if ($settings['COMFY_INPUT_DIR']) { $settings['COMFY_INPUT_DIR'] } else { $desktop.inputDir }
        $outputDir = if ($settings['COMFY_OUTPUT_DIR']) { $settings['COMFY_OUTPUT_DIR'] } else { $desktop.outputDir }

        $comfyArgs = @(
            '-s', 'ComfyUI\main.py', '--port', $comfyPort, '--enable-manager', '--enable-assets',
            '--extra-model-paths-config', "`"$modelPaths`"",
            '--input-directory', "`"$inputDir`"",
            '--output-directory', "`"$outputDir`""
        )

        # Other programs holding VRAM (a game, usually). ComfyUI can't see them on Windows and overfills the
        # card, the driver spills into system RAM, and jobs crawl. Reserving what they hold makes ComfyUI
        # offload by itself instead: slower than an empty card, but it keeps working.
        $otherGB = 0
        try {
            $holders = @((Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples |
                ForEach-Object {
                    $processId = [int]([regex]::Match($_.InstanceName, 'pid_(\d+)').Groups[1].Value)
                    [pscustomobject]@{ Name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).Name; GB = $_.CookedValue / 1GB }
                } | Where-Object { $_.GB -ge 0.3 -and $_.Name -notin @('dwm', 'explorer', 'python') })
            $otherGB = ($holders | Measure-Object GB -Sum).Sum
        } catch {}
        if ($otherGB -ge 1) {
            $reserve = [math]::Round($otherGB + 1, 1)
            $comfyArgs += @('--reserve-vram', $reserve.ToString([Globalization.CultureInfo]::InvariantCulture))
            $script:notes += ('Another program holds {0:N1} GB of VRAM, so generation will be slower.' -f $otherGB)
        }

        $script:started['comfyui'] = Start-Hidden 'comfyui' $python $comfyArgs $comfyDir
    } catch {
        Show-Error "ComfyUI could not be started.`n`n$($_.Exception.Message)`n`nFrozen will open without it; image and video jobs wait until ComfyUI runs."
    }
}

# ---------- the app and the worker ----------

function Start-App([string]$Script) {
    $script:started['app'] = Start-Hidden 'app' $bun @('run', $Script) $Root
}

$script:isDev = [bool]$Dev
if (-not (Test-Url $AppUrl)) {
    if ($script:isDev) {
        Start-App 'start:dev'
    } elseif (Test-BuildIsStale) {
        # Built in the background while ComfyUI loads; the timer below starts the app when it is done
        $script:started['build'] = Start-Hidden 'build' $bun @('run', 'build') $Root
    } else {
        Start-App 'start:prod'
    }
}
# A second worker refuses to run while one is alive, so starting it is always safe
$script:started['worker'] = Start-Hidden 'worker' $bun @('run', 'worker') $Root
$script:workerStartedAt = Get-Date

$startsApp = $script:started.ContainsKey('app') -or $script:started.ContainsKey('build')
if (-not $startsApp -and -not $script:started.ContainsKey('comfyui')) {
    # Everything was up already (a terminal running `bun run dev`, say). The worker just started will
    # bow out by itself; there is nothing here to keep a tray icon for.
    Start-Process $AppUrl
    $script:hasOpened = $true
    Start-Sleep -Seconds 12
    if ($script:started['worker'].HasExited) {
        $mutex.ReleaseMutex()
        return
    }
}

# ---------- tray ----------

function Stop-Everything {
    foreach ($name in @('worker', 'app', 'build', 'comfyui')) {
        if ($script:started.ContainsKey($name)) { Stop-Tree $script:started[$name] }
    }
}

# Quitting, whether from the tray menu or from `-Quit`
function Stop-Launcher {
    $timer.Stop()
    Stop-Everything
    $tray.Visible = $false
    [System.Windows.Forms.Application]::Exit()
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::FromHandle((New-FrozenBitmap 32).GetHicon())
$tray.Text = 'Frozen: starting'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Open Frozen')
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$openItem.add_Click({ Start-Process $AppUrl })
$menu.Items.Add('Open Gallery').add_Click({ Start-Process "$AppUrl/gallery" })
$menu.Items.Add('Open ComfyUI').add_Click({ Start-Process "$comfyUrl/" })
[void]$menu.Items.Add('-')
$menu.Items.Add('Open the logs folder').add_Click({ Start-Process explorer.exe -ArgumentList "`"$LogDir`"" })
[void]$menu.Items.Add('-')
$menu.Items.Add('Quit Frozen').add_Click({ Stop-Launcher })
$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Start-Process $AppUrl })
$greeting = 'Starting. The app opens in the browser in a moment.'
if ($script:started.ContainsKey('build')) {
    $tray.Text = 'Frozen: building the app'
    $greeting = 'The code has changed, so the app is being built first. It opens in the browser in about half a minute.'
}
$tray.ShowBalloonTip(5000, 'Frozen', $greeting, [System.Windows.Forms.ToolTipIcon]::Info)

$script:isAppReady = $false
$script:isComfyReady = -not $script:started.ContainsKey('comfyui')
$script:reported = @{}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
    if ($quitSignal.WaitOne(0)) {
        Stop-Launcher
        return
    }

    # The build is done: serve it, or run the dev server if it failed
    if ($script:started.ContainsKey('build') -and $script:started['build'].HasExited) {
        $hasBuilt = $script:started['build'].ExitCode -eq 0
        $script:started.Remove('build')
        if ($hasBuilt) {
            Start-App 'start:prod'
        } else {
            $script:isDev = $true
            Start-App 'start:dev'
            $tray.ShowBalloonTip(10000, 'Frozen', 'The build failed, so Frozen runs the dev server this time. See build.log in the logs folder.', [System.Windows.Forms.ToolTipIcon]::Warning)
        }
    }

    # Something this launcher started has stopped by itself
    foreach ($name in @($script:started.Keys)) {
        $process = $script:started[$name]
        if (-not $process.HasExited -or $script:reported.ContainsKey($name)) { continue }
        $script:reported[$name] = $true

        # A worker that leaves within its first seconds found another one already running: fine
        $isSpareWorker = $name -eq 'worker' -and ((Get-Date) - $script:workerStartedAt).TotalSeconds -lt 30
        if (-not $isSpareWorker) {
            $tray.ShowBalloonTip(8000, 'Frozen', "The $name stopped. See logs\$name.err.log (right-click > Open the logs folder).", [System.Windows.Forms.ToolTipIcon]::Warning)
        }
    }

    $running = @($script:started.Values | Where-Object { -not $_.HasExited })
    if ($running.Count -eq 0) {
        $timer.Stop()
        $tray.Visible = $false
        [System.Windows.Forms.Application]::Exit()
        return
    }

    if (-not $script:isAppReady -and (Test-Url $AppUrl)) {
        $script:isAppReady = $true
        $message = 'Ready. Right-click this icon to quit.'
        if (-not $script:isComfyReady) { $message = 'Ready. ComfyUI is still loading; image and video jobs wait for it.' }
        if ($script:notes.Count -gt 0) { $message = "$message $($script:notes -join ' ')" }
        $tray.ShowBalloonTip(6000, 'Frozen', $message, [System.Windows.Forms.ToolTipIcon]::Info)
        if (-not $script:hasOpened) {
            $script:hasOpened = $true
            Start-Process $AppUrl
        }
    }
    if (-not $script:isComfyReady -and (Test-Url "$comfyUrl/system_stats")) { $script:isComfyReady = $true }

    $label = if ($script:isDev) { 'Frozen (dev)' } else { 'Frozen' }
    if ($script:isAppReady -and $script:isComfyReady) {
        $tray.Text = "${label}: ready (right-click to quit)"
        $timer.Interval = 5000
    } elseif ($script:isAppReady) {
        $tray.Text = "${label}: ready, ComfyUI still loading"
    }
})
$timer.Start()

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    Stop-Everything
    $tray.Dispose()
    $mutex.ReleaseMutex()
}
