#ifndef AppVersion
  #error AppVersion is required
#endif
#define Payload "..\release\Still-" + AppVersion + "-Windows-x64"

[Setup]
AppId=app.liubai.reader.windows
AppName=Still · 留白
AppVersion={#AppVersion}
AppPublisher=Still contributors
AppPublisherURL=https://github.com/kyanray-dev/still
DefaultDirName={localappdata}\Programs\Still
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0
OutputDir=..\release
OutputBaseFilename=Still-{#AppVersion}-Windows-x64-Setup
SetupIconFile=..\public\app-icon.ico
UninstallDisplayIcon={app}\app-icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
ChangesAssociations=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinesesimplified.DesktopShortcut=创建桌面快捷方式
chinesesimplified.DefaultSettings=选择默认 Markdown 打开程序（在系统设置中选择 Still）
chinesesimplified.LaunchStill=打开 Still · 留白
chinesesimplified.RuntimeFailed=WebView2 安装未完成。请从 Microsoft 官网安装 WebView2 Runtime 后再打开 Still。
english.DesktopShortcut=Create a desktop shortcut
english.DefaultSettings=Choose the default Markdown app (select Still in Windows Settings)
english.LaunchStill=Launch Still
english.RuntimeFailed=WebView2 installation did not finish. Install WebView2 Runtime from Microsoft before opening Still.

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopShortcut}"; Flags: unchecked

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\public\app-icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\.tmp\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\Still"; Filename: "{app}\Still.exe"; WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"
Name: "{autodesktop}\Still"; Filename: "{app}\Still.exe"; WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\Still.Markdown"; ValueType: string; ValueData: "Markdown 文档"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Still.Markdown\DefaultIcon"; ValueType: string; ValueData: """{app}\app-icon.ico"""
Root: HKCU; Subkey: "Software\Classes\Still.Markdown\shell\open\command"; ValueType: string; ValueData: """{app}\Still.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Applications\Still.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Still · 留白"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\Still.exe\shell\open\command"; ValueType: string; ValueData: """{app}\Still.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Applications\Still.exe\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\Still.exe\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\Still.exe\SupportedTypes"; ValueType: string; ValueName: ".mdown"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\Still.exe\SupportedTypes"; ValueType: string; ValueName: ".mkd"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "Still.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "Still.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: string; ValueName: "Still.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Classes\.mkd\OpenWithProgids"; ValueType: string; ValueName: "Still.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Still\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Still · 留白"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Still\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Markdown editor and reader"
Root: HKCU; Subkey: "Software\Still\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "Still.Markdown"
Root: HKCU; Subkey: "Software\Still\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "Still.Markdown"
Root: HKCU; Subkey: "Software\Still\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mdown"; ValueData: "Still.Markdown"
Root: HKCU; Subkey: "Software\Still\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mkd"; ValueData: "Still.Markdown"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Still"; ValueData: "Software\Still\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "ms-settings:defaultapps?registeredAppUser=Still"; Description: "{cm:DefaultSettings}"; Flags: shellexec postinstall skipifsilent unchecked
Filename: "{app}\Still.exe"; Description: "{cm:LaunchStill}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)) and (Version <> '') and (Version <> '0.0.0.0');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var ExitCode: Integer;
begin
  if (CurStep = ssPostInstall) and not HasWebView2 then begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) or not HasWebView2 then
      MsgBox(CustomMessage('RuntimeFailed'), mbInformation, MB_OK);
  end;
end;
