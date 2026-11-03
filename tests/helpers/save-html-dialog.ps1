param([int]$TargetProcessId,[string]$Destination,[switch]$Cancel)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class GameJamSaveDialog {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr wparam,string text);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
}
"@
$dialogElement=$null
$handle=[IntPtr]::Zero
try {
  $condition=New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')))
  for($attempt=0;$attempt -lt 150;$attempt++) {
    $dialogElement=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
    if($dialogElement){break}
    Start-Sleep -Milliseconds 100
  }
  if(!$dialogElement){throw 'The test application save dialog did not open.'}
  $handle=[IntPtr]$dialogElement.Current.NativeWindowHandle
  if(!$Cancel){
    $script:nameHandle=[IntPtr]::Zero
    $callback=[GameJamSaveDialog+EnumProc]{param($child,$data)
      $class=New-Object System.Text.StringBuilder 256
      [void][GameJamSaveDialog]::GetClassName($child,$class,256)
      if($class.ToString() -eq 'Edit' -and [GameJamSaveDialog]::GetDlgCtrlID($child) -eq 1001){$script:nameHandle=$child}
      return $true
    }
    for($attempt=0;$attempt -lt 100;$attempt++){
      [void][GameJamSaveDialog]::EnumChildWindows($handle,$callback,[IntPtr]::Zero)
      if($script:nameHandle -ne [IntPtr]::Zero){break}
      Start-Sleep -Milliseconds 100
    }
    if($script:nameHandle -eq [IntPtr]::Zero -or ![GameJamSaveDialog]::IsChild($handle,$script:nameHandle)){throw 'The owned filename edit is missing.'}
    [void][GameJamSaveDialog]::SendMessage($script:nameHandle,0x000C,[IntPtr]::Zero,$Destination)
  }
  $command=if($Cancel){2}else{1}
  [void][GameJamSaveDialog]::PostMessage($handle,0x0111,[IntPtr]$command,[IntPtr]::Zero)
  Write-Output 'PASS: owned native save dialog'
}catch{
  if($handle -ne [IntPtr]::Zero){[void][GameJamSaveDialog]::PostMessage($handle,0x0111,[IntPtr]2,[IntPtr]::Zero)}
  Write-Output $_.ScriptStackTrace
  Write-Error $_
  exit 1
}
