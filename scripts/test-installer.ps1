param([switch]$KeepInstalled)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectDir 'neutralino.config.json') -Raw | ConvertFrom-Json).version
$setupPath = Join-Path $projectDir "release\Still-$version-Windows-x64-Setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Still'
$reportDir = Join-Path $projectDir 'test-results\installer'
$checks = [System.Collections.Generic.List[string]]::new()
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
if (Test-Path -LiteralPath $installDir) { throw 'Existing Still installation found; test refuses to overwrite it.' }
$ownedKeys = @('HKCU:\Software\Classes\Still.Markdown', 'HKCU:\Software\Classes\Applications\Still.exe', 'HKCU:\Software\Still\Capabilities')
foreach ($ownedKey in $ownedKeys) { if (Test-Path -LiteralPath $ownedKey) { throw 'Existing Still registration found; test refuses to overwrite it.' } }
function Assert($condition, [string]$message) {
    if (-not $condition) { throw $message }
    $checks.Add($message)
}
function Snapshot-Defaults {
    $result = foreach ($extension in @('.md', '.markdown', '.mdown', '.mkd')) {
        foreach ($keyPath in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice", "HKCU:\Software\Classes\$extension")) {
            if (Test-Path -LiteralPath $keyPath) {
                $key = Get-Item -LiteralPath $keyPath
                foreach ($name in ($key.GetValueNames() | Sort-Object)) { "$keyPath|$name|$($key.GetValue($name))" }
            }
        }
    }
    return ($result -join "`n")
}
function Install-Still {
    $process = Start-Process -FilePath $setupPath -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LANG=chinesesimplified',('/LOG=' + (Join-Path $reportDir 'install.log')) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Setup failed: $($process.ExitCode)" }
}
$defaultsBefore = Snapshot-Defaults
try {
    Install-Still
    Assert (Test-Path (Join-Path $installDir 'Still.exe')) 'Executable installed at the per-user location.'
    foreach ($file in @('Still.exe', 'resources.neu', 'LICENSE', 'THIRD-PARTY-NOTICES.txt')) {
        $payloadHash = (Get-FileHash (Join-Path $projectDir "release\Still-$version-Windows-x64\$file")).Hash
        Assert ((Get-FileHash (Join-Path $installDir $file)).Hash -eq $payloadHash) "Installed $file matches the verified payload."
    }
    $expectedCommand = '"' + (Join-Path $installDir 'Still.exe') + '" "%1"'
    Assert ((Get-Item 'HKCU:\Software\Classes\Still.Markdown\shell\open\command').GetValue('') -eq $expectedCommand) 'File association quotes both executable and document paths.'
    foreach ($extension in @('.md', '.markdown', '.mdown', '.mkd')) {
        Assert ((Get-Item 'HKCU:\Software\Still\Capabilities\FileAssociations').GetValue($extension) -eq 'Still.Markdown') "Default Apps declares $extension support."
        Assert ((Get-Item "HKCU:\Software\Classes\$extension\OpenWithProgids").GetValueNames() -contains 'Still.Markdown') "Open With declares $extension support."
    }
    Assert ((Snapshot-Defaults) -eq $defaultsBefore) 'Existing extension defaults and protected UserChoice values remain unchanged.'
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Still.lnk'
    Assert (Test-Path -LiteralPath $shortcut) 'Start menu shortcut exists.'
    $shell = New-Object -ComObject WScript.Shell
    Assert ($shell.CreateShortcut($shortcut).TargetPath -eq (Join-Path $installDir 'Still.exe')) 'Start menu shortcut targets the installed application.'
    $env:STILL_NATIVE_EXECUTABLE = Join-Path $installDir 'Still.exe'
    & node (Join-Path $PSScriptRoot 'test-native.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application native tests failed.' }
    $native = Get-Content (Join-Path $projectDir 'test-results\native\results.json') -Raw | ConvertFrom-Json
    Assert ($native.passed -and $native.settingsRestored -and $native.checks.Count -eq 21) 'Installed executable passes all 21 native checks and restores user settings.'
    Install-Still
    Assert ((Snapshot-Defaults) -eq $defaultsBefore) 'Reinstallation preserves existing defaults.'
    $uninstaller = Join-Path $installDir 'unins000.exe'
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw 'Uninstall failed.' }
    Assert (-not (Test-Path (Join-Path $installDir 'Still.exe'))) 'Uninstallation removes the application executable.'
    foreach ($ownedKey in $ownedKeys) { Assert (-not (Test-Path -LiteralPath $ownedKey)) "Uninstallation removes only its owned registration: $ownedKey" }
    Assert (-not (Test-Path -LiteralPath $shortcut)) 'Uninstallation removes its shortcut.'
    Assert ((Snapshot-Defaults) -eq $defaultsBefore) 'Uninstallation preserves existing defaults.'
    foreach ($extension in @('.md', '.markdown', '.mdown', '.mkd')) {
        $keyPath = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        Assert ((-not (Test-Path $keyPath)) -or ((Get-Item $keyPath).GetValueNames() -notcontains 'Still.Markdown')) "Uninstallation removes its $extension Open With candidate."
    }
    if ($KeepInstalled) { Install-Still; Assert (Test-Path (Join-Path $installDir 'Still.exe')) 'Final installation is ready for use.' }
    @{ passed = $true; version = $version; checks = $checks.ToArray(); nativeChecks = $native.checks.Count; keptInstalled = [bool]$KeepInstalled } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $reportDir 'results.json') -Encoding UTF8
    Write-Output "Installer checks passed: $($checks.Count) + $($native.checks.Count) native checks."
} catch {
    @{ passed = $false; checks = $checks.ToArray(); error = $_.Exception.Message } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $reportDir 'results.json') -Encoding UTF8
    throw
} finally { Remove-Item Env:\STILL_NATIVE_EXECUTABLE -ErrorAction SilentlyContinue }
