param([ValidateSet('Start','Stop','Open','CopyCode','Publish','Status')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskElectron = Join-Path $taskRoot 'node_modules/electron/dist/electron.exe'
$taskWorker = Join-Path $taskRoot 'out/web-viewer/worker.cjs'
$taskState = Join-Path $env:APPDATA 'Game Canvas'
$taskRuntime = Join-Path $taskState 'web-viewer-runtime.json'
function Owned-Worker {
  if (-not (Test-Path -LiteralPath $taskRuntime)) { return $null }
  try {
    $record = Get-Content -LiteralPath $taskRuntime -Raw | ConvertFrom-Json
    $found = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.processId)"
    if ($found -and $found.ExecutablePath -eq $taskElectron -and $found.CommandLine.Contains($taskWorker) -and $found.CreationDate.ToUniversalTime().ToString('o') -eq $record.createdAt) { return $found }
  } catch { }
  return $null
}
$owned = Owned-Worker
if ($Action -eq 'Status') {
  [pscustomobject]@{ running = [bool]$owned; configured = (Test-Path -LiteralPath (Join-Path $taskState 'web-viewer.enc')) } | ConvertTo-Json
  if (Test-Path -LiteralPath (Join-Path $taskState 'web-viewer-status.json')) { Get-Content -LiteralPath (Join-Path $taskState 'web-viewer-status.json') }
  exit 0
}
if ($Action -eq 'Stop') {
  if ($owned) { Stop-Process -Id $owned.ProcessId }
  Write-Output 'Web viewer publisher stopped. Published projects remain available.'
  exit 0
}
if (-not (Test-Path -LiteralPath $taskWorker) -or -not (Test-Path -LiteralPath $taskElectron)) { throw 'Run npm ci and npm run web-viewer:build first.' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
if ($Action -in @('Open','CopyCode')) {
  if ($Action -eq 'Open' -and -not $owned) { & $PSCommandPath -Action Start }
  $mode = if ($Action -eq 'Open') { '--open' } else { '--copy-code' }
  Start-Process -FilePath $taskElectron -ArgumentList @("`"$taskWorker`"", $mode) -WindowStyle Hidden | Out-Null
  exit 0
}
if ($Action -eq 'Publish' -and $owned) { Stop-Process -Id $owned.ProcessId; $owned = $null }
if ($owned) { Write-Output 'Web viewer publisher is already running.'; exit 0 }
$arguments = @("`"$taskWorker`"")
if ($Action -eq 'Publish') { $arguments += '--publish' }
$started = Start-Process -FilePath $taskElectron -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'out/web-viewer/worker.out.log') -RedirectStandardError (Join-Path $taskRoot 'out/web-viewer/worker.err.log')
$record = Get-CimInstance Win32_Process -Filter "ProcessId = $($started.Id)"
@{ processId = $started.Id; createdAt = $record.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $taskRuntime -Encoding UTF8
Write-Output 'Web viewer publisher started.'
