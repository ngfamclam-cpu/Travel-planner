# Starts Rave Run at Windows sign-in (run by the Startup shortcut that install-autostart.ps1 creates).
# Launches Docker Desktop if it isn't running, waits for it, then starts the app in the background.
# Log: %LOCALAPPDATA%\RaveRun\start.log
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $env:LOCALAPPDATA "RaveRun"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "start.log"
function Write-Log([string]$msg) { "$(Get-Date -Format s)  $msg" | Out-File -FilePath $log -Append -Encoding utf8 }

function Test-DockerReady {
  & docker info 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

Write-Log "Starting Rave Run from $repo"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Log "docker command not found. Is Docker Desktop installed?"
  exit 1
}

if (-not (Test-DockerReady)) {
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) {
    Start-Process -FilePath $exe
    Write-Log "Launched Docker Desktop, waiting for it to be ready"
  } else {
    Write-Log "Docker Desktop.exe not found at $exe; waiting in case it starts on its own"
  }
  $deadline = (Get-Date).AddMinutes(6)
  while (-not (Test-DockerReady) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
  if (-not (Test-DockerReady)) {
    Write-Log "Docker did not become ready within 6 minutes; giving up"
    exit 1
  }
}

Set-Location $repo
& docker compose -f docker-compose.local.yml up -d 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
Write-Log "docker compose up finished (exit code $LASTEXITCODE)"
