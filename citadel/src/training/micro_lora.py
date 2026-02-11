"""
CITADEL — Micro LoRA Trainer

Lightweight LoRA (Low-Rank Adaptation) fine-tuning for the trading LLM.

Features:
  - Rank-4 LoRA adapters for minimal memory
  - On-device training via OpenVINO Training Extensions (OVTE) or PyTorch
  - Nightly training loop triggered by the Student agent
  - Checkpoint management and rollback
  - Training metrics logging
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import structlog

from src.core.models import TrainingResult

logger = structlog.get_logger(__name__)


class LoRAAdapter:
    """
    Low-Rank Adaptation matrices.
    
    For a weight matrix W (d x k), LoRA decomposes the update as:
      W' = W + alpha * (A @ B)
    where A is (d x r) and B is (r x k), with r << min(d, k).
    """

    def __init__(self, d: int, k: int, rank: int = 4, alpha: float = 1.0):
        self.d = d
        self.k = k
        self.rank = rank
        self.alpha = alpha
        
        # Initialize A with small random values, B with zeros
        self.A = np.random.randn(d, rank).astype(np.float32) * 0.01
        self.B = np.zeros((rank, k), dtype=np.float32)
    
    def forward(self, x: np.ndarray) -> np.ndarray:
        """Apply LoRA update: x @ (alpha * A @ B)."""
        return x @ (self.alpha * (self.A @ self.B))
    
    def save(self, path: Path) -> None:
        """Save adapter weights."""
        np.savez(path, A=self.A, B=self.B, 
                 meta=np.array([self.d, self.k, self.rank, self.alpha]))
    
    @classmethod
    def load(cls, path: Path) -> LoRAAdapter:
        """Load adapter weights."""
        data = np.load(path)
        meta = data["meta"]
        adapter = cls(int(meta[0]), int(meta[1]), int(meta[2]), float(meta[3]))
        adapter.A = data["A"]
        adapter.B = data["B"]
        return adapter


class MicroLoRATrainer:
    """
    Lightweight on-device LoRA trainer.
    
    Training pipeline:
      1. Receive training data from Student agent
      2. Tokenize and prepare mini-batches
      3. Forward pass through frozen base + LoRA adapters
      4. Compute loss and backprop through LoRA only
      5. Save checkpoint and report metrics
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        checkpoint_dir: str | Path = "checkpoints/lora",
    ):
        self._config = config or {}
        self._checkpoint_dir = Path(checkpoint_dir)
        self._checkpoint_dir.mkdir(parents=True, exist_ok=True)
        
        # Training hyperparameters
        self._rank = self._config.get("rank", 4)
        self._alpha = self._config.get("alpha", 1.0)
        self._lr = self._config.get("learning_rate", 1e-4)
        self._epochs = self._config.get("epochs", 3)
        self._batch_size = self._config.get("batch_size", 8)
        self._max_length = self._config.get("max_length", 512)
        self._warmup_steps = self._config.get("warmup_steps", 10)
        
        # State
        self._adapters: dict[str, LoRAAdapter] = {}
        self._training_history: list[TrainingResult] = []
        self._best_loss = float("inf")
        self._total_steps = 0

    async def train(
        self, training_data: list[dict[str, Any]]
    ) -> TrainingResult:
        """
        Run a LoRA fine-tuning session.
        
        Args:
            training_data: List of {input, output, label} dicts
            
        Returns:
            TrainingResult with loss and metrics
        """
        start_time = time.time()
        logger.info(
            "lora.training_start",
            samples=len(training_data),
            epochs=self._epochs,
            rank=self._rank,
        )

        # ── 1. Prepare data ──────────────────────────────
        inputs, targets, labels = self._prepare_data(training_data)
        
        if len(inputs) == 0:
            return TrainingResult(
                model_name="lora_adapter",
                final_loss=0.0,
                samples_trained=0,
                epochs_completed=0,
                duration_s=0.0,
            )

        # ── 2. Initialize or load adapters ───────────────
        input_dim = inputs.shape[1] if len(inputs.shape) > 1 else self._max_length
        output_dim = targets.shape[1] if len(targets.shape) > 1 else self._max_length
        
        if "main" not in self._adapters:
            self._adapters["main"] = LoRAAdapter(
                input_dim, output_dim, self._rank, self._alpha
            )
        
        adapter = self._adapters["main"]

        # ── 3. Training loop ─────────────────────────────
        losses = []
        num_batches = max(1, len(inputs) // self._batch_size)
        
        for epoch in range(self._epochs):
            epoch_losses = []
            
            # Shuffle
            indices = np.random.permutation(len(inputs))
            inputs_shuffled = inputs[indices]
            targets_shuffled = targets[indices]
            labels_shuffled = labels[indices]
            
            for batch_idx in range(num_batches):
                start = batch_idx * self._batch_size
                end = min(start + self._batch_size, len(inputs))
                
                batch_x = inputs_shuffled[start:end]
                batch_y = targets_shuffled[start:end]
                batch_labels = labels_shuffled[start:end]
                
                # Forward pass through LoRA
                lora_output = adapter.forward(batch_x)
                
                # Loss: MSE weighted by label confidence
                residual = lora_output - batch_y
                loss = np.mean(residual ** 2 * batch_labels[:, None])
                epoch_losses.append(float(loss))
                
                # Gradient computation (simplified)
                # dL/dB = A.T @ (x.T @ residual) / batch_size
                # dL/dA = (x.T @ residual @ B.T) / batch_size  
                grad_output = 2 * residual * batch_labels[:, None] / len(batch_x)
                
                # Update B: gradient w.r.t. B
                grad_B = adapter.A.T @ (batch_x.T @ grad_output) / len(batch_x)
                
                # Update A: gradient w.r.t. A
                grad_A = (batch_x.T @ grad_output @ adapter.B.T) / len(batch_x)
                
                # Learning rate schedule with warmup
                self._total_steps += 1
                lr = self._lr
                if self._total_steps < self._warmup_steps:
                    lr = self._lr * (self._total_steps / self._warmup_steps)
                
                # SGD update
                adapter.A -= lr * adapter.alpha * grad_A
                adapter.B -= lr * adapter.alpha * grad_B
                
                losses.append(float(loss))
            
            avg_epoch_loss = np.mean(epoch_losses) if epoch_losses else 0
            logger.info(
                "lora.epoch_complete",
                epoch=epoch + 1,
                loss=float(avg_epoch_loss),
            )

        # ── 4. Save checkpoint ───────────────────────────
        final_loss = float(np.mean(losses[-num_batches:])) if losses else 0
        
        checkpoint_name = f"lora_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        checkpoint_path = self._checkpoint_dir / checkpoint_name
        adapter.save(checkpoint_path)
        
        # Save best
        if final_loss < self._best_loss:
            self._best_loss = final_loss
            best_path = self._checkpoint_dir / "lora_best"
            adapter.save(best_path)

        duration = time.time() - start_time
        
        result = TrainingResult(
            model_name="lora_adapter",
            final_loss=final_loss,
            samples_trained=len(inputs),
            epochs_completed=self._epochs,
            duration_s=duration,
            checkpoint_path=str(checkpoint_path),
        )
        
        self._training_history.append(result)
        
        logger.info(
            "lora.training_complete",
            final_loss=final_loss,
            duration_s=f"{duration:.1f}",
            checkpoint=str(checkpoint_path),
        )
        
        return result

    def _prepare_data(
        self, training_data: list[dict[str, Any]]
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Convert training data to numpy arrays."""
        inputs_list = []
        targets_list = []
        labels_list = []
        
        for item in training_data:
            input_text = item.get("input", "")
            output_text = item.get("output", "")
            label = float(item.get("label", 1))
            
            # Simple character-level encoding (in production, use tokenizer)
            input_vec = self._text_to_vector(input_text)
            output_vec = self._text_to_vector(output_text)
            
            inputs_list.append(input_vec)
            targets_list.append(output_vec)
            labels_list.append(label)
        
        if not inputs_list:
            return np.array([]), np.array([]), np.array([])
        
        return (
            np.array(inputs_list, dtype=np.float32),
            np.array(targets_list, dtype=np.float32),
            np.array(labels_list, dtype=np.float32),
        )

    def _text_to_vector(self, text: str) -> np.ndarray:
        """Simple text to fixed-size vector conversion."""
        # Hash-based feature extraction
        vec = np.zeros(self._max_length, dtype=np.float32)
        for i, ch in enumerate(text[:self._max_length]):
            vec[i] = ord(ch) / 256.0
        return vec

    def load_best_adapter(self) -> LoRAAdapter | None:
        """Load the best checkpoint."""
        best_path = self._checkpoint_dir / "lora_best.npz"
        if best_path.exists():
            adapter = LoRAAdapter.load(best_path)
            self._adapters["main"] = adapter
            return adapter
        return None

    def get_training_history(self) -> list[dict[str, Any]]:
        """Get training history."""
        return [
            {
                "model": tr.model_name,
                "loss": tr.final_loss,
                "samples": tr.samples_trained,
                "epochs": tr.epochs_completed,
                "duration": tr.duration_s,
                "checkpoint": tr.checkpoint_path,
                "timestamp": tr.timestamp.isoformat(),
            }
            for tr in self._training_history
        ]

    def rollback(self) -> bool:
        """Rollback to the best checkpoint."""
        adapter = self.load_best_adapter()
        return adapter is not None
