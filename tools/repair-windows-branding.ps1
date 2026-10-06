param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$sourceIcon = [IO.Path]::GetFullPath($IconPath)
$updater = Join-Path $installRoot 'Update.exe'
$launcher = Join-Path $installRoot 'Game Canvas.exe'
if ((Split-Path -Leaf $installRoot) -ne 'game_canvas' -or
    -not (Test-Path -LiteralPath $updater -PathType Leaf) -or
    -not (Test-Path -LiteralPath $launcher -PathType Leaf) -or
    -not (Test-Path -LiteralPath $sourceIcon -PathType Leaf)) {
  throw 'This repair requires an existing Game Jam! Squirrel installation and its bundled icon.'
}

$installedIcon = Join-Path $installRoot 'game-jam.ico'
Copy-Item -LiteralPath $sourceIcon -Destination $installedIcon -Force
Copy-Item -LiteralPath $sourceIcon -Destination (Join-Path $installRoot 'app.ico') -Force
# Explicitly use a new icon path so shortcuts bypass the cached Electron icon.
$shortcutArguments = @('--createShortcut="Game Canvas.exe"', ('--icon="' + $installedIcon + '"'))
$shortcutProcess = Start-Process -FilePath $updater -ArgumentList $shortcutArguments -WindowStyle Hidden -Wait -PassThru
if ($shortcutProcess.ExitCode -ne 0) { throw 'Squirrel failed to update the app shortcuts.' }

$shortcutReader = New-Object -ComObject WScript.Shell
$shortcutDirectories = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'sehyeok3406')
)
foreach ($directory in $shortcutDirectories) {
  $legacyLink = Join-Path $directory 'Game Canvas.lnk'
  $currentLink = Join-Path $directory 'Game Jam!.lnk'
  if ((Test-Path -LiteralPath $legacyLink) -and (Test-Path -LiteralPath $currentLink)) {
    $legacy = $shortcutReader.CreateShortcut($legacyLink)
    $current = $shortcutReader.CreateShortcut($currentLink)
    if ($legacy.TargetPath -ieq $launcher -and $current.TargetPath -ieq $launcher) {
      $backupDirectory = Join-Path $installRoot 'branding-backup'
      New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
      $backupName = if ($directory -eq $shortcutDirectories[0]) { 'desktop-Game Canvas.lnk' } else { 'start-menu-Game Canvas.lnk' }
      Copy-Item -LiteralPath $legacyLink -Destination (Join-Path $backupDirectory $backupName) -Force
      Remove-Item -LiteralPath $legacyLink
    }
  }
}

$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\game_canvas'
if (Test-Path -LiteralPath $registryPath) {
  $registration = Get-ItemProperty -LiteralPath $registryPath
  if ($registration.InstallLocation -ieq $installRoot) {
    Set-ItemProperty -LiteralPath $registryPath -Name DisplayIcon -Value $installedIcon
  }
}

# Refresh shell icons without closing Explorer or any application window.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GameJamShellIcons {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr first, IntPtr second);
}
'@
[GameJamShellIcons]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
@{ version = $Version; iconHash = (Get-FileHash -LiteralPath $sourceIcon -Algorithm SHA256).Hash } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'game-jam-branding.json') -Encoding UTF8
Write-Output 'Game Jam! shortcuts and installed icons repaired.'
