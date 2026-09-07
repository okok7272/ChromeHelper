$chrome = Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  $chrome = Join-Path ${env:LOCALAPPDATA} 'Google\Chrome\Application\chrome.exe'
}
if (-not (Test-Path $chrome)) { throw 'Chrome executable was not found.' }

$userData = Join-Path $env:TEMP 'ChromeHelperProfile'
Start-Process $chrome -ArgumentList '--remote-debugging-port=9222', '--remote-allow-origins=http://localhost:4320', "--user-data-dir=$userData", 'about:blank'
Write-Output 'ChromeHelper Chrome started with local debugging on port 9222.'
