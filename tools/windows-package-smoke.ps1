# Run only on a disposable Windows CI runner: installs/uninstalls the real NSIS artifact.
# No elevation, keys, GPU switches, or machine-wide install.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$logs = Join-Path $root 'release/smoke'
New-Item -ItemType Directory -Force $logs | Out-Null
$started = Get-Date
$installDir = Join-Path $env:RUNNER_TEMP 'mc installer smoke 会议'
if (!$env:RUNNER_TEMP -or !$env:CI) { throw 'Requires disposable CI runner (CI and RUNNER_TEMP)' }
if (Test-Path $installDir) { throw "Refusing to overwrite existing install: $installDir" }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = Join-Path $root "release/MeetingCopilot-$version-win-x64.exe"
$portable = Join-Path $root "release/MeetingCopilot-$version-win-x64-portable.exe"
foreach ($path in @($installer, $portable)) { if (!(Test-Path $path)) { throw "Missing artifact: $path" } }
function Invoke-Smoke([string]$exe, [string]$label) {
    & node tools/packaged-smoke.mjs --exe $exe --label $label
    if ($LASTEXITCODE -ne 0) { throw "$label smoke failed: $LASTEXITCODE" }
}
function Wait-Installer([string]$exe, [string]$arguments) {
    $p = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
    if (!$p.WaitForExit(180000)) {
        & taskkill /PID $p.Id /T /F | Out-Null
        throw "Installer timeout: $exe"
    }
    $p.Refresh()
    if ($p.ExitCode -ne 0) { throw "Installer failed: exit=$($p.ExitCode) exe=$exe" }
}
$failures = [System.Collections.Generic.List[string]]::new()
function Invoke-Stage([string]$name, [scriptblock]$action) {
    try {
        & $action
        "PASS $name" | Tee-Object -FilePath (Join-Path $logs 'windows-package-stages.log') -Append
    } catch {
        $message = "FAIL ${name}: $($_.Exception.Message)"
        $failures.Add($message)
        $message | Tee-Object -FilePath (Join-Path $logs 'windows-package-stages.log') -Append
    }
}
try {
    Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture |
        ConvertTo-Json | Set-Content (Join-Path $logs 'windows-host.json')
    Get-ChildItem release/win-unpacked -Recurse -File | Where-Object { $_.Extension -in '.dll', '.node', '.exe' } |
        Select-Object @{n='Path';e={$_.FullName.Substring($root.Length + 1)}}, Length,
            @{n='Version';e={$_.VersionInfo.FileVersion}} |
        ConvertTo-Json -Depth 3 | Set-Content (Join-Path $logs 'windows-native-inventory.json')
    # Each artifact is independently required. A portable failure must not hide
    # the installed-app result; aggregate failures only after all safe stages.
    Invoke-Stage 'unpacked' { Invoke-Smoke (Join-Path $root 'release/win-unpacked/MeetingCopilot.exe') 'unpacked' }
    Invoke-Stage 'portable' { Invoke-Smoke $portable 'portable' }
    Invoke-Stage 'nsis-installed-and-uninstall' {
        try {
            # /D is last and unquoted, including paths containing spaces.
            Wait-Installer $installer "/S /D=$installDir"
            $installedExe = Join-Path $installDir 'MeetingCopilot.exe'
            if (!(Test-Path $installedExe)) { throw "NSIS did not install to requested directory: $installDir" }
            Invoke-Smoke $installedExe 'nsis-installed'
        } finally {
            if (Test-Path $installDir) {
                $uninstaller = @(Get-ChildItem $installDir -Filter 'Uninstall*.exe' -File)
                if ($uninstaller.Count -ne 1) { throw 'Expected exactly one NSIS uninstaller' }
                Wait-Installer $uninstaller[0].FullName "/S _?=$installDir"
                if (Test-Path (Join-Path $installDir 'MeetingCopilot.exe')) { throw 'Uninstall left installed executable behind' }
                Remove-Item $installDir -Recurse -Force
            }
        }
    }
} finally {
    # Loader failures can occur before Electron produces any stdout.
    try {
        Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$started; Level=2} -ErrorAction Stop |
            Where-Object { $_.Message -match 'MeetingCopilot|electron|0xc0000135' } |
            Select-Object TimeCreated, Id, ProviderName, Message |
            ConvertTo-Json -Depth 3 | Set-Content (Join-Path $logs 'windows-application-errors.json')
    } catch { "SKIP event log: $($_.Exception.Message)" | Set-Content (Join-Path $logs 'windows-event-log-status.txt') }
}
if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
Write-Host 'WINDOWS_PACKAGE_SMOKE_OK: unpacked, portable, NSIS installed launch, uninstall'
Write-Host 'SKIP: Win11 client, physical audio, privacy prompts, screen-share exclusion, signing; hosted Windows Server is not evidence for these.'
