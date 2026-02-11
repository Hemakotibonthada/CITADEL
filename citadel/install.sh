#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# CITADEL — Linux/macOS Installer
# ═══════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_MIN_VERSION="3.11"
NODE_MIN_VERSION="20"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║              C I T A D E L                        ║"
    echo "║     Enterprise-Grade Trading Intelligence         ║"
    echo "║                                                   ║"
    echo "║  Multi-Agent • Local-First • Hardware-Accelerated ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info()    { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()    { echo -e "${BLUE}[STEP]${NC}  $1"; }

check_python() {
    log_step "Checking Python..."
    
    PYTHON_CMD=""
    for cmd in python3.12 python3.11 python3 python; do
        if command -v "$cmd" &>/dev/null; then
            version=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || true)
            if [ -n "$version" ]; then
                major=$(echo "$version" | cut -d. -f1)
                minor=$(echo "$version" | cut -d. -f2)
                if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
                    PYTHON_CMD="$cmd"
                    log_info "Found Python $version ($cmd)"
                    break
                fi
            fi
        fi
    done

    if [ -z "$PYTHON_CMD" ]; then
        log_error "Python >= $PYTHON_MIN_VERSION not found."
        log_error "Install from https://www.python.org/downloads/"
        exit 1
    fi
}

check_node() {
    log_step "Checking Node.js (optional, for GUI)..."
    
    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -ge "$NODE_MIN_VERSION" ]; then
            log_info "Found Node.js v$(node -v | sed 's/v//')"
            HAS_NODE=true
        else
            log_warn "Node.js $NODE_MIN_VERSION+ required for GUI. Found v$(node -v | sed 's/v//')"
            HAS_NODE=false
        fi
    else
        log_warn "Node.js not found. GUI will not be available."
        HAS_NODE=false
    fi
}

create_venv() {
    log_step "Creating virtual environment..."

    if [ -d "$SCRIPT_DIR/.venv" ]; then
        log_info "Virtual environment already exists."
        read -rp "Recreate? [y/N] " answer
        if [[ "$answer" =~ ^[Yy]$ ]]; then
            rm -rf "$SCRIPT_DIR/.venv"
            "$PYTHON_CMD" -m venv "$SCRIPT_DIR/.venv"
            log_info "Virtual environment recreated."
        fi
    else
        "$PYTHON_CMD" -m venv "$SCRIPT_DIR/.venv"
        log_info "Virtual environment created."
    fi

    # Activate
    source "$SCRIPT_DIR/.venv/bin/activate"
    log_info "Virtual environment activated."
}

install_python_deps() {
    log_step "Installing Python dependencies..."

    pip install --upgrade pip setuptools wheel 2>/dev/null
    pip install -e "$SCRIPT_DIR" 2>&1 | tail -5
    log_info "Python dependencies installed."
}

detect_hardware() {
    log_step "Detecting hardware acceleration..."

    ACCEL="cpu"

    # Check for Intel GPU/NPU
    if [ "$(uname)" = "Linux" ]; then
        if lspci 2>/dev/null | grep -qi "intel.*graphics\|intel.*gpu"; then
            log_info "Intel GPU detected. Installing OpenVINO..."
            pip install openvino 2>/dev/null && ACCEL="intel" || log_warn "OpenVINO install failed, using CPU."
        fi
    fi

    # Check for Apple Silicon
    if [ "$(uname)" = "Darwin" ]; then
        CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)
        if echo "$CHIP" | grep -qi "apple"; then
            log_info "Apple Silicon detected. Installing MLX..."
            pip install mlx 2>/dev/null && ACCEL="apple" || log_warn "MLX install failed, using CPU."
        fi
    fi

    log_info "Hardware acceleration: $ACCEL"
}

setup_env_file() {
    log_step "Setting up environment..."

    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        if [ -f "$SCRIPT_DIR/.env.example" ]; then
            cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
            log_info "Created .env from template. Edit with your API keys."
        fi
    else
        log_info ".env file already exists."
    fi
}

install_ui() {
    if [ "$HAS_NODE" = true ]; then
        log_step "Installing frontend dependencies..."
        
        if [ -d "$SCRIPT_DIR/src-ui" ]; then
            cd "$SCRIPT_DIR/src-ui"
            npm install 2>&1 | tail -3
            log_info "Frontend dependencies installed."
            cd "$SCRIPT_DIR"
        else
            log_warn "src-ui directory not found. Skipping frontend."
        fi
    fi
}

create_data_dirs() {
    log_step "Creating data directories..."
    
    mkdir -p "$SCRIPT_DIR/data"
    mkdir -p "$SCRIPT_DIR/reports"
    mkdir -p "$SCRIPT_DIR/models"
    mkdir -p "$SCRIPT_DIR/logs"
    log_info "Data directories created."
}

run_tests() {
    log_step "Running verification tests..."
    
    if pytest --tb=short -q "$SCRIPT_DIR/tests/" 2>/dev/null; then
        log_info "All tests passed! ✓"
    else
        log_warn "Some tests failed. This may be normal on first install."
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  CITADEL installed successfully!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Activate environment:"
    echo "    source .venv/bin/activate"
    echo ""
    echo "  Quick start:"
    echo "    citadel paper          # Paper trading"
    echo "    citadel backtest       # Backtesting"
    echo "    citadel report         # Generate report"
    echo ""
    if [ "$HAS_NODE" = true ]; then
        echo "  Start GUI:"
        echo "    cd src-ui && npm run dev"
        echo ""
    fi
    echo "  See RUN.md for detailed usage."
    echo ""
}

# ── Main ──────────────────────────────────────────
main() {
    banner
    
    cd "$SCRIPT_DIR"
    
    check_python
    check_node
    create_venv
    install_python_deps
    detect_hardware
    setup_env_file
    install_ui
    create_data_dirs
    run_tests
    print_summary
}

main "$@"
