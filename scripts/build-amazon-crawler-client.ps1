param(
    [switch]$SkipInstaller,
    [switch]$SmokeTest
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$amazonRoot = Join-Path $repositoryRoot "src/modules/amazon-crawler"
$exampleConfig = Join-Path $repositoryRoot "config/amazon-crawler-agent.example.json"

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
}

& $pythonExecutable -m pip install --disable-pip-version-check --upgrade pip
& $pythonExecutable -m pip install -r (Join-Path $amazonRoot "engine/requirements.txt") "pyinstaller>=6.10,<7"
$env:PLAYWRIGHT_BROWSERS_PATH = $browserDirectory
& $pythonExecutable -m playwright install chromium

Push-Location $repositoryRoot
try {
    & $pythonExecutable -m PyInstaller --noconfirm --clean --distpath $portableOutput (Join-Path $repositoryRoot "packaging/windows/ffp-amazon-crawler.spec")
}
finally {
    Pop-Location
}

$portableDirectory = Join-Path $portableOutput "FFPAmazonCrawlerAgent"
$localConfig = Join-Path $repositoryRoot "config/amazon-crawler-agent.json"
$configSource = if (Test-Path -LiteralPath $localConfig) { $localConfig } else { $exampleConfig }
Copy-Item -LiteralPath $configSource -Destination (Join-Path $portableDirectory "agent.json") -Force
$proxyConfig = Join-Path $repositoryRoot "config/amazon-crawler-profiles.json"
if (Test-Path -LiteralPath $proxyConfig) {
    Copy-Item -LiteralPath $proxyConfig -Destination (Join-Path $portableDirectory "amazon-crawler-profiles.json") -Force
}

if (-not $SkipInstaller) {
    $compiler = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    if ($null -eq $compiler) {
        throw "Inno Setup 6 (ISCC.exe) is required to build the installer. Re-run with -SkipInstaller for the portable build."
    }
    & $compiler.Source (Join-Path $repositoryRoot "packaging/windows/ffp-amazon-crawler.iss")
}
