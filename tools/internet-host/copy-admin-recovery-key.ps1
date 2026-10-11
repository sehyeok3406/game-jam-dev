param(
  [string]$ProjectId = '',
  [string]$ProfileDirectory = (Join-Path $env:APPDATA 'Game Canvas'),
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'GameCanvas-InternetHost'),
  [ValidateSet('Key','ProjectId','Both','ServerUrl','Info','All')][string]$Copy = 'Key',
  [switch]$CheckOnly,
  [switch]$NoPrompt
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskElectron = Join-Path $taskRoot 'node_modules/electron/dist/electron.exe'
$taskWorker = Join-Path $PSScriptRoot 'copy-admin-recovery-key.cjs'
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskDirectory = Join-Path $taskTempRoot ('GameJam-RecoveryKey-' + [guid]::NewGuid().ToString('N'))
$taskExitCode = 1
function Get-KeyToolHelp([string]$Code) {
  $helpMessage = switch ($Code) {
    'KEY_NOT_FOUND' { '현재 서버와 일치하는 복구 키를 찾지 못했습니다. 이전 키는 복사하지 않았습니다. 다른 백업 또는 관리자 복구가 필요합니다.' }
    'PROJECT_NOT_FOUND' { '이 PC의 서버에 속한 저장된 공동 프로젝트를 찾지 못했습니다.' }
    'SERVER_URL_UNAVAILABLE' { '현재 서버 주소를 확인할 수 없습니다. 인터넷 협업 서버를 시작한 뒤 다시 실행하세요.' }
    'PROJECT_REQUIRED' { '프로젝트를 선택하거나 -ProjectId로 지정하세요.' }
    'ELECTRON_MISSING' { '이 저장소의 Electron 실행 도구가 없습니다. 프로젝트 의존성을 준비한 뒤 실행하세요.' }
    'RECOVERY_TIMEOUT' { '복구 키 확인 시간이 초과되었습니다. 다시 실행하세요.' }
    default { '암호화된 복구 정보를 읽지 못했습니다. 처음 저장한 Windows 계정에서 다시 실행하세요.' }
  }
  return $helpMessage
}
function Invoke-KeyTool([string]$Mode, [string]$Id = '') {
  $requestPath = Join-Path $taskDirectory 'request.json'
  $resultPath = Join-Path $taskDirectory 'result.json'
  Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
  @{ profile = [IO.Path]::GetFullPath($ProfileDirectory); stateDirectory = [IO.Path]::GetFullPath($StateDirectory); mode = $Mode; projectId = $Id } |
    ConvertTo-Json | Set-Content -LiteralPath $requestPath -Encoding UTF8
  # No credentials in arguments, output files or console. This worker has no window.
  $process = Start-Process -FilePath $taskElectron -ArgumentList @("`"$taskWorker`"", "`"$requestPath`"") -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(15000)) {
    $process.Kill()
    throw 'RECOVERY_TIMEOUT'
  }
  if (-not (Test-Path -LiteralPath $resultPath)) { throw 'RECOVERY_READ_FAILED' }
  $result = Get-Content -LiteralPath $resultPath -Encoding UTF8 -Raw | ConvertFrom-Json
  if (-not $result.ok) { throw ([string]$result.code) }
  return $result
}
try {
  if (-not (Test-Path -LiteralPath $taskElectron)) { throw 'ELECTRON_MISSING' }
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $taskDirectory | Out-Null
  Write-Host "`nGame Jam! · 관리자 복구 키" -ForegroundColor Cyan
  $listing = Invoke-KeyTool 'List'
  if ($listing.serverUrl) { Write-Host "현재 서버 주소: $($listing.serverUrl)" }
  else { Write-Host '현재 서버 주소: 확인할 수 없음 (서버 시작 필요)' -ForegroundColor Yellow }
  $projects = @($listing.projects)
  if ($ProjectId) {
    $selected = $projects | Where-Object projectId -EQ $ProjectId | Select-Object -First 1
    if (-not $selected) { throw 'PROJECT_NOT_FOUND' }
  } elseif ($projects.Count -eq 1) { $selected = $projects[0] }
  elseif ($NoPrompt -or $CheckOnly) {
    $projects | Select-Object name,projectId | Format-Table -AutoSize
    if ($CheckOnly) { $taskExitCode = 0; return }
    throw 'PROJECT_REQUIRED'
  } else {
    for ($index = 0; $index -lt $projects.Count; $index++) {
      Write-Host "$($index + 1): $($projects[$index].name) [$($projects[$index].projectId)]"
    }
    $choice = Read-Host '복구 키를 복사할 프로젝트 번호 (Enter: 취소)'
    if (-not $choice) { $taskExitCode = 0; return }
    $number = 0
    if (-not [int]::TryParse($choice, [ref]$number) -or $number -lt 1 -or $number -gt $projects.Count) { throw 'PROJECT_REQUIRED' }
    $selected = $projects[$number - 1]
  }
  Write-Host "프로젝트: $($selected.name)"
  Write-Host "프로젝트 ID: $($selected.projectId)"
  if ($selected.recoveryKeyAvailable) {
    Write-Host '저장된 복구 키가 현재 서버 데이터와 일치합니다.' -ForegroundColor Green
  } else {
    Write-Host '[안내] 유효한 복구 키가 없습니다. 프로젝트 ID와 서버 주소는 복사할 수 있습니다.' -ForegroundColor Yellow
  }
  if ($CheckOnly) { $taskExitCode = 0; return }
  if ($selected.recoveryKeyAvailable -or $NoPrompt -or $Copy -in @('ProjectId','ServerUrl','Info')) {
    $null = Invoke-KeyTool $Copy $selected.projectId
    $copiedLabel = switch ($Copy) { 'Key' { '관리자 복구 키' }; 'ProjectId' { '프로젝트 ID' }; 'Both' { '프로젝트 ID와 복구 키' }; 'ServerUrl' { '현재 서버 주소' }; 'Info' { '프로젝트 ID와 현재 서버 주소' }; 'All' { '전체 복구 정보' } }
    Write-Host "[완료] $copiedLabel 클립보드에 복사했습니다. Ctrl+V로 붙여넣으세요." -ForegroundColor Green
  }
  if (-not $NoPrompt) {
    while ($true) {
      $choice = Read-Host "`n1: 복구 키 / 2: 프로젝트 ID / 3: ID+키 / 4: 서버 주소 / 5: ID+주소 / 6: 전체 복사 / Enter: 닫기"
      if (-not $choice) { break }
      $mode = switch ($choice) { '1' { 'Key' }; '2' { 'ProjectId' }; '3' { 'Both' }; '4' { 'ServerUrl' }; '5' { 'Info' }; '6' { 'All' }; default { '' } }
      if ($mode) {
        try { $null = Invoke-KeyTool $mode $selected.projectId; Write-Host '복사했습니다.' }
        catch { Write-Host "[실패] $(Get-KeyToolHelp $_.Exception.Message)" -ForegroundColor Red }
      }
    }
  }
  $taskExitCode = 0
} catch {
  $message = Get-KeyToolHelp $_.Exception.Message
  Write-Host "[실패] $message" -ForegroundColor Red
  if (-not $NoPrompt) { $null = Read-Host 'Enter: 닫기' }
} finally {
  # Verify the exact temporary target before deleting our isolated helper profile.
  $resolvedDirectory = [IO.Path]::GetFullPath($taskDirectory)
  if ((Split-Path -Parent $resolvedDirectory).TrimEnd('\') -eq $taskTempRoot.TrimEnd('\') -and
      (Split-Path -Leaf $resolvedDirectory) -cmatch '^GameJam-RecoveryKey-[a-f0-9]{32}$') {
    Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
exit $taskExitCode
