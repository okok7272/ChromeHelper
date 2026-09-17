$ErrorActionPreference = 'Stop'
$taskName = 'ChromeHelper'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Output 'ChromeHelper automatic startup removed.'
