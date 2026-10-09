param(
  [switch]$CheckOnly,
  [switch]$NoPrompt,
  [switch]$Json,
  [int]$Port = 4318,
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'GameCanvas-InternetHost'),
  [string]$CloudflaredPath = '',
  [string]$NodePath = '',
  [string]$ServerEntry = ''
)
$ErrorActionPreference = 'Stop'
# A launcher invoked via Node/PowerShell 7 can inherit that runtime's module
# path. Prefer this PowerShell's built-ins; keep custom module paths intact.
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'diagnostics.ps1')
$exitCode = 1
$mutex = $null
$locked = $false
$code = 'GC-HOST-099'
$reportPath = ''
$facts = [pscustomobject]@{ publicUrl = ''; port = $Port; listenerPids = @() }
try {
  $StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
  $reportPath = Join-Path $StateDirectory 'connection-report.json'
  if (-not $ServerEntry) { $ServerEntry = Join-Path $PSScriptRoot '../../out/collaboration-server/server.mjs' }
  $serverEntry = [IO.Path]::GetFullPath($ServerEntry)
  # Serialize double-clicks without changing or adopting an existing process.
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $stateHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($StateDirectory.ToLowerInvariant()))).Replace('-', '') }
  finally { $hasher.Dispose() }
  $mutex = [Threading.Mutex]::new($false, "Local\GameCanvasHost-$stateHash")
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { $code = 'GC-HOST-014'; throw 'Busy' }
  if ($Port -lt 1 -or $Port -gt 65535) { $code = 'GC-HOST-005'; throw 'Invalid port' }
  if (-not $Json) { Write-Host "`nGame Canvas · 인터넷 협업`n[1/3] 기존 서버 · 포트 · 필수 프로그램 검사 중..." }
  $facts = Get-HostFacts $StateDirectory $Port $serverEntry $CloudflaredPath $NodePath
  $decision = Get-HostDecision $facts
  if ($decision.action -eq 'blocked') { $code = $decision.code; throw 'Preflight blocked' }
  if ($decision.action -eq 'start' -and -not $CheckOnly) {
    if (-not $Json) { Write-Host '[2/3] 서버와 Cloudflare 터널 시작 중... (최대 수 분 걸릴 수 있습니다)' }
    $failurePath = Join-Path $StateDirectory "logs/startup-failure-$([guid]::NewGuid().ToString('N')).json"
    $runner = Join-Path $PSScriptRoot 'host.ps1'
    # Run separately: legacy actions use exit. Only structured, sanitized errors are displayed.
    $startArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-Action', 'Start', '-Port', [string]$facts.port, '-StateDirectory', $StateDirectory, '-CloudflaredPath', $facts.cloudflaredPath, '-ServerEntry', $serverEntry, '-FailureReport', $failurePath)
    if ($NodePath) { $startArguments += @('-NodePath', $NodePath) }
    # Native pipeline capture keeps inherited Windows pipe handles open in the
    # long-lived helpers. Wait for the launcher itself, with file-backed IO.
    $runnerStamp = [guid]::NewGuid().ToString('N')
    $runnerLogs = Join-Path $StateDirectory 'logs'
    New-Item -ItemType Directory -Path $runnerLogs -Force | Out-Null
    $runnerInput = Join-Path $runnerLogs "launcher-$runnerStamp.in"
    [IO.File]::WriteAllText($runnerInput, '')
    $quotedArguments = @($startArguments | ForEach-Object { '"' + [regex]::Replace([regex]::Replace([string]$_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"' })
    $launcher = Start-Process -FilePath "$PSHOME/powershell.exe" -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru -RedirectStandardInput $runnerInput -RedirectStandardOutput (Join-Path $runnerLogs "launcher-$runnerStamp.out.log") -RedirectStandardError (Join-Path $runnerLogs "launcher-$runnerStamp.err.log")
    $null = $launcher.Handle
    if (-not $launcher.WaitForExit(300000)) { throw 'Launcher timeout' }
    $startExit = $launcher.ExitCode
    if ($startExit -ne 0) {
      $code = 'GC-HOST-099'
      try {
        $failure = Get-Content -LiteralPath $failurePath -Encoding UTF8 -Raw | ConvertFrom-Json
        $code = (Get-HostHelp ([string]$failure.code)).code
      } catch { }
      # Refresh only safe process/health diagnostics, never read private logs.
      $facts = Get-HostFacts $StateDirectory $facts.port $serverEntry $facts.cloudflaredPath $NodePath
      throw 'Startup failed'
    }
    $facts = Get-HostFacts $StateDirectory $facts.port $serverEntry $facts.cloudflaredPath $NodePath
    $decision = Get-HostDecision $facts
    if ($decision.action -ne 'reuse') { $code = $decision.code; if (-not $code) { $code = 'GC-HOST-099' }; throw 'Postflight failed' }
    $status = 'started'
  } elseif ($decision.action -eq 'reuse') {
    if (-not $Json) { Write-Host '[2/3] 실행 중인 서버와 터널 재사용 (재시작 안 함)' }
    $status = 'already-running'
  }
  else { $status = 'ready-to-start' }
  $code = ''
  $exitCode = 0
} catch {
  # Do not display PowerShell's raw exception (may contain credentials or private JSON).
  $status = 'failed'
} finally {
  if ($locked -and $mutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
$report = New-HostReport $facts $status $code
$reportSaved = $false
if ($reportPath -and $code -ne 'GC-HOST-014') {
  try {
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    $reportSaved = $true
  } catch { }
}
if ($Json) { $report | ConvertTo-Json -Depth 5; exit $exitCode }
if ($exitCode -eq 0) {
  if ($status -eq 'ready-to-start') { Write-Host '[완료] 시작 준비 정상. 검사 전용이므로 프로세스를 실행하지 않았습니다.' -ForegroundColor Green }
  else {
    Write-Host '[3/3] 내 PC 서버 · 외부 연결 모두 정상' -ForegroundColor Green
    if ($status -eq 'already-running') { Write-Host '이미 실행 중입니다. 재시작하지 않고 기존 주소를 유지했습니다.' }
    Write-Host "`n서버 주소: $($facts.publicUrl)" -ForegroundColor Cyan
    Write-Host '앱 → 함께 작업에서 이 주소를 사용하세요. 참가자에게는 주소 + 초대 코드만 전달하세요.'
  }
} else {
  $help = Get-HostHelp $code
  Write-Host "`n[$($help.code)] $($help.message)" -ForegroundColor Red
  Write-Host $help.remedy
  if ($facts.listenerPids.Count -gt 0) { Write-Host "포트 $($facts.port) 사용 PID: $($facts.listenerPids -join ', ')" }
}
if ($reportSaved) { Write-Host "진단 파일: $reportPath" }
elseif ($code -ne 'GC-HOST-014') { Write-Host '[GC-HOST-015] 진단 파일을 저장하지 못했습니다.' -ForegroundColor Yellow }
Write-Host '이 창을 닫아도 서버는 계속 실행됩니다. 협업 종료는 tools/internet-host/Stop.cmd를 사용하세요.'
if (-not $NoPrompt) {
  while ($true) {
    $choice = Read-Host "`n1: 주소 복사 / 2: 관리자 생성 키 복사(비공유) / 3: 진단 폴더 / Enter: 닫기"
    try {
      if ($choice -eq '1' -and $exitCode -eq 0 -and $facts.publicUrl) { Set-Clipboard -Value $facts.publicUrl; Write-Host '주소를 복사했습니다.' }
      elseif ($choice -eq '2' -and $exitCode -eq 0 -and $status -ne 'ready-to-start') {
        $null = & "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'host.ps1') -Action CopyKey -StateDirectory $StateDirectory 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Host '[GC-HOST-013] 키를 복사하지 못했습니다.' -ForegroundColor Red }
        else { Write-Host '관리자 키를 복사했습니다. 본인 앱에만 붙여넣고 참가자에게 공유하지 마세요.' }
      }
      elseif ($choice -eq '3' -and $reportSaved) { Start-Process explorer.exe -ArgumentList "`"$StateDirectory`"" -WindowStyle Hidden }
      elseif (-not $choice) { break }
      else { Write-Host '현재 상태에서는 이 항목을 사용할 수 없습니다.' }
    } catch { Write-Host '[GC-HOST-099] 선택한 작업을 완료하지 못했습니다.' -ForegroundColor Red }
  }
}
exit $exitCode
