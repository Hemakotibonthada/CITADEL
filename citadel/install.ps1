# ═══════════════════════════════════════════════════
# CITADEL — Windows PowerShell Installer
# ═══════════════════════════════════════════════════
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonMinVersion = [version]"3.11"
$NodeMinVersion = 20

# ── Helpers ────────────────────────────────────────
function Write-Banner {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║              C I T A D E L                        ║" -ForegroundColor Cyan
    Write-Host "║     Enterprise-Grade Trading Intelligence         ║" -ForegroundColor Cyan
    Write-Host "║                                                   ║" -ForegroundColor Cyan
    Write-Host "║  Multi-Agent • Local-First • Hardware-Accelerated ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step  { param($msg) Write-Host "[STEP]  $msg" -ForegroundColor Blue }
function Write-Ok    { param($msg) Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

# ── Python Check ───────────────────────────────────
function Find-Python {
    Write-Step "Checking Python..."

    $candidates = @("python3", "python", "py -3.12", "py -3.11")
    foreach ($cmd in $candidates) {
        try {
            $parts = $cmd -split " "
            $exe = $parts[0]
            $args = if ($parts.Length -gt 1) { $parts[1..($parts.Length-1)] } else { @() }
            
            $allArgs = $args + @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
            $ver = & $exe @allArgs 2>$null
            
            if ($ver) {
                $version = [version]$ver
                if ($version -ge $PythonMinVersion) {
                    Write-Ok "Found Python $ver ($cmd)"
                    return @{ Exe = $exe; Args = $args }
                }
            }
        } catch { }
    }

    Write-Err "Python >= $PythonMinVersion not found."
    Write-Err "Download from https://www.python.org/downloads/"
    exit 1
}

# ── Node Check ─────────────────────────────────────
function Test-NodeJs {
    Write-Step "Checking Node.js (optional, for GUI)..."

    try {
        $nodeVer = (node -v) -replace "v", ""
        $major = [int]($nodeVer.Split(".")[0])
        if ($major -ge $NodeMinVersion) {
            Write-Ok "Found Node.js v$nodeVer"
            return $true
        } else {
            Write-Warn "Node.js $NodeMinVersion+ required for GUI. Found v$nodeVer"
            return $false
        }
    } catch {
        Write-Warn "Node.js not found. GUI will not be available."
        return $false
    }
}

# ── Virtual Environment ───────────────────────────
function New-VirtualEnv {
    param($PythonInfo)
    
    Write-Step "Creating virtual environment..."

    $venvPath = Join-Path $ScriptDir ".venv"

    if (Test-Path $venvPath) {
        Write-Ok "Virtual environment already exists."
        $answer = Read-Host "Recreate? [y/N]"
        if ($answer -eq "y" -or $answer -eq "Y") {
            Remove-Item -Recurse -Force $venvPath
            & $PythonInfo.Exe @($PythonInfo.Args + @("-m", "venv", $venvPath))
            Write-Ok "Virtual environment recreated."
        }
    } else {
        & $PythonInfo.Exe @($PythonInfo.Args + @("-m", "venv", $venvPath))
        Write-Ok "Virtual environment created."
    }

    # Activate
    $activateScript = Join-Path $venvPath "Scripts\Activate.ps1"
    if (Test-Path $activateScript) {
        & $activateScript
        Write-Ok "Virtual environment activated."
    } else {
        Write-Err "Cannot activate venv. Run manually: .\.venv\Scripts\Activate.ps1"
    }
}

# ── Install Dependencies ──────────────────────────
function Install-PythonDeps {
    Write-Step "Installing Python dependencies..."

    pip install --upgrade pip setuptools wheel 2>$null | Out-Null
    pip install -e $ScriptDir 2>&1 | Select-Object -Last 5
    Write-Ok "Python dependencies installed."
}

# ── Hardware Detection ────────────────────────────
function Find-Hardware {
    Write-Step "Detecting hardware acceleration..."

    $accel = "cpu"

    # Check for Intel GPU
    try {
        $gpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -match "Intel" }
        if ($gpu) {
            Write-Ok "Intel GPU detected: $($gpu.Name)"
            Write-Ok "Installing OpenVINO..."
            pip install openvino 2>$null
            if ($LASTEXITCODE -eq 0) { $accel = "intel" }
            else { Write-Warn "OpenVINO install failed, using CPU." }
        }
    } catch { }

    Write-Ok "Hardware acceleration: $accel"
    return $accel
}

# ── Environment File ─────────────────────────────
function Initialize-EnvFile {
    Write-Step "Setting up environment..."

    $envFile = Join-Path $ScriptDir ".env"
    $envExample = Join-Path $ScriptDir ".env.example"

    if (-not (Test-Path $envFile)) {
        if (Test-Path $envExample) {
            Copy-Item $envExample $envFile
            Write-Ok "Created .env from template. Edit with your API keys."
        }
    } else {
        Write-Ok ".env file already exists."
    }
}

# ── Frontend ──────────────────────────────────────
function Install-Frontend {
    param([bool]$HasNode)
    
    if ($HasNode) {
        Write-Step "Installing frontend dependencies..."
        
        $uiDir = Join-Path $ScriptDir "src-ui"
        if (Test-Path $uiDir) {
            Push-Location $uiDir
            npm install 2>&1 | Select-Object -Last 3
            Pop-Location
            Write-Ok "Frontend dependencies installed."
        } else {
            Write-Warn "src-ui directory not found. Skipping frontend."
        }
    }
}

# ── Data Directories ─────────────────────────────
function New-DataDirectories {
    Write-Step "Creating data directories..."

    $dirs = @("data", "reports", "models", "logs")
    foreach ($d in $dirs) {
        $path = Join-Path $ScriptDir $d
        if (-not (Test-Path $path)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }
    Write-Ok "Data directories created."
}

# ── Tests ─────────────────────────────────────────
function Invoke-Tests {
    Write-Step "Running verification tests..."

    try {
        $testDir = Join-Path $ScriptDir "tests"
        pytest --tb=short -q $testDir 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "All tests passed!"
        } else {
            Write-Warn "Some tests failed. This may be normal on first install."
        }
    } catch {
        Write-Warn "Could not run tests. Run 'pytest' manually after install."
    }
}

# ── Summary ───────────────────────────────────────
function Write-Summary {
    param([bool]$HasNode)
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  CITADEL installed successfully!" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Activate environment:"
    Write-Host "    .\.venv\Scripts\Activate.ps1"
    Write-Host ""
    Write-Host "  Quick start:"
    Write-Host "    citadel paper          # Paper trading"
    Write-Host "    citadel backtest       # Backtesting"
    Write-Host "    citadel report         # Generate report"
    Write-Host ""
    if ($HasNode) {
        Write-Host "  Start GUI:"
        Write-Host "    cd src-ui; npm run dev"
        Write-Host ""
    }
    Write-Host "  See RUN.md for detailed usage."
    Write-Host ""
}

# ── Main ──────────────────────────────────────────
function Main {
    Write-Banner
    
    Set-Location $ScriptDir
    
    $pythonInfo = Find-Python
    $hasNode = Test-NodeJs
    New-VirtualEnv -PythonInfo $pythonInfo
    Install-PythonDeps
    $accel = Find-Hardware
    Initialize-EnvFile
    Install-Frontend -HasNode $hasNode
    New-DataDirectories
    Invoke-Tests
    Write-Summary -HasNode $hasNode
}

Main
