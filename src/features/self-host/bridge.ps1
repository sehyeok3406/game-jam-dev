param(
  [ValidateSet('Check', 'Start', 'Stop', 'Key')][string]$Action = 'Check',
  [Parameter(Mandatory=$true)][string]$StateDirectory,
  [Parameter(Mandatory=$true)][string]$RuntimeDirectory,
  [string]$CloudflaredPath = '',
  [int]$Port = 4318,
  [string]$ReportFile = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $RuntimeDirectory 'diagnostics.ps1')
function Write-BridgeReport([string]$Value) {
  if ($ReportFile) { [IO.File]::WriteAllText($ReportFile, $Value, (New-Object Text.UTF8Encoding $false)) }
  else { [Console]::Write($Value) }
}
try {
  if ($Action -eq 'Key') {
    $encrypted = Import-Clixml -LiteralPath (Join-Path $StateDirectory 'creation-key.clixml')
    if ($encrypted -isnot [Security.SecureString]) { throw 'Invalid key' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($encrypted)
    try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    exit 0
  }
  $node = Join-Path $RuntimeDirectory 'node.exe'
  $entry = Join-Path $RuntimeDirectory 'server.mjs'
  if ($Action -eq 'Check') {
    $facts = Get-HostFacts $StateDirectory $Port $entry $CloudflaredPath $node
    $decision = Get-HostDecision $facts
    $status = 'ready-to-start'
    if ($decision.action -eq 'reuse') { $status = 'already-running' }
    elseif ($decision.action -eq 'blocked') { $status = 'failed' }
    Write-BridgeReport (New-HostReport $facts $status $decision.code | ConvertTo-Json -Depth 5 -Compress)
    if ($decision.action -eq 'blocked') { exit 1 }
    exit 0
  }
  if ($Action -eq 'Stop') {
    $facts = Get-HostFacts $StateDirectory $Port $entry $CloudflaredPath $node
    if (-not $facts.runtimeValid -or $facts.server -eq 'unverified' -or $facts.tunnel -eq 'unverified') { throw 'Ownership cannot be verified' }
    # Read durable server state before stopping: never interrupt an active AI lease.
    $projects = Join-Path $StateDirectory 'projects'
    if (Test-Path -LiteralPath $projects) {
      foreach ($folder in Get-ChildItem -LiteralPath $projects -Directory) {
        if ($folder.Name -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid project directory' }
        $runtimeState = Join-Path $folder.FullName 'runtime.json'
        if (Test-Path -LiteralPath $runtimeState) {
          $state = Get-Content -LiteralPath $runtimeState -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
          $head = Get-Content -LiteralPath (Join-Path $folder.FullName 'head.json') -Raw -Encoding UTF8 | ConvertFrom-Json
          if ($head.checkpoint -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid checkpoint' }
          $state = Get-Content -LiteralPath (Join-Path $folder.FullName "checkpoints/$($head.checkpoint)/state.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        if ($state.job) { Write-BridgeReport '{"code":"GC-HOST-AI"}'; exit 1 }
      }
    }
    $null = & "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RuntimeDirectory 'host.ps1') -Action Stop -StateDirectory $StateDirectory -NodePath $node -ServerEntry $entry 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed' }
    $facts = Get-HostFacts $StateDirectory $Port $entry $CloudflaredPath $node
    if ($facts.server -ne 'absent' -or $facts.tunnel -ne 'absent') { throw 'Stop incomplete' }
    Write-BridgeReport (New-HostReport $facts 'stopped' '' | ConvertTo-Json -Depth 5 -Compress)
    exit 0
  }
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RuntimeDirectory 'connect.ps1'), '-Json', '-NoPrompt', '-StateDirectory', $StateDirectory, '-NodePath', $node, '-ServerEntry', $entry, '-Port', [string]$Port)
  if ($CloudflaredPath) { $arguments += @('-CloudflaredPath', $CloudflaredPath) }
  $logs = Join-Path $StateDirectory 'logs'
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  $stamp = [guid]::NewGuid().ToString('N')
  $inputFile = Join-Path $logs "bridge-$stamp.in"
  [IO.File]::WriteAllText($inputFile, '')
  $quotedArguments = @($arguments | ForEach-Object { '"' + [regex]::Replace([regex]::Replace([string]$_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"' })
  $startedAt = [DateTime]::UtcNow
  $launcher = Start-Process -FilePath "$PSHOME/powershell.exe" -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru -RedirectStandardInput $inputFile -RedirectStandardOutput (Join-Path $logs "bridge-$stamp.out.log") -RedirectStandardError (Join-Path $logs "bridge-$stamp.err.log")
  $null = $launcher.Handle
  if (-not $launcher.WaitForExit(300000)) { throw 'Launcher timeout' }
  $exitCode = $launcher.ExitCode
  $connectionReport = Get-Item -LiteralPath (Join-Path $StateDirectory 'connection-report.json')
  if ($connectionReport.LastWriteTimeUtc -lt $startedAt) { throw 'Stale report' }
  Write-BridgeReport ([IO.File]::ReadAllText($connectionReport.FullName))
  exit $exitCode
} catch {
  # Never let PowerShell display private JSON, keys, or raw exceptions.
  Write-BridgeReport '{"code":"GC-HOST-099"}'
  exit 1
}
