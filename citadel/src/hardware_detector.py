"""
Dynamic hardware detection module.
Auto-detects CPU, memory, GPU, NPU, and storage at runtime using
psutil, platform, and OS-specific APIs. Env vars serve as optional overrides.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import subprocess
from typing import Any

import psutil

logger = logging.getLogger(__name__)


# ── OS-specific WMI helpers ──────────────────────────────────────────────────

def _powershell_query(class_name: str, props: list[str]) -> list[dict[str, Any]] | None:
    """Query WMI via PowerShell Get-CimInstance (Windows only)."""
    if platform.system() != "Windows":
        return None
    try:
        prop_str = ",".join(props)
        cmd = f"Get-CimInstance -ClassName {class_name} | Select-Object {prop_str} | ConvertTo-Json -Compress"
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", cmd],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0 and r.stdout.strip():
            data = json.loads(r.stdout.strip())
            return data if isinstance(data, list) else [data]
    except Exception as exc:
        logger.debug("PowerShell WMI query failed for %s: %s", class_name, exc)
    return None


# ── CPU Detection ────────────────────────────────────────────────────────────

def detect_cpu() -> dict[str, Any]:
    """Auto-detect CPU info from runtime + optional env overrides."""
    # WMI gives the best CPU name on Windows
    wmi_name = ""
    wmi_cores = 0
    wmi_threads = 0
    wmi_max_clock = 0
    wmi = _powershell_query("Win32_Processor", [
        "Name", "NumberOfCores", "NumberOfLogicalProcessors", "MaxClockSpeed",
    ])
    if wmi and len(wmi) > 0:
        wmi_name = wmi[0].get("Name", "").strip()
        wmi_cores = wmi[0].get("NumberOfCores", 0)
        wmi_threads = wmi[0].get("NumberOfLogicalProcessors", 0)
        wmi_max_clock = wmi[0].get("MaxClockSpeed", 0)

    # psutil / platform fallbacks
    ps_processor = platform.processor() or "Unknown"
    ps_cores = psutil.cpu_count(logical=False) or 1
    ps_threads = psutil.cpu_count(logical=True) or 1
    freq = psutil.cpu_freq()
    ps_max_freq = freq.max if freq else 0.0  # MHz
    ps_current_freq = freq.current if freq else 0.0  # MHz

    # Resolve with env override > WMI > psutil/platform
    model = os.getenv("CPU_MODEL") or wmi_name or ps_processor
    cores = int(os.getenv("CPU_CORES", 0)) or wmi_cores or ps_cores
    threads = int(os.getenv("CPU_THREADS", 0)) or wmi_threads or ps_threads
    boost_mhz = float(os.getenv("CPU_BOOST_CLOCK_GHZ", 0)) * 1000 or wmi_max_clock or ps_max_freq
    base_mhz = float(os.getenv("CPU_BASE_CLOCK_GHZ", 0)) * 1000 or (ps_current_freq if ps_current_freq < boost_mhz else 0)

    # Architecture detection
    arch = os.getenv("CPU_ARCH") or platform.machine()
    # Try to detect Intel generation from name
    if not os.getenv("CPU_ARCH") and "Ultra" in model:
        arch = "Meteor Lake"
    elif not os.getenv("CPU_ARCH") and "13th" in model:
        arch = "Raptor Lake"
    elif not os.getenv("CPU_ARCH") and "12th" in model:
        arch = "Alder Lake"

    # Live CPU usage %
    cpu_percent = psutil.cpu_percent(interval=0.1)

    return {
        "model": model,
        "architecture": arch,
        "cores": cores,
        "threads": threads,
        "base_clock_ghz": round(base_mhz / 1000, 2) if base_mhz else 0,
        "boost_clock_ghz": round(boost_mhz / 1000, 2) if boost_mhz else 0,
        "current_freq_ghz": round(ps_current_freq / 1000, 2) if ps_current_freq else 0,
        "usage_percent": cpu_percent,
    }


# ── Memory Detection ────────────────────────────────────────────────────────

def detect_memory() -> dict[str, Any]:
    """Auto-detect memory info from psutil + WMI for speed."""
    mem = psutil.virtual_memory()

    total_gb = round(mem.total / (1024 ** 3), 1)
    available_gb = round(mem.available / (1024 ** 3), 1)
    used_gb = round(mem.used / (1024 ** 3), 1)
    usage_percent = mem.percent

    # Try WMI for speed
    speed_mt = 0
    wmi = _powershell_query("Win32_PhysicalMemory", ["ConfiguredClockSpeed", "Speed"])
    if wmi and len(wmi) > 0:
        speed_mt = wmi[0].get("ConfiguredClockSpeed") or wmi[0].get("Speed") or 0

    # Env overrides
    total_gb = float(os.getenv("RAM_TOTAL_GB", 0)) or total_gb
    speed_mt = int(os.getenv("RAM_SPEED_MT", 0)) or speed_mt

    # Detect memory type from speed
    if speed_mt >= 4800:
        mem_type = "DDR5"
    elif speed_mt >= 2133:
        mem_type = "DDR4"
    elif speed_mt >= 1066:
        mem_type = "DDR3"
    elif speed_mt > 0:
        mem_type = "DDR"
    else:
        mem_type = "Unknown"

    return {
        "total_gb": total_gb,
        "available_gb": available_gb,
        "used_gb": used_gb,
        "usage_percent": usage_percent,
        "speed_mt": speed_mt,
        "type": mem_type,
    }


# ── GPU Detection ────────────────────────────────────────────────────────────

def detect_gpu() -> dict[str, Any]:
    """Auto-detect GPU via WMI + PyTorch."""
    # WMI detection
    gpu_name = ""
    adapter_ram = 0
    wmi = _powershell_query("Win32_VideoController", [
        "Name", "AdapterRAM", "VideoProcessor", "DriverVersion",
    ])
    if wmi:
        # Pick the first non-virtual GPU, or first one
        for entry in wmi:
            name = entry.get("Name", "")
            if "Hyper-V" not in name and "Remote Display" not in name and "Microsoft" not in name:
                gpu_name = name
                adapter_ram = entry.get("AdapterRAM") or 0
                break
        if not gpu_name and len(wmi) > 0:
            gpu_name = wmi[0].get("Name", "")
            adapter_ram = wmi[0].get("AdapterRAM") or 0

    vram_gb = round(adapter_ram / (1024 ** 3), 1) if adapter_ram else 0

    # PyTorch detection
    cuda_available = False
    xpu_available = False
    cuda_device_name = ""
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        if cuda_available:
            cuda_device_name = torch.cuda.get_device_name(0)
        try:
            xpu_available = hasattr(torch, "xpu") and torch.xpu.is_available()
        except Exception:
            pass
    except ImportError:
        pass

    # Env overrides
    gpu_model = os.getenv("GPU_MODEL") or gpu_name or cuda_device_name or "None"
    gpu_vram = float(os.getenv("GPU_VRAM_GB", 0)) or vram_gb
    gpu_type = os.getenv("GPU_TYPE") or (
        "dedicated" if cuda_available or "NVIDIA" in gpu_model.upper() or "Radeon" in gpu_model else
        "integrated" if gpu_model and gpu_model != "None" else "none"
    )

    return {
        "model": gpu_model,
        "vram_gb": gpu_vram,
        "type": gpu_type,
        "cuda_available": cuda_available,
        "xpu_available": xpu_available,
    }


# ── NPU Detection ────────────────────────────────────────────────────────────

def detect_npu() -> dict[str, Any]:
    """Detect NPU/AI accelerator from PnP devices or env vars."""
    npu_name = ""

    # Search PnP devices for NPU/Neural/AI keywords
    if platform.system() == "Windows":
        try:
            cmd = (
                "Get-CimInstance -ClassName Win32_PnPEntity | "
                "Where-Object { $_.Name -like '*NPU*' -or $_.Name -like '*Neural*' "
                "-or $_.Name -like '*AI Boost*' -or $_.Name -like '*Intel*AI*' } | "
                "Select-Object Name | ConvertTo-Json -Compress"
            )
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command", cmd],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout.strip():
                data = json.loads(r.stdout.strip())
                entries = data if isinstance(data, list) else [data]
                for e in entries:
                    name = e.get("Name", "")
                    # Filter out false positives (like Hyper-V Input)
                    if "Hyper-V" not in name and "Remote" not in name:
                        npu_name = name
                        break
        except Exception as exc:
            logger.debug("NPU detection failed: %s", exc)

    model = os.getenv("NPU_MODEL") or npu_name
    enabled = os.getenv("NPU_ENABLED", "").lower() == "true" if os.getenv("NPU_ENABLED") else bool(model)

    return {
        "model": model,
        "enabled": enabled,
    }


# ── Storage Detection ────────────────────────────────────────────────────────

def detect_storage() -> dict[str, Any]:
    """Detect storage from psutil disk info + WMI for model name."""
    # Disk usage
    try:
        usage = psutil.disk_usage("/")
        capacity_gb = round(usage.total / (1024 ** 3), 0)
        used_gb = round(usage.used / (1024 ** 3), 1)
        free_gb = round(usage.free / (1024 ** 3), 1)
        usage_percent = usage.percent
    except Exception:
        capacity_gb = 0
        used_gb = 0
        free_gb = 0
        usage_percent = 0

    # WMI for model name
    disk_model = ""
    interface_type = ""
    wmi = _powershell_query("Win32_DiskDrive", ["Model", "Size", "InterfaceType", "MediaType"])
    if wmi and len(wmi) > 0:
        disk_model = wmi[0].get("Model", "")
        interface_type = wmi[0].get("InterfaceType", "")
        # If psutil didn't get capacity, try WMI
        if not capacity_gb:
            wmi_size = wmi[0].get("Size")
            if wmi_size:
                capacity_gb = round(int(wmi_size) / (1024 ** 3), 0)

    # Env overrides
    model = os.getenv("STORAGE_MODEL") or disk_model or "Unknown"
    capacity = int(os.getenv("STORAGE_CAPACITY_GB", 0)) or int(capacity_gb)

    return {
        "model": model,
        "capacity_gb": capacity,
        "used_gb": used_gb,
        "free_gb": free_gb,
        "usage_percent": usage_percent,
        "interface": interface_type,
    }


# ── Compute Environment ─────────────────────────────────────────────────────

def detect_compute(gpu_info: dict[str, Any]) -> dict[str, Any]:
    """Detect compute environment (PyTorch, devices, etc)."""
    pytorch_version = "N/A"
    try:
        import torch
        pytorch_version = torch.__version__
    except ImportError:
        pass

    compute_device = os.getenv("COMPUTE_DEVICE", "auto")
    if compute_device == "auto":
        if gpu_info.get("cuda_available"):
            resolved_device = "cuda"
        elif gpu_info.get("xpu_available"):
            resolved_device = "xpu"
        else:
            resolved_device = "cpu"
    else:
        resolved_device = compute_device

    return {
        "configured_device": compute_device,
        "resolved_device": resolved_device,
        "pytorch_version": pytorch_version,
        "python_version": platform.python_version(),
        "os": f"{platform.system()} {platform.release()}",
        "max_workers": int(os.getenv("MAX_WORKERS", psutil.cpu_count(logical=True) or 4)),
        "shared_memory_mb": int(os.getenv("SHARED_MEMORY_SIZE_MB", 256)),
    }


# ── Public entry point ──────────────────────────────────────────────────────

def detect_all_hardware() -> dict[str, Any]:
    """
    Detect all hardware components.
    Priority: env var override > OS-specific API (WMI/PowerShell) > psutil > fallback.
    Returns a dict matching the HardwareInfo frontend interface.
    """
    gpu = detect_gpu()
    return {
        "cpu": detect_cpu(),
        "memory": detect_memory(),
        "gpu": gpu,
        "npu": detect_npu(),
        "storage": detect_storage(),
        "compute": detect_compute(gpu),
    }
