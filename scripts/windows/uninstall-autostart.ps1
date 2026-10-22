# Stops Rave Run from starting at sign-in. Add -Stop to also shut it down now. Your data is kept.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall-autostart.ps1 [-Stop]
param([switch]$Stop)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$lnkPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Rave Run.lnk"
if (Test-Path $lnkPath) {
  Remove-Item $lnkPath
  Write-Host "Removed $lnkPath" -ForegroundColor Green
} else {
  Write-Host "No Startup shortcut found (already removed)." -ForegroundColor Yellow
}
if ($Stop) {
  Set-Location $repo
  & docker compose -f docker-compose.local.yml stop
  Write-Host "Stopped. Containers stay stopped until you start them again (data kept)." -ForegroundColor Green
} else {
  Write-Host "Rave Run keeps running until you stop it: add -Stop, or quit Docker Desktop."
}
