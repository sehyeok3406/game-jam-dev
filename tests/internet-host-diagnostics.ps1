param([string]$ProjectDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectDirectory 'tools/internet-host/diagnostics.ps1')
$script:assertions = 0
function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) { throw "Assertion failed: $Label (expected $Expected, got $Actual)" }
  $script:assertions++
}
function New-Facts {
  return [pscustomobject]@{
    runtimeValid = $true; server = 'absent'; tunnel = 'absent'; portChecked = $true
    localHealthy = $false; publicHealthy = $false; publicUrl = ''; port = 4318
    listenerPids = @(); serverPid = $null; tunnelPid = $null
    serverFile = $true; nodeReady = $true; nodeVersion = 'v24.19.0'; cloudflaredReady = $true
  }
}
$facts = New-Facts
Assert-Equal (Get-HostDecision $facts).action 'start' 'fresh startup'
$facts.server = 'owned'; $facts.tunnel = 'owned'; $facts.localHealthy = $true; $facts.publicHealthy = $true
$facts.nodeReady = $false; $facts.cloudflaredReady = $false; $facts.serverFile = $false
Assert-Equal (Get-HostDecision $facts).action 'reuse' 'healthy host does not need startup dependencies'
$facts.publicHealthy = $false
Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-010' 'external failure must not restart host'
$facts.localHealthy = $false
Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-009' 'local failure'
foreach ($pair in @(@('owned', 'absent'), @('absent', 'owned'))) {
  $facts = New-Facts; $facts.server = $pair[0]; $facts.tunnel = $pair[1]
  Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-008' 'partial host'
}
foreach ($pair in @(@('unverified', 'absent'), @('owned', 'unverified'))) {
  $facts = New-Facts; $facts.server = $pair[0]; $facts.tunnel = $pair[1]
  Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-007' 'unverified process'
}
$facts = New-Facts; $facts.listenerPids = @(42, 43)
Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-006' 'foreign listeners'
$facts = New-Facts; $facts.localHealthy = $true
Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-006' 'unmanaged healthy server'
$facts = New-Facts; $facts.portChecked = $false
Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-007' 'failed port inspection is not an empty port'
$facts = New-Facts; $facts.runtimeValid = $false
Assert-Equal (Get-HostDecision $facts).code 'GC-HOST-005' 'invalid metadata'
foreach ($entry in @(@('serverFile', 'GC-HOST-002'), @('nodeReady', 'GC-HOST-003'), @('cloudflaredReady', 'GC-HOST-004'))) {
  $facts = New-Facts; $facts.($entry[0]) = $false
  Assert-Equal (Get-HostDecision $facts).code $entry[1] 'missing dependency'
}
foreach ($address in @('http://127.0.0.1:4318', 'http://127.0.0.1:65535')) {
  Assert-Equal (Test-HostAddress $address) $true 'valid local URL'
}
foreach ($address in @('http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://localhost:4318', 'http://127.0.0.1:4318/private', 'http://other.invalid:4318')) {
  Assert-Equal (Test-HostAddress $address) $false 'reject unsafe local URL'
}
Assert-Equal (Test-HostAddress 'https://example-safe.trycloudflare.com' -Public) $true 'valid quick tunnel'
foreach ($address in @('https://user:secret@example.trycloudflare.com', 'https://example.trycloudflare.com/secret', 'http://example.trycloudflare.com', 'https://other.invalid')) {
  Assert-Equal (Test-HostAddress $address -Public) $false 'reject unsafe public URL'
}
$facts = New-Facts
$facts | Add-Member -NotePropertyName secret -NotePropertyValue 'NEVER_REPORT_THIS'
$json = New-HostReport $facts 'failed' 'GC-HOST-006' | ConvertTo-Json -Depth 5
Assert-Equal $json.Contains('NEVER_REPORT_THIS') $false 'report is allowlisted'
Assert-Equal (Get-HostHelp 'unexpected secret').code 'GC-HOST-099' 'unknown error sanitized'
# Mock CIM for PID reuse and inaccessible process fields; never launch/stop anything.
$script:processFixture = $null
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $script:processFixture }
Assert-Equal (Get-HostProcessState $null) 'absent' 'no record'
$record = [pscustomobject]@{ pid = 42; createdAt = '2026-10-01T00:00:00.0000000Z'; executable = 'node.exe'; marker = 'server.mjs' }
Assert-Equal (Get-HostProcessState $record) 'absent' 'exited process'
$script:processFixture = [pscustomobject]@{ CreationDate = [DateTime]::Parse('2026-10-01T00:00:00Z').ToUniversalTime(); ExecutablePath = 'node.exe'; CommandLine = 'node.exe server.mjs' }
Assert-Equal (Get-HostProcessState $record) 'owned' 'matching owned process'
$record.createdAt = '2026-10-02T00:00:00.0000000Z'
Assert-Equal (Get-HostProcessState $record) 'unverified' 'PID reuse'
$script:processFixture.CommandLine = $null
Assert-Equal (Get-HostProcessState $record) 'unverified' 'missing privilege fields'
$record.pid = 'invalid'
Assert-Equal (Get-HostProcessState $record) 'unverified' 'invalid PID'
Write-Output "Passed $script:assertions host diagnostic assertions."
