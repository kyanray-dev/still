param([string]$CompilerPath = $env:ISCC)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectDir 'neutralino.config.json') -Raw | ConvertFrom-Json).version
if (-not $CompilerPath) {
    $candidates = @((Join-Path $projectDir '.tmp\inno\ISCC.exe'), 'C:\Program Files\Inno Setup 7\ISCC.exe', 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe')
    $CompilerPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $CompilerPath) { throw 'Install Inno Setup or set ISCC to its compiler path.' }
$runtimeInstaller = Join-Path $projectDir '.tmp\MicrosoftEdgeWebview2Setup.exe'
New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeInstaller) -Force | Out-Null
if (-not (Test-Path -LiteralPath $runtimeInstaller)) {
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $runtimeInstaller -TimeoutSec 90
}
$signature = Get-AuthenticodeSignature -LiteralPath $runtimeInstaller
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
    throw 'WebView2 bootstrapper signature verification failed.'
}
& $CompilerPath ('/DAppVersion=' + $version) (Join-Path $projectDir 'installer\windows.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$setup = Join-Path $projectDir ('release\Still-' + $version + '-Windows-x64-Setup.exe')
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(($setup + '.sha256'), ($hash + '  ' + (Split-Path -Leaf $setup) + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output "Installer: $setup"
Write-Output "SHA256: $hash"
