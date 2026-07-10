# E2E: full renderer -> IPC -> main -> DeepSeek -> stream -> renderer round-trip.
# Requires the API key already stored in settings.json (safeStorage).
# Usage: pwsh -NoProfile -File tools/e2e-llm.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$log = Join-Path $env:TEMP "mc-e2e-llm-$(Get-Date -Format yyyyMMdd-HHmmss).log"
$env:MC_E2E_LLM = '用一句话回答：一加一等于几？答案里必须包含阿拉伯数字。'

$proc = Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList '.' `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden

try {
  $deadline = (Get-Date).AddSeconds(60)
  $line = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern '\[e2e-llm\]' | Select-Object -Last 1
      if ($m) { $line = $m.Line; break }
    }
    if ($proc.HasExited) { throw "app exited early, see $log / $log.err" }
  }
  if (-not $line) { throw "no [e2e-llm] result within 60s, see $log" }
  Write-Host $line
  if ($line -match '"ok":true' -and $line -match '\d') {
    Write-Host 'E2E_LLM_OK'
  } else {
    throw "E2E_LLM_FAIL: $line"
  }
} finally {
  Remove-Item Env:\MC_E2E_LLM -ErrorAction SilentlyContinue
  if (-not $proc.HasExited) {
    taskkill /PID $proc.Id | Out-Null
    Start-Sleep -Seconds 2
    if (-not $proc.HasExited) { taskkill /PID $proc.Id /T /F | Out-Null }
  }
  Write-Host "log: $log"
}
