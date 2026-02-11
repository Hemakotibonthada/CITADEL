"""
CITADEL — Hardware Accelerator Abstraction

Unified interface over:
  - Intel NPU/GPU via OpenVINO
  - Apple Silicon via MLX
  - CPU fallback via NumPy/ONNX Runtime
  
Auto-detects available hardware and selects the optimal backend.
"""

from __future__ import annotations

import platform
import sys
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import numpy as np
import structlog

logger = structlog.get_logger(__name__)


class HardwareAccelerator(ABC):
    """Abstract accelerator backend."""

    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    async def load_model(self, model_path: str | Path, **kwargs: Any) -> Any: ...

    @abstractmethod
    async def infer(self, inputs: np.ndarray, **kwargs: Any) -> np.ndarray: ...

    @abstractmethod
    async def batch_infer(self, inputs: list[np.ndarray], **kwargs: Any) -> list[np.ndarray]: ...

    @abstractmethod
    def device_info(self) -> dict[str, Any]: ...

    @abstractmethod
    async def shutdown(self) -> None: ...


class IntelAccelerator(HardwareAccelerator):
    """
    Intel NPU/GPU acceleration via OpenVINO.
    
    Targets:
      - Intel Meteor Lake NPU
      - Intel Arc GPU  
      - Intel integrated GPU
      - CPU fallback with VNNI/AMX
    """

    def __init__(self) -> None:
        self._core: Any = None
        self._compiled_models: dict[str, Any] = {}
        self._device = "CPU"  # Will be upgraded if GPU/NPU available

    def name(self) -> str:
        return f"Intel OpenVINO ({self._device})"

    def is_available(self) -> bool:
        try:
            import openvino as ov  # noqa: F401
            return True
        except ImportError:
            return False

    async def load_model(self, model_path: str | Path, **kwargs: Any) -> Any:
        """Load and compile model with OpenVINO."""
        try:
            import openvino as ov

            if self._core is None:
                self._core = ov.Core()
                self._detect_best_device()

            model_path = Path(model_path)
            cache_key = str(model_path)

            if cache_key in self._compiled_models:
                return self._compiled_models[cache_key]

            # Read model
            if model_path.suffix == ".onnx":
                model = self._core.read_model(str(model_path))
            elif model_path.suffix == ".xml":
                weights = model_path.with_suffix(".bin")
                model = self._core.read_model(str(model_path), str(weights))
            else:
                raise ValueError(f"Unsupported model format: {model_path.suffix}")

            # Compile for target device
            compile_config = {}
            if self._device == "NPU":
                compile_config["NPU_COMPILATION_MODE"] = "DefaultHW"
            elif self._device == "GPU":
                compile_config["GPU_THROUGHPUT_STREAMS"] = "AUTO"

            compiled = self._core.compile_model(
                model, self._device, compile_config
            )
            self._compiled_models[cache_key] = compiled

            logger.info(
                "intel.model_loaded",
                path=str(model_path),
                device=self._device,
            )
            return compiled

        except Exception as e:
            logger.error("intel.load_error", error=str(e))
            raise

    async def infer(self, inputs: np.ndarray, **kwargs: Any) -> np.ndarray:
        """Run inference on a single input."""
        model_key = kwargs.get("model_key", "")
        compiled = self._compiled_models.get(model_key)
        if compiled is None:
            compiled = next(iter(self._compiled_models.values()), None)
        if compiled is None:
            raise RuntimeError("No compiled model available")

        infer_request = compiled.create_infer_request()
        infer_request.infer({0: inputs})
        return infer_request.get_output_tensor(0).data.copy()

    async def batch_infer(
        self, inputs: list[np.ndarray], **kwargs: Any
    ) -> list[np.ndarray]:
        """Run batch inference."""
        results = []
        for inp in inputs:
            result = await self.infer(inp, **kwargs)
            results.append(result)
        return results

    def _detect_best_device(self) -> None:
        """Detect the best available Intel device."""
        if self._core is None:
            return

        available = self._core.available_devices
        logger.info("intel.available_devices", devices=available)

        if "NPU" in available:
            self._device = "NPU"
        elif "GPU" in available:
            self._device = "GPU"
        else:
            self._device = "CPU"

        logger.info("intel.selected_device", device=self._device)

    def device_info(self) -> dict[str, Any]:
        """Get device information."""
        info = {
            "backend": "OpenVINO",
            "device": self._device,
            "platform": platform.processor(),
        }
        if self._core:
            try:
                info["available_devices"] = self._core.available_devices
                info["openvino_version"] = str(self._core.get_versions(self._device))
            except Exception:
                pass
        return info

    async def shutdown(self) -> None:
        """Release resources."""
        self._compiled_models.clear()
        self._core = None


class AppleAccelerator(HardwareAccelerator):
    """
    Apple Silicon acceleration via MLX.
    
    Targets:
      - M1/M2/M3/M4 Neural Engine
      - Apple GPU
      - Unified Memory Architecture
    """

    def __init__(self) -> None:
        self._models: dict[str, Any] = {}

    def name(self) -> str:
        return "Apple MLX (Metal)"

    def is_available(self) -> bool:
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            return False
        try:
            import mlx.core  # noqa: F401
            return True
        except ImportError:
            return False

    async def load_model(self, model_path: str | Path, **kwargs: Any) -> Any:
        """Load model with MLX."""
        try:
            import mlx.core as mx
            import mlx.nn as nn

            model_path = Path(model_path)
            cache_key = str(model_path)

            if cache_key in self._models:
                return self._models[cache_key]

            # Load weights
            if model_path.suffix == ".npz":
                weights = mx.load(str(model_path))
            elif model_path.suffix == ".safetensors":
                weights = mx.load(str(model_path))
            else:
                weights = mx.load(str(model_path))

            self._models[cache_key] = weights
            logger.info("apple.model_loaded", path=str(model_path))
            return weights

        except Exception as e:
            logger.error("apple.load_error", error=str(e))
            raise

    async def infer(self, inputs: np.ndarray, **kwargs: Any) -> np.ndarray:
        """Run inference on Apple Silicon."""
        try:
            import mlx.core as mx

            mx_input = mx.array(inputs)

            # Simple matrix ops — real usage would involve model forward pass
            model_key = kwargs.get("model_key", "")
            weights = self._models.get(model_key)

            if weights and "weight" in weights:
                output = mx.matmul(mx_input, weights["weight"])
                if "bias" in weights:
                    output = output + weights["bias"]
            else:
                output = mx_input

            mx.eval(output)
            return np.array(output)

        except Exception as e:
            logger.error("apple.infer_error", error=str(e))
            return inputs  # passthrough

    async def batch_infer(
        self, inputs: list[np.ndarray], **kwargs: Any
    ) -> list[np.ndarray]:
        """Batch inference on Apple Silicon."""
        try:
            import mlx.core as mx
            stacked = mx.array(np.stack(inputs))
            results = []
            for i in range(stacked.shape[0]):
                result = await self.infer(np.array(stacked[i]), **kwargs)
                results.append(result)
            return results
        except Exception:
            return [await self.infer(inp, **kwargs) for inp in inputs]

    def device_info(self) -> dict[str, Any]:
        """Get Apple Silicon info."""
        info = {
            "backend": "MLX",
            "device": "Apple Silicon",
            "chip": platform.processor(),
            "arch": platform.machine(),
        }
        try:
            import mlx.core as mx
            info["mlx_default_device"] = str(mx.default_device())
        except Exception:
            pass
        return info

    async def shutdown(self) -> None:
        """Release resources."""
        self._models.clear()


class CPUAccelerator(HardwareAccelerator):
    """
    CPU fallback using NumPy / ONNX Runtime.
    
    Always available — used when no GPU/NPU is present.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Any] = {}

    def name(self) -> str:
        return "CPU (NumPy/ONNX Runtime)"

    def is_available(self) -> bool:
        return True

    async def load_model(self, model_path: str | Path, **kwargs: Any) -> Any:
        """Load model with ONNX Runtime or NumPy."""
        model_path = Path(model_path)
        cache_key = str(model_path)

        if cache_key in self._sessions:
            return self._sessions[cache_key]

        if model_path.suffix == ".onnx":
            try:
                import onnxruntime as ort

                sess = ort.InferenceSession(
                    str(model_path),
                    providers=["CPUExecutionProvider"],
                )
                self._sessions[cache_key] = sess
                logger.info("cpu.onnx_model_loaded", path=str(model_path))
                return sess
            except ImportError:
                logger.warning("cpu.onnxruntime_not_available")

        # NumPy weights fallback
        if model_path.suffix == ".npz":
            weights = np.load(str(model_path))
            self._sessions[cache_key] = weights
            return weights

        raise ValueError(f"Cannot load: {model_path}")

    async def infer(self, inputs: np.ndarray, **kwargs: Any) -> np.ndarray:
        """Run CPU inference."""
        model_key = kwargs.get("model_key", "")
        session = self._sessions.get(model_key)

        if session is None:
            session = next(iter(self._sessions.values()), None)

        if session is None:
            return inputs

        try:
            import onnxruntime as ort

            if isinstance(session, ort.InferenceSession):
                input_name = session.get_inputs()[0].name
                output = session.run(None, {input_name: inputs.astype(np.float32)})
                return output[0]
        except (ImportError, Exception):
            pass

        return inputs

    async def batch_infer(
        self, inputs: list[np.ndarray], **kwargs: Any
    ) -> list[np.ndarray]:
        """Batch CPU inference."""
        return [await self.infer(inp, **kwargs) for inp in inputs]

    def device_info(self) -> dict[str, Any]:
        """Get CPU info."""
        return {
            "backend": "CPU",
            "device": platform.processor() or "Unknown",
            "python": sys.version,
            "numpy": np.__version__,
        }

    async def shutdown(self) -> None:
        """Release resources."""
        self._sessions.clear()


def get_accelerator() -> HardwareAccelerator:
    """
    Auto-detect and return the best available accelerator.
    
    Priority: Intel NPU/GPU > Apple MLX > CPU
    """
    # Try Intel OpenVINO
    intel = IntelAccelerator()
    if intel.is_available():
        logger.info("hardware.selected", backend="Intel OpenVINO")
        return intel

    # Try Apple MLX
    apple = AppleAccelerator()
    if apple.is_available():
        logger.info("hardware.selected", backend="Apple MLX")
        return apple

    # Fallback to CPU
    logger.info("hardware.selected", backend="CPU fallback")
    return CPUAccelerator()
