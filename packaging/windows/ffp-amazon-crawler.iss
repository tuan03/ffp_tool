#define AppName "FFP Amazon Crawler"
#define AppVersion "1.0.0"
#define AppExeName "FFPAmazonCrawlerAgent.exe"

[Setup]
AppId={{BE595833-76C8-42EC-A20B-2147367422E9}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\FFP Amazon Crawler
DefaultGroupName={#AppName}
OutputDir=..\..\installer-output
OutputBaseFilename=FFP-Amazon-Crawler-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern

[Files]
Source: "..\..\artifacts\windows\FFPAmazonCrawlerAgent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Parameters: "--config ""{commonappdata}\FFP Amazon Crawler\agent.json"""

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FFPAmazonCrawler"; ValueData: """{app}\{#AppExeName}"" --config ""{commonappdata}\FFP Amazon Crawler\agent.json"""; Flags: uninsdeletevalue

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
  ServerPage.Values[0] := 'https://crawler.example.com';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Value: String;
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    Value := Trim(ServerPage.Values[0]);
    if (Pos('https://', Lowercase(Value)) <> 1) and (Pos('http://', Lowercase(Value)) <> 1) then
    begin
      MsgBox('Server URL must start with https:// or http://.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDirectory: String;
  ConfigPath: String;
  Payload: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDirectory := ExpandConstant('{commonappdata}\FFP Amazon Crawler');
    ForceDirectories(ConfigDirectory);
    ConfigPath := ConfigDirectory + '\agent.json';
    if not FileExists(ConfigPath) then
    begin
      Payload := '{' + #13#10 +
        '  "serverUrl": "' + JsonEscape(Trim(ServerPage.Values[0])) + '",' + #13#10 +
        '  "displayName": "' + JsonEscape(GetComputerNameString()) + '",' + #13#10 +
        '  "maxConcurrentInputs": 4,' + #13#10 +
        '  "limits": {' + #13#10 +
        '    "productThreads": 4, "variantThreads": 8, "urllibThreads": 12,' + #13#10 +
        '    "browserProfiles": 4, "browserTabs": 2, "headless": false' + #13#10 +
        '  }' + #13#10 +
        '}' + #13#10;
      SaveStringToFile(ConfigPath, Payload, False);
    end;
  end;
end;
