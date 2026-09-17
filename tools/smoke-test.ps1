param(
  [string]$BaseUrl = 'http://127.0.0.1:4320',
  [string]$Token = ''
)

$ErrorActionPreference = 'Stop'
$headers = @{}
if ($Token) { $headers.Authorization = "Bearer $Token" }

function Get-Json($path) {
  Invoke-RestMethod -UseBasicParsing -TimeoutSec 10 -Headers $headers "$BaseUrl$path"
}

function Assert-Http($path) {
  $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Headers $headers "$BaseUrl$path"
  if ($response.StatusCode -ne 200) { throw "$path returned HTTP $($response.StatusCode)" }
  Write-Output "PASS $path -> HTTP $($response.StatusCode)"
}

try {
  Assert-Http '/'
  Assert-Http '/api/chrome/status'
  $tabs = @(Get-Json '/api/chrome/tabs')
  Write-Output "PASS /api/chrome/tabs -> $($tabs.Count) tab(s)"
  $tab = $tabs | Where-Object type -eq 'page' | Select-Object -First 1
  if (-not $tab) { throw 'No Chrome page tab is available.' }

  $safeTabId = [Uri]::EscapeDataString($tab.id)
  $outputPath = Join-Path $env:TEMP 'chrome-helper-smoke.jpg'
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Headers $headers `
    "$BaseUrl/api/chrome/tabs/$safeTabId/screenshot" -OutFile $outputPath
  $image = Get-Item $outputPath
  if ($image.Length -le 0) { throw 'Screenshot output is empty.' }
  Write-Output "PASS screenshot -> $($image.Length) bytes"
  Write-Output "Tab: $($tab.title) [$($tab.url)]"
  Write-Output "Image: $outputPath"
  Write-Output 'Smoke test completed. Input commands were not sent.'
} catch {
  Write-Error "Smoke test failed: $($_.Exception.Message)"
  exit 1
}
