#define AppName "FFP Amazon Crawler"
#define AppVersion GetEnv("FFP_AGENT_VERSION") != "" ? GetEnv("FFP_AGENT_VERSION") : "0.0.0-dev"
#define AppExeName "FFPAmazonCrawlerAgent.exe"

[Setup]
AppId={{BE595833-76C8-42EC-A20B-2147367422E9}
AppName={#AppName}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=FFP Tool
AppPublisherURL=https://github.com/tuan03/ffp_tool
AppUpdatesURL=https://github.com/tuan03/ffp_tool/releases/latest
DefaultDirName={autopf}\FFP Amazon Crawler
DefaultGroupName={#AppName}
OutputDir=..\..\installer-output
OutputBaseFilename=FFP-Amazon-Crawler-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern

[Files]
Source: "..\..\artifacts\windows\FFPAmazonCrawlerAgent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\scripts\update-agent.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\agent-release-policy.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Parameters: "--config ""{commonappdata}\FFP Amazon Crawler\agent.json"""

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FFPAmazonCrawler"; ValueData: """{app}\{#AppExeName}"" --start-minimized --config ""{commonappdata}\FFP Amazon Crawler\agent.json"""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExeName}"; Parameters: "--config ""{commonappdata}\FFP Amazon Crawler\agent.json"""; Description: "Start {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
var
  ServerPage: TInputQueryWizardPage;

function JsonEscape(Value: String): String;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  Result := Value;
end;

procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectDir,
    'Coordinator server',
    'Enter the HTTPS address of the crawler coordinator.',
    'The client connects outbound to this address. No inbound Windows port is required.');
  ServerPage.Add('Server URL:', False);
  ServerPage.Add('Display name:', False);
  ServerPage.Values[0] := ExpandConstant('{param:SERVERURL|}');
  ServerPage.Values[1] := ExpandConstant('{param:DISPLAYNAME|}') ;
  if ServerPage.Values[1] = '' then
    ServerPage.Values[1] := GetComputerNameString();
end;

function ConfigurationError(): String;
var
  Value: String;
  I: Integer;
begin
  Result := '';
  Value := Trim(ServerPage.Values[0]);
  if (Pos('https://', Lowercase(Value)) <> 1) or (Length(Value) <= 8) or
     (Pos('example.', Lowercase(Value)) > 0) or (Pos('localhost', Lowercase(Value)) > 0) or
     (Pos('@', Value) > 0) or (Pos('?', Value) > 0) or (Pos('#', Value) > 0) or
     (Pos(' ', Value) > 0) or (Pos('"', Value) > 0) then
    Result := 'Provide a real public HTTPS server URL using /SERVERURL= or the wizard.';
  Value := Value + ServerPage.Values[1];
  for I := 1 to Length(Value) do
    if Ord(Value[I]) < 32 then
      Result := 'Server URL and display name must not contain control characters.';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ErrorMessage: String;
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    ErrorMessage := ConfigurationError();
    if ErrorMessage <> '' then
    begin
      MsgBox(ErrorMessage, mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { Silent installs do not invoke NextButtonClick. Validate before changing files. }
  Result := ConfigurationError();
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDirectory: String;
  ConfigPath: String;
  Payload: String;
  TrustedPins: String;
  PinJson: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDirectory := ExpandConstant('{commonappdata}\FFP Amazon Crawler');
    ForceDirectories(ConfigDirectory);
    ConfigPath := ConfigDirectory + '\agent.json';
    TrustedPins := ExpandConstant('{param:TRUSTEDSIGNERS|}');
    PinJson := '';
    if TrustedPins <> '' then
    begin
      StringChangeEx(TrustedPins, ',', '","', True);
      PinJson := '  "trustedSignerThumbprints": ["' + TrustedPins + '"],' + #13#10;
    end;
    if not FileExists(ConfigPath) then
    begin
      Payload := '{' + #13#10 +
        '  "serverUrl": "' + JsonEscape(Trim(ServerPage.Values[0])) + '",' + #13#10 +
        '  "displayName": "' + JsonEscape(Trim(ServerPage.Values[1])) + '",' + #13#10 +
        '  "maxConcurrentInputs": 4,' + #13#10 +
        PinJson +
        '  "limits": {' + #13#10 +
        '    "productThreads": 4, "variantThreads": 8, "urllibThreads": 12,' + #13#10 +
        '    "browserProfiles": 4, "browserTabs": 2, "headless": false' + #13#10 +
        '  }' + #13#10 +
        '}' + #13#10;
      if not SaveStringToFile(ConfigPath, Payload, False) then
        RaiseException('Could not persist agent configuration.');
    end;
  end;
end;
