# One-time setup on Windows: builds and starts Rave Run, then makes it start at every sign-in.
# Run from the repo folder:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$starter = Join-Path $PSScriptRoot "start-raverun.ps1"

function Say([string]$msg, [string]$color = "White") { Write-Host $msg -ForegroundColor $color }

Say "1. Checking Docker Desktop" Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Say "   Docker Desktop isn't installed. Get it from https://www.docker.com/products/docker-desktop/ , start it once, then run this again." Red
  exit 1
}
$ErrorActionPreference = "Continue"
& docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say "   Docker Desktop isn't running. Start it, wait for 'Engine running', then run this again." Red
  exit 1
}
Say "   OK" Green

Say "2. Building and starting Rave Run (first time: 5-15 minutes)" Cyan
Set-Location $repo
& docker compose -f docker-compose.local.yml up -d --build
if ($LASTEXITCODE -ne 0) {
  Say "   The build failed. Copy the error above and send it over." Red
  exit 1
}
Say "   OK" Green

Say "3. Adding Rave Run to your Startup folder" Cyan
$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "Rave Run.lnk"
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$starter`""
$lnk.WorkingDirectory = $repo
$lnk.WindowStyle = 7
$lnk.Description = "Start Rave Run (Docker) at sign-in"
$lnk.Save()
Say "   Created $lnkPath" Green

Say "4. Waiting for the app to answer" Cyan
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/login" -UseBasicParsing -TimeoutSec 5
    $ok = ($r.StatusCode -eq 200)
  } catch { Start-Sleep -Seconds 5 }
}
if ($ok) { Say "   OK" Green } else { Say "   Not answering yet. Check: docker compose -f docker-compose.local.yml logs web" Yellow }

$pw = "raverun"
$envFile = Join-Path $repo ".env"
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern "^APP_PASSWORD=(.+)$" | Select-Object -First 1
  if ($line) { $pw = $line.Matches[0].Groups[1].Value }
}

Say ""
Say "Done." Green
Say "  Open:      http://localhost:3000   (password: $pw)"
$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if ($ts) {
  $tsName = (& tailscale status --self --json 2>$null | ConvertFrom-Json).Self.DNSName
  if ($tsName) { Say "  On phone:  http://$($tsName.TrimEnd('.')):3000   (Tailscale on)" }
} else {
  Say "  On phone:  same Wi-Fi: http://<this PC's IP>:3000, or install Tailscale for anywhere"
}
Say "  It now starts by itself when you sign in. Missed checks (PC off/asleep at 5 AM) run when it's back."
Say "  Remove auto-start: powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall-autostart.ps1"
