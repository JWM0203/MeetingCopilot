# E2E smoke: launch the app with auto-capture, play the Chinese fixture out
# loud, and assert transcript segments appear in the main-process log.
# Run from the project root:  pwsh -NoProfile -File tools/e2e-smoke.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$log = Join-Path $env:TEMP "mc-e2e-$(Get-Date -Format yyyyMMdd-HHmmss).log"
$wav = Join-Path $env:TEMP 'mc-e2e-zh.wav'

node tools/f32-to-wav.mjs test/fixtures/zh_16k.f32 $wav

$env:MC_AUTOSTART = '1'
$proc = Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList '.' `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden

try {
  # wait for ASR ready (model load + warm can take ~30s cold)
  $deadline = (Get-Date).AddSeconds(120)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern '\[asr\] ready' -Quiet)) { $ready = $true; break }
    if ($proc.HasExited) { throw "app exited early, see $log / $log.err" }
  }
  if (-not $ready) { throw "ASR not ready within 120s, see $log" }
  Write-Host "ASR ready. Playing fixture..."
  Start-Sleep -Seconds 3   # let auto-capture attach

  Add-Type -AssemblyName PresentationCore
  $player = New-Object System.Windows.Media.MediaPlayer
  $player.Open([Uri]$wav)
  $player.Volume = 1.0
  $player.Play()
  Start-Sleep -Seconds 15  # 10.3s zh audio + tail

  # English fixture (tests the zh/en LID路由); MC_E2E_ZH_ONLY=1 skips it
  $zhOnly = $env:MC_E2E_ZH_ONLY -eq '1'
  if (-not $zhOnly) {
    $enWav = Join-Path $root 'test\fixtures\en_test.wav'
    $player.Open([Uri]$enWav)
    $player.Play()
    Start-Sleep -Seconds 12  # 8.8s en audio + tail
  }

  # give VAD hangover + inference time
  Start-Sleep -Seconds 6
  $segments = Select-String -Path $log -Pattern '\[asr\] #\d+'
  Write-Host "--- transcript lines ---"
  $segments | ForEach-Object { Write-Host $_.Line }
  $all = ($segments | ForEach-Object { $_.Line }) -join "`n"
  $hasZh = $all -match '核心|关注|优势'
  $hasEn = if ($zhOnly) { $true } else { $all -match '(?i)products|advantages|artificial' }
  $minSegs = if ($zhOnly) { 1 } else { 2 }
  if ($segments.Count -ge $minSegs -and $hasZh -and $hasEn) {
    Write-Host "E2E_SMOKE_OK ($($segments.Count) segments, zh=$hasZh en=$hasEn zhOnly=$zhOnly)"
  } else {
    throw "E2E_SMOKE_FAIL: segments=$($segments.Count) zh=$hasZh en=$hasEn, see $log"
  }
} finally {
  if (-not $proc.HasExited) {
    # clean shutdown (WM_CLOSE), never force-kill during writes
    taskkill /PID $proc.Id | Out-Null
    Start-Sleep -Seconds 2
    if (-not $proc.HasExited) { taskkill /PID $proc.Id /T /F | Out-Null }
  }
  Write-Host "log: $log"
}
