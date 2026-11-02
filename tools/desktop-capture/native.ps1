param([ValidateSet('Capture','Hotkey','Affinity')][string]$Mode = 'Capture', [string]$Output, [string]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class NativeDesktop {
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
 [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
 [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
 [DllImport("gdi32.dll", SetLastError=true)] static extern bool BitBlt(IntPtr dst,int x,int y,int w,int h,IntPtr src,int sx,int sy,uint op);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 public static void Toggle() {
  keybd_event(0x11,0,0,UIntPtr.Zero); keybd_event(0x12,0,0,UIntPtr.Zero); keybd_event(0x79,0,0,UIntPtr.Zero);
  keybd_event(0x79,0,2,UIntPtr.Zero); keybd_event(0x12,0,2,UIntPtr.Zero); keybd_event(0x11,0,2,UIntPtr.Zero);
 }
 public static string Frame(string path, int w, int h) {
  using(var b = new Bitmap(w,h,PixelFormat.Format24bppRgb)) {
   using(var g = Graphics.FromImage(b)) {
    IntPtr src=GetDC(IntPtr.Zero), dst=g.GetHdc();
    try {if(src==IntPtr.Zero || !BitBlt(dst,0,0,w,h,src,0,0,0x40CC0020)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
    finally {g.ReleaseHdc(dst);if(src!=IntPtr.Zero)ReleaseDC(IntPtr.Zero,src);}
   }
   var d=b.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format24bppRgb);
   byte[] p=new byte[d.Stride*h]; Marshal.Copy(d.Scan0,p,0,p.Length);
   long samples=0, other=0, dark=0, pink=0; int heartbeat=0;
   for(int y=0;y<h;y+=4) for(int x=0;x<w;x+=4) {
    int i=y*d.Stride+x*3, blue=p[i],green=p[i+1],red=p[i+2];
    if(y<48) {if(x<48) heartbeat+=red; continue;}
    samples++;
    bool bg=(Math.Abs(red-32)<8 && Math.Abs(green-192)<8 && Math.Abs(blue-176)<8) || (Math.Abs(red-224)<8 && Math.Abs(green-192)<8 && Math.Abs(blue-64)<8);
    if(!bg) other++; if(red<20 && green<20 && blue<20) dark++;
    if(red>230 && blue>190 && green<35) pink++;
   }
   b.UnlockBits(d); b.Save(path,ImageFormat.Jpeg);
   return "\"samples\":"+samples+",\"nonBackground\":"+other+",\"dark\":"+dark+",\"canary\":"+pink+",\"heartbeat\":"+heartbeat;
  }
 }
}
'@ -ReferencedAssemblies System.Drawing
[NativeDesktop]::SetProcessDPIAware() | Out-Null
if ($Mode -eq 'Hotkey') { [NativeDesktop]::Toggle(); exit }
if ($Mode -eq 'Affinity') {
 $affinity = [uint32]0
 $ok = [NativeDesktop]::GetWindowDisplayAffinity([IntPtr]::new([long]$Handle), [ref]$affinity)
 @{ok=$ok; affinity=$affinity} | ConvertTo-Json -Compress
 if (-not $ok) {exit 1}; exit
}
New-Item -ItemType Directory -Force "$Output/frames" | Out-Null
$w=[NativeDesktop]::GetSystemMetrics(0); $h=[NativeDesktop]::GetSystemMetrics(1)
@{width=$w;height=$h;backend='Windows GDI BitBlt(SRCCOPY|CAPTUREBLT)';interactive=[Environment]::UserInteractive;started=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content "$Output/native.json"
$writer=[IO.StreamWriter]::new("$Output/frames.jsonl")
try {
 $timer=[Diagnostics.Stopwatch]::StartNew(); $n=0
 while ($timer.Elapsed.TotalSeconds -lt 90 -and -not (Test-Path "$Output/stop")) {
  $start=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $metric=[NativeDesktop]::Frame((Join-Path $Output ('frames/{0:D6}.jpg' -f $n)),$w,$h)
  $end=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $writer.WriteLine('{"frame":'+$n+',"startMs":'+$start+',"endMs":'+$end+','+$metric+'}')
  $writer.Flush()
  if($n -eq 0) {Set-Content "$Output/ready" 'ready'}
  $n++; $delay=[int](($n*1000/30)-$timer.Elapsed.TotalMilliseconds)
  if($delay -gt 0) {Start-Sleep -Milliseconds $delay}
 }
} finally {$writer.Dispose()}
