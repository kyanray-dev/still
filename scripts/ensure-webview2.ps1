$ErrorActionPreference = 'Stop'

# Detection and silent installation follow Microsoft's deployment documentation:
# https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
function Get-WebView2Version {
    $runtimeKeys = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )
    foreach ($runtimeKey in $runtimeKeys) {
        $runtimeVersion = Get-ItemPropertyValue -LiteralPath $runtimeKey -Name pv -ErrorAction SilentlyContinue
        if ($runtimeVersion -and [version]$runtimeVersion -gt [version]'0.0.0.0') {
            return $runtimeVersion
        }
    }
}

$installedVersion = Get-WebView2Version
if (-not $installedVersion) {
    $installerPath = Join-Path ([System.IO.Path]::GetTempPath()) 'Still-WebView2Setup.exe'
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installerPath
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
        throw 'WebView2 installer does not have a valid Microsoft signature.'
    }
    $installer = Start-Process -FilePath $installerPath -ArgumentList '/silent', '/install' -WindowStyle Hidden -Wait -PassThru
    if ($installer.ExitCode -ne 0) {
        throw "WebView2 installation failed with exit code $($installer.ExitCode)."
    }
    $installedVersion = Get-WebView2Version
    if (-not $installedVersion) {
        throw 'WebView2 installation completed without a registered runtime.'
    }
}
Write-Output "WebView2 Runtime: $installedVersion"
