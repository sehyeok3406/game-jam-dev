param(
  [ValidateSet('Start', 'Stop', 'Status', 'CopyKey', 'RestartServer')]
  [string]$Action = 'Status',
  [string]$CloudflaredPath = '',
  [int]$Port = 4318,
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'GameCanvas-InternetHost'),
  [string]$FailureReport = ''
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
$script:HostFailureCode = 'GC-HOST-099'
# The one-click launcher consumes only this phase code, never raw exceptions.
trap {
  if ($FailureReport) {
    $failureLine = $_.InvocationInfo.ScriptLineNumber
    $failureType = $_.Exception.GetType().FullName
    try {
      $failureDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($FailureReport))
      New-Item -ItemType Directory -Path $failureDirectory -Force | Out-Null
      @{ schemaVersion = 1; code = $script:HostFailureCode; scriptLine = $failureLine; exceptionType = $failureType } | ConvertTo-Json | Set-Content -LiteralPath $FailureReport -Encoding UTF8
    } catch { }
    exit 1
  }
  throw $_
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
$runtimeFile = Join-Path $StateDirectory 'runtime.json'
$keyFile = Join-Path $StateDirectory 'creation-key.clixml'
$serverEntry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../out/collaboration-server/server.mjs'))

function Read-Runtime {
  if (Test-Path -LiteralPath $runtimeFile) {
    return Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  }
  return $null
}
function Get-OwnedProcess($Record) {
  if (-not $Record) { return $null }
  $found = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Record.pid)" -ErrorAction SilentlyContinue
  if (-not $found) { return $null }
  # PID reuse must never terminate an unrelated user process.
  if (-not $found.CreationDate -or -not $found.ExecutablePath -or -not $found.CommandLine -or -not $Record.marker) { return $null }
  if ($found.CreationDate.ToUniversalTime().ToString('o') -ne $Record.createdAt) { return $null }
  if ($found.ExecutablePath -ne $Record.executable) { return $null }
  if (-not $found.CommandLine.Contains([string]$Record.marker)) { return $null }
  return $found
}
function Process-Record($Process, [string]$Executable, [string]$Marker) {
  $found = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)"
  if (-not $found) { throw 'The helper process exited before startup completed. Check the logs.' }
  return @{
    pid = $Process.Id
    createdAt = $found.CreationDate.ToUniversalTime().ToString('o')
    executable = $Executable
    marker = $Marker
  }
}
function Stop-Owned($Runtime) {
  foreach ($record in @($Runtime.tunnel, $Runtime.server)) {
    $found = Get-OwnedProcess $record
    if ($found) { Stop-Process -Id $found.ProcessId -ErrorAction Stop }
  }
}
function Read-CreationKey {
  # Export-Clixml uses Windows DPAPI: only this Windows user can decrypt the key.
  $encrypted = Import-Clixml -LiteralPath $keyFile
  if ($encrypted -isnot [Security.SecureString]) { throw 'Invalid encrypted creation key.' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($encrypted)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Test-Health([string]$Address) {
  try {
    $health = Invoke-RestMethod -Uri "$Address/health" -TimeoutSec 5
    return $health.name -eq 'Game Canvas Collaboration' -and $health.protocol -eq 1
  } catch { return $false }
}

$script:HostFailureCode = 'GC-HOST-005'
$existing = Read-Runtime
if ($Action -eq 'Stop') {
  if ($existing) { Stop-Owned $existing }
  Write-Output 'Internet collaboration host stopped. Saved projects and the encrypted key are kept.'
  exit 0
}
if ($Action -eq 'CopyKey') {
  if (-not (Test-Path -LiteralPath $keyFile)) { throw 'Start the host first.' }
  Set-Clipboard -Value (Read-CreationKey)
  Write-Output 'Administrator server creation key copied. Paste it into Game Canvas; never share it with participants.'
  exit 0
}
if ($Action -eq 'Status') {
  if (-not $existing) { Write-Output 'Host has not been started.'; exit 0 }
  $serverAlive = [bool](Get-OwnedProcess $existing.server)
  $tunnelAlive = [bool](Get-OwnedProcess $existing.tunnel)
  [pscustomobject]@{
    serverRunning = $serverAlive
    tunnelRunning = $tunnelAlive
    publicUrl = $existing.publicUrl
    publicHealthy = ($serverAlive -and $tunnelAlive -and (Test-Health $existing.publicUrl))
    dataDirectory = (Join-Path $StateDirectory 'projects')
  } | ConvertTo-Json
  exit 0
}
if ($Action -eq 'RestartServer') {
  # Updating the collaboration API must not replace the Quick Tunnel URL.
  if (-not $existing -or -not (Get-OwnedProcess $existing.tunnel)) {
    throw 'A managed tunnel must be running. No process was changed.'
  }
  $ownedServer = Get-OwnedProcess $existing.server
  if (-not $ownedServer -or $existing.server.marker -ne $serverEntry) {
    throw 'The original managed server must be running. No process was changed.'
  }
  $address = [uri]$existing.localUrl
  if ($address.Scheme -ne 'http' -or $address.Host -ne '127.0.0.1') {
    throw 'Invalid managed server address. No process was changed.'
  }
  if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
    throw 'Build the new server first: npm run collaboration:build'
  }
  # Never interrupt an active AI lease. Only inspect current checkpoint state;
  # do not print document contents, tokens, nicknames or the creation key.
  $projectsPath = Join-Path $StateDirectory 'projects'
  if (Test-Path -LiteralPath $projectsPath) {
    foreach ($folder in Get-ChildItem -LiteralPath $projectsPath -Directory) {
      if ($folder.Name -notmatch '^[a-f0-9-]{36}$') { throw 'Unexpected project directory; no process was changed.' }
      try {
        $runtimeStatePath = Join-Path $folder.FullName 'runtime.json'
        if (Test-Path -LiteralPath $runtimeStatePath) {
          $checkpoint = Get-Content -LiteralPath $runtimeStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
          $head = Get-Content -LiteralPath (Join-Path $folder.FullName 'head.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($head.checkpoint -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid checkpoint identifier.' }
        $checkpoint = Get-Content -LiteralPath (Join-Path $folder.FullName "checkpoints/$($head.checkpoint)/state.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        }
      } catch {
        # PowerShell parser errors can include the complete private JSON value.
        throw 'Cannot inspect a current project checkpoint. No process was changed; private checkpoint contents were withheld.'
      }
      if ($checkpoint.job) { throw 'An AI job is active. Finish or stop it in the app before restarting. No process was changed.' }
    }
  }
  $creationKey = Read-CreationKey
  $savedEnvironment = @{}
  $newServer = $null
  try {
    foreach ($name in @('GAME_CANVAS_HOST', 'GAME_CANVAS_PORT', 'GAME_CANVAS_DATA', 'GAME_CANVAS_SERVER_KEY', 'GAME_CANVAS_PUBLIC')) {
      $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:GAME_CANVAS_HOST = '127.0.0.1'
    $env:GAME_CANVAS_PORT = [string]$address.Port
    $env:GAME_CANVAS_DATA = $projectsPath
    $env:GAME_CANVAS_SERVER_KEY = $creationKey
    $env:GAME_CANVAS_PUBLIC = '1'
    $stamp = [guid]::NewGuid().ToString('N')
    $logs = Join-Path $StateDirectory 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    # Revalidate ownership immediately before stopping the single API process.
    $ownedServer = Get-OwnedProcess $existing.server
    if (-not $ownedServer) { throw 'Server ownership changed; no process was stopped.' }
    Stop-Process -Id $ownedServer.ProcessId -ErrorAction Stop
    $newServer = Start-Process -FilePath $existing.server.executable -ArgumentList "`"$serverEntry`"" -WorkingDirectory $StateDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "server-$stamp.out.log") -RedirectStandardError (Join-Path $logs "server-$stamp.err.log")
    $existing.server = Process-Record $newServer $existing.server.executable $serverEntry
    $existing | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runtimeFile -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      if ($newServer.HasExited) { throw 'Updated server exited. Check the server logs; the tunnel and saved data were kept.' }
      if (Test-Health $existing.localUrl) { $ready = $true; break }
      Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'Updated server health check failed. The tunnel and saved data were kept.' }
    if (-not (Test-Health $existing.publicUrl)) { throw 'Local server is ready but the public route is not yet reachable. Use Status; the tunnel and saved data were kept.' }
    Write-Output "Collaboration API updated; tunnel address unchanged: $($existing.publicUrl)"
  } finally {
    foreach ($name in $savedEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    $creationKey = $null
  }
  exit 0
}
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid port.' }
if ($existing -and (Get-OwnedProcess $existing.server) -and (Get-OwnedProcess $existing.tunnel)) {
  $script:HostFailureCode = 'GC-HOST-010'
  if (-not (Test-Health $existing.publicUrl)) { throw 'Existing host is running but unreachable. Check its logs, or explicitly Stop then Start.' }
  Write-Output "Already running: $($existing.publicUrl)"
  exit 0
}
if ($existing -and ((Get-OwnedProcess $existing.server) -or (Get-OwnedProcess $existing.tunnel))) {
  $script:HostFailureCode = 'GC-HOST-008'
  throw 'A previous helper is still running. Use Stop before restarting; no existing process was changed.'
}
$script:HostFailureCode = 'GC-HOST-002'
if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
  throw 'Build the server first: npm run collaboration:build'
}
$script:HostFailureCode = 'GC-HOST-003'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $nodePath --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or later is required.' }
$script:HostFailureCode = 'GC-HOST-004'
if (-not $CloudflaredPath) {
  $installed = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($installed) { $CloudflaredPath = $installed.Source }
  else { $CloudflaredPath = Join-Path $env:USERPROFILE 'Downloads/cloudflared-windows-amd64.exe' }
}
$CloudflaredPath = [IO.Path]::GetFullPath($CloudflaredPath)
if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) { throw 'Official cloudflared executable not found. Specify -CloudflaredPath.' }
$script:HostFailureCode = 'GC-HOST-006'
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Port $Port is in use. No existing server was stopped."
}
$script:HostFailureCode = 'GC-HOST-013'
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $keyFile)) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes) | ConvertTo-SecureString -AsPlainText -Force | Export-Clixml -LiteralPath $keyFile
}
$creationKey = Read-CreationKey
$localUrl = "http://127.0.0.1:$Port"
$logs = Join-Path $StateDirectory 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = [guid]::NewGuid().ToString('N')
$serverOut = Join-Path $logs "server-$stamp.out.log"
$serverErr = Join-Path $logs "server-$stamp.err.log"
$tunnelOut = Join-Path $logs "tunnel-$stamp.out.log"
$tunnelErr = Join-Path $logs "tunnel-$stamp.err.log"
$runtime = @{ publicUrl = ''; localUrl = $localUrl; server = $null; tunnel = $null }
$script:HostFailureCode = 'GC-HOST-015'
$savedEnvironment = @{}
try {
  foreach ($name in @('GAME_CANVAS_HOST', 'GAME_CANVAS_PORT', 'GAME_CANVAS_DATA', 'GAME_CANVAS_SERVER_KEY', 'GAME_CANVAS_PUBLIC')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  $env:GAME_CANVAS_HOST = '127.0.0.1'
  $env:GAME_CANVAS_PORT = [string]$Port
  $env:GAME_CANVAS_DATA = Join-Path $StateDirectory 'projects'
  $env:GAME_CANVAS_SERVER_KEY = $creationKey
  $env:GAME_CANVAS_PUBLIC = '1'
  $script:HostFailureCode = 'GC-HOST-011'
  $server = Start-Process -FilePath $nodePath -ArgumentList "`"$serverEntry`"" -WorkingDirectory $StateDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
  $runtime.server = Process-Record $server $nodePath $serverEntry
  # The tunnel does not inherit the application's creation key.
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
  $script:HostFailureCode = 'GC-HOST-009'
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-Health $localUrl) { $ready = $true; break }
    if ($server.HasExited) { $script:HostFailureCode = 'GC-HOST-011'; throw "Server exited. Check $serverErr" }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw "Server startup timed out. Check $serverErr" }
  # Only the dedicated localhost collaboration API is forwarded; no renderer,
  # filesystem server, debugging port, home directory or other PC service.
  $script:HostFailureCode = 'GC-HOST-012'
  $tunnel = Start-Process -FilePath $CloudflaredPath -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', $localUrl) -WorkingDirectory $StateDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr
  $runtime.tunnel = Process-Record $tunnel $CloudflaredPath $localUrl
  $script:HostFailureCode = 'GC-HOST-015'
  $runtime | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runtimeFile -Encoding UTF8
  $script:HostFailureCode = 'GC-HOST-010'
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if ($tunnel.HasExited) { $script:HostFailureCode = 'GC-HOST-012'; throw "Tunnel exited. Check $tunnelErr" }
    $text = (Get-Content -LiteralPath $tunnelErr -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $tunnelOut -Raw -ErrorAction SilentlyContinue)
    if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
      $runtime.publicUrl = $Matches[0]
      if (Test-Health $runtime.publicUrl) { break }
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $runtime.publicUrl -or -not (Test-Health $runtime.publicUrl)) {
    throw "Public health check failed. Check $tunnelErr"
  }
  $script:HostFailureCode = 'GC-HOST-015'
  $runtime | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runtimeFile -Encoding UTF8
  Write-Output "Internet collaboration ready: $($runtime.publicUrl)"
  Write-Output "Projects: $(Join-Path $StateDirectory 'projects')"
  Write-Output 'Use Copy-Server-Key.cmd for the administrator key. Participants receive ONLY the public URL and invite code.'
} catch {
  Stop-Owned $runtime
  throw
} finally {
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
  $creationKey = $null
}
