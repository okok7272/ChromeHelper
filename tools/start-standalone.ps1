$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Test-Path '.\dist\src\server.js')) {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:4320/' | Out-Null
  Write-Output 'ChromeHelper is already running on http://127.0.0.1:4320.'
  exit 0
} catch {
  # Start the local bridge below.
}

& "$PSScriptRoot\launch-chrome.ps1"
npm.cmd start