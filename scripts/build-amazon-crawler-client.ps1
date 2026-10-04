param(
    [switch]$SkipInstaller,
    [switch]$SmokeTest
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$amazonRoot = Join-Path $repositoryRoot "src/modules/amazon-crawler"
$exampleConfig = Join-Path $repositoryRoot "config/amazon-crawler-agent.example.json"
$versionModule = Join-Path $amazonRoot "engine/distributed/__init__.py"
$versionMatch = Select-String -LiteralPath $versionModule -Pattern '^AGENT_VERSION = "(\d+\.\d+\.\d+)"$'
if ($null -eq $versionMatch -or $versionMatch.Matches.Count -ne 1) {
    throw "Could not read a stable AGENT_VERSION from $versionModule."
}
$agentVersion = $versionMatch.Matches[0].Groups[1].Value

if ($SmokeTest) {
    Push-Location $amazonRoot
    try {
        python -m engine.distributed.client_main --config $exampleConfig --project-root $repositoryRoot --check-config
    }
    finally {
        Pop-Location
    }
    exit $LASTEXITCODE
}

$buildRoot = Join-Path $repositoryRoot ".runtime/agent-build"
$virtualEnvironment = Join-Path $buildRoot "venv"
$browserDirectory = Join-Path $buildRoot "ms-playwright"
$pythonExecutable = Join-Path $virtualEnvironment "Scripts/python.exe"
$portableOutput = Join-Path $repositoryRoot "artifacts/windows"

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    python -m venv $virtualEnvironment
    if ($LASTEXITCODE -ne 0) { throw "Could not create the isolated agent build environment." }
}

& $pythonExecutable -m pip install --disable-pip-version-check --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not prepare pip." }
& $pythonExecutable -m pip install -r (Join-Path $amazonRoot "engine/requirements.txt") "pyinstaller>=6.10,<7"
if ($LASTEXITCODE -ne 0) { throw "Could not install agent build dependencies." }
& $pythonExecutable -c "import tkinter; print('Tk/Tcl runtime:', tkinter.TkVersion)"
if ($LASTEXITCODE -ne 0) {
    throw "Python Tk/Tcl is required to package the Windows agent dashboard. Install Python with Tcl/Tk support."
}
$env:PLAYWRIGHT_BROWSERS_PATH = $browserDirectory
& $pythonExecutable -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Could not download bundled Chromium." }

Push-Location $repositoryRoot
try {
    & $pythonExecutable -m PyInstaller --noconfirm --clean --distpath $portableOutput (Join-Path $repositoryRoot "packaging/windows/ffp-amazon-crawler.spec")
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed to package the Windows crawler agent."
    }
}
finally {
    Pop-Location
}

$portableDirectory = Join-Path $portableOutput "FFPAmazonCrawlerAgent"
# Release artifacts must never inherit the build machine's store/proxy configuration.
Copy-Item -LiteralPath $exampleConfig -Destination (Join-Path $portableDirectory "agent.json") -Force

if (-not $SkipInstaller) {
    $compiler = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    if ($null -eq $compiler) {
        throw "Inno Setup 6 (ISCC.exe) is required to build the installer. Re-run with -SkipInstaller for the portable build."
    }
    $env:FFP_AGENT_VERSION = $agentVersion
    & $compiler.Source (Join-Path $repositoryRoot "packaging/windows/ffp-amazon-crawler.iss")
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed to build the installer." }
}
