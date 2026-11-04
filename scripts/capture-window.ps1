param([long]$WindowHandle,[string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TempoCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left;public int Top;public int Right;public int Bottom;}
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle,out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
[TempoCapture]::SetProcessDPIAware() | Out-Null
$handle=[IntPtr]::new($WindowHandle)
[TempoCapture]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 300
$r=[TempoCapture+RECT]::new()
if(![TempoCapture]::GetWindowRect($handle,[ref]$r)){throw '无法获取应用窗口位置'}
$bmp=[Drawing.Bitmap]::new(($r.Right-$r.Left),($r.Bottom-$r.Top))
$g=[Drawing.Graphics]::FromImage($bmp)
try {$g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size);$bmp.Save($OutputPath)}finally{$g.Dispose();$bmp.Dispose()}
