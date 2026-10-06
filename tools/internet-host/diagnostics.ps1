function Get-HostHelp([string]$Code) {
  $messages = @{
    'GC-HOST-001' = @('실행 도구가 없습니다.', '이 CMD를 원래 프로젝트 폴더에서 실행하고 Windows PowerShell을 확인하세요.')
    'GC-HOST-002' = @('서버 실행 파일이 없습니다.', '프로젝트 폴더에서 npm run collaboration:build를 실행한 뒤 다시 시도하세요.')
    'GC-HOST-003' = @('Node.js가 없거나 버전이 낮습니다.', '서버 PC에 Node.js 24 이상을 설치한 뒤 이 창을 닫고 다시 실행하세요.')
    'GC-HOST-004' = @('Cloudflare 터널 프로그램이 없습니다.', '공식 cloudflared-windows-amd64.exe를 다운로드 폴더에 두거나 cloudflared.exe를 PATH에 등록하세요.')
    'GC-HOST-005' = @('기존 실행 정보가 잘못되었습니다.', 'runtime.json을 임의로 삭제하지 마세요. 진단 파일을 전달해 실행 상태를 확인하세요.')
    'GC-HOST-006' = @('포트를 다른 프로그램이 사용하고 있습니다.', '진단 파일의 포트와 PID를 확인하세요. 이 도구는 해당 프로그램을 강제 종료하지 않습니다.')
    'GC-HOST-007' = @('기존 프로세스의 소유권을 확인할 수 없습니다.', '이전에 서버를 시작한 Windows 계정과 같은 실행 권한으로 실행하세요. 관리자 권한 자동 전환이나 강제 종료는 하지 않습니다.')
    'GC-HOST-008' = @('서버와 터널 중 한쪽만 실행 중입니다.', '기존 연결에 영향을 줄 수 있으므로 자동 재시작하지 않습니다. 공동 작업을 끝낸 뒤 tools/internet-host/Stop.cmd를 실행하고 다시 시작하세요.')
    'GC-HOST-009' = @('내 PC의 서버가 정상 응답하지 않습니다.', '서버 로그를 확인하세요. 실행 중인 서버·터널은 자동으로 재시작하지 않습니다.')
    'GC-HOST-010' = @('외부 주소에 연결할 수 없습니다.', '인터넷 연결과 터널 로그를 확인하고 잠시 후 다시 실행하세요. 기존 주소와 프로세스는 유지합니다.')
    'GC-HOST-011' = @('서버 프로세스를 시작하지 못했습니다.', '로그 폴더, Node.js 실행 권한, 백신 차단 여부를 확인하세요.')
    'GC-HOST-012' = @('터널 프로세스를 시작하지 못했습니다.', '터널 로그, cloudflared 실행 권한, 인터넷 연결을 확인하세요.')
    'GC-HOST-013' = @('관리자 생성 키를 읽거나 저장하지 못했습니다.', '처음 서버를 실행한 Windows 계정으로 실행하세요. 키 파일을 삭제하면 기존 관리 설정을 잃을 수 있습니다.')
    'GC-HOST-014' = @('이미 다른 실행 창에서 검사 또는 시작 중입니다.', '다른 실행 창의 준비가 끝날 때까지 기다린 뒤 다시 실행하세요.')
    'GC-HOST-015' = @('진단 기록을 저장하지 못했습니다.', '로컬 데이터 폴더의 쓰기 권한과 디스크 여유 공간을 확인하세요.')
    'GC-HOST-099' = @('예상하지 못한 실행 오류입니다.', '오류 코드와 진단 파일을 전달하세요. 보안상 예외 원문이나 인증 정보는 표시하지 않습니다.')
  }
  if (-not $messages.ContainsKey($Code)) { $Code = 'GC-HOST-099' }
  return [pscustomobject]@{ code = $Code; message = $messages[$Code][0]; remedy = $messages[$Code][1] }
}

function Get-HostProcessState($Record) {
  if (-not $Record) { return 'absent' }
  try {
    if ([int]$Record.pid -le 0 -or -not $Record.createdAt -or -not $Record.executable -or -not $Record.marker) { return 'unverified' }
    $found = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Record.pid)" -ErrorAction Stop
    if (-not $found) { return 'absent' }
    # A reused PID is not ours; never adopt or terminate it.
    if (-not $found.CreationDate -or -not $found.ExecutablePath -or -not $found.CommandLine) { return 'unverified' }
    if ($found.CreationDate.ToUniversalTime().ToString('o') -ne $Record.createdAt -or
        $found.ExecutablePath -ne $Record.executable -or
        -not $found.CommandLine.Contains([string]$Record.marker)) { return 'unverified' }
    return 'owned'
  } catch { return 'unverified' }
}

function Test-HostAddress([string]$Address, [switch]$Public) {
  # Do not fetch arbitrary URLs from a damaged or manually edited runtime file.
  if ($Public) { return $Address -cmatch '^https://[a-z0-9-]+\.trycloudflare\.com$' }
  return $Address -match '^http://127\.0\.0\.1:([0-9]{1,5})$' -and [int]$Matches[1] -ge 1 -and [int]$Matches[1] -le 65535
}

function Test-HostHealth([string]$Address) {
  try {
    $response = Invoke-RestMethod -Uri "$Address/health" -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
    return $response.name -eq 'Game Canvas Collaboration' -and $response.protocol -eq 1
  } catch { return $false }
}

function Get-HostFacts([string]$StateDirectory, [int]$Port, [string]$ServerEntry, [string]$CloudflaredPath) {
  $facts = [ordered]@{
    runtimeValid = $true; server = 'absent'; tunnel = 'absent'; localHealthy = $false; publicHealthy = $false
    publicUrl = ''; port = $Port; listenerPids = @(); serverPid = $null; tunnelPid = $null
    serverFile = (Test-Path -LiteralPath $ServerEntry -PathType Leaf); nodeReady = $null; nodeVersion = ''
    cloudflaredReady = $null; cloudflaredPath = ''; portChecked = $false
  }
  $runtimePath = Join-Path $StateDirectory 'runtime.json'
  if (Test-Path -LiteralPath $runtimePath) {
    try {
      $runtime = Get-Content -LiteralPath $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
      if (-not $runtime -or -not (Test-HostAddress $runtime.localUrl) -or
          ($runtime.publicUrl -and -not (Test-HostAddress $runtime.publicUrl -Public))) { throw 'Invalid metadata' }
      $facts.port = ([uri]$runtime.localUrl).Port
      $facts.publicUrl = [string]$runtime.publicUrl
      $facts.server = Get-HostProcessState $runtime.server
      $facts.tunnel = Get-HostProcessState $runtime.tunnel
      if ($runtime.server) { $facts.serverPid = [int]$runtime.server.pid }
      if ($runtime.tunnel) { $facts.tunnelPid = [int]$runtime.tunnel.pid }
    } catch { $facts.runtimeValid = $false }
  }
  try {
    # Query all listeners: an empty result is different from a failed query.
    $facts.listenerPids = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $facts.port | Select-Object -ExpandProperty OwningProcess -Unique)
    $facts.portChecked = $true
  } catch { }
  if ($facts.runtimeValid) {
    $facts.localHealthy = Test-HostHealth "http://127.0.0.1:$($facts.port)"
    if ($facts.server -eq 'owned' -and $facts.tunnel -eq 'owned' -and $facts.localHealthy -and $facts.publicUrl) {
      $facts.publicHealthy = Test-HostHealth $facts.publicUrl
    }
  }
  # Dependencies matter only when starting a new host, not when reusing one.
  if ($facts.server -eq 'absent' -and $facts.tunnel -eq 'absent') {
    $facts.nodeReady = $false
    $facts.cloudflaredReady = $false
    try {
      $node = (Get-Command node.exe -ErrorAction Stop).Source
      $version = [string](& $node --version 2>$null)
      if ($LASTEXITCODE -eq 0 -and $version -match '^v([0-9]+)\.[0-9]+\.[0-9]+$') {
        $facts.nodeVersion = $version
        $facts.nodeReady = [int]$Matches[1] -ge 24
      }
    } catch { }
    if (-not $CloudflaredPath) {
      $installed = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
      if ($installed) { $CloudflaredPath = $installed.Source }
      else { $CloudflaredPath = Join-Path $env:USERPROFILE 'Downloads/cloudflared-windows-amd64.exe' }
    }
    try {
      $facts.cloudflaredPath = [IO.Path]::GetFullPath($CloudflaredPath)
      $facts.cloudflaredReady = Test-Path -LiteralPath $facts.cloudflaredPath -PathType Leaf
    } catch { }
  }
  return [pscustomobject]$facts
}

function Get-HostDecision($Facts) {
  $code = ''
  if (-not $Facts.runtimeValid) { $code = 'GC-HOST-005' }
  elseif ($Facts.server -eq 'unverified' -or $Facts.tunnel -eq 'unverified' -or -not $Facts.portChecked) { $code = 'GC-HOST-007' }
  elseif ($Facts.server -eq 'owned' -and $Facts.tunnel -eq 'owned') {
    if (-not $Facts.localHealthy) { $code = 'GC-HOST-009' }
    elseif (-not $Facts.publicHealthy) { $code = 'GC-HOST-010' }
    else { return [pscustomobject]@{ action = 'reuse'; code = '' } }
  }
  elseif ($Facts.server -eq 'owned' -or $Facts.tunnel -eq 'owned') { $code = 'GC-HOST-008' }
  elseif ($Facts.listenerPids.Count -gt 0 -or $Facts.localHealthy) { $code = 'GC-HOST-006' }
  elseif (-not $Facts.serverFile) { $code = 'GC-HOST-002' }
  elseif (-not $Facts.nodeReady) { $code = 'GC-HOST-003' }
  elseif (-not $Facts.cloudflaredReady) { $code = 'GC-HOST-004' }
  else { return [pscustomobject]@{ action = 'start'; code = '' } }
  return [pscustomobject]@{ action = 'blocked'; code = $code }
}

function New-HostReport($Facts, [string]$Status, [string]$Code) {
  # Explicit allowlist: never include raw exceptions, logs, keys, CLI args or documents.
  return [pscustomobject]@{
    schemaVersion = 1; checkedAt = [DateTime]::UtcNow.ToString('o'); status = $Status; code = $Code
    publicUrl = $Facts.publicUrl; port = $Facts.port; serverPid = $Facts.serverPid; tunnelPid = $Facts.tunnelPid
    listenerPids = @($Facts.listenerPids)
    checks = [pscustomobject]@{
      runtimeValid = $Facts.runtimeValid; serverOwnership = $Facts.server; tunnelOwnership = $Facts.tunnel
      localHealthy = $Facts.localHealthy; publicHealthy = $Facts.publicHealthy; portChecked = $Facts.portChecked
      serverFile = $Facts.serverFile; nodeReady = $Facts.nodeReady; nodeVersion = $Facts.nodeVersion; cloudflaredReady = $Facts.cloudflaredReady
    }
  }
}
