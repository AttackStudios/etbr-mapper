# Dev UI automation in the interactive session. Reads steps from C:\Users\JackPC\ETBRMapper\click.txt:
#   click X Y   |   type some text   |   key {ENTER}   |   wait MS
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class M { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e); }
"@
foreach ($line in Get-Content 'C:\Users\JackPC\ETBRMapper\click.txt') {
  $p = $line.Trim() -split '\s+', 2
  switch ($p[0]) {
    'click' { $xy = $p[1] -split '\s+'; [M]::SetCursorPos([int]$xy[0], [int]$xy[1]); Start-Sleep -Milliseconds 200
              [M]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 80; [M]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero) }
    'type'  { [System.Windows.Forms.SendKeys]::SendWait($p[1]) }
    'key'   { [System.Windows.Forms.SendKeys]::SendWait($p[1]) }
    'wait'  { Start-Sleep -Milliseconds ([int]$p[1]) }
  }
  Start-Sleep -Milliseconds 250
}
