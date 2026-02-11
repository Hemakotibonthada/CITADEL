"""Test LoRA training pipeline."""
import sys, os, asyncio, shutil
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'src')

from training.micro_lora import MicroLoRATrainer

CHECKPOINT_DIR = "checkpoints/lora_test"

async def test_lora_training():
    print("=" * 60)
    print("TEST: MicroLoRA Training Pipeline")
    print("=" * 60)

    # Clean up previous test checkpoints
    if os.path.exists(CHECKPOINT_DIR):
        shutil.rmtree(CHECKPOINT_DIR)

    # Create trainer with test config
    trainer = MicroLoRATrainer(
        config={
            "rank": 4,
            "alpha": 1.0,
            "learning_rate": 1e-3,
            "epochs": 5,
            "batch_size": 4,
            "max_length": 64,
        },
        checkpoint_dir=CHECKPOINT_DIR,
    )
    print("[OK] Trainer instantiated")

    # Prepare synthetic financial training data
    training_data = [
        {"input": "AAPL stock surged 5% after earnings beat", "output": "bullish signal detected", "label": 1.0},
        {"input": "Fed raises rates again markets down", "output": "bearish macro environment", "label": 1.0},
        {"input": "TSLA deliveries miss estimates stock drops", "output": "bearish signal detected", "label": 1.0},
        {"input": "NVDA AI demand drives record revenue", "output": "bullish signal detected", "label": 1.0},
        {"input": "Inflation data higher than expected", "output": "bearish macro environment", "label": 0.8},
        {"input": "Jobs report strong economy growing", "output": "bullish macro environment", "label": 0.9},
        {"input": "Oil prices spike on supply concerns", "output": "bearish energy sector", "label": 0.7},
        {"input": "Tech earnings season looks promising", "output": "bullish signal detected", "label": 1.0},
        {"input": "Bank failures spark contagion fears", "output": "bearish financial sector", "label": 1.0},
        {"input": "Consumer spending rises retail strong", "output": "bullish consumer sector", "label": 0.9},
        {"input": "Crypto regulation uncertainty grows", "output": "bearish crypto sector", "label": 0.6},
        {"input": "Housing market shows signs of recovery", "output": "bullish real estate", "label": 0.8},
    ]
    print(f"[OK] Prepared {len(training_data)} training samples")

    # === Run training ===
    print("\nTraining...")
    result = await trainer.train(training_data)

    print(f"\n  Model:      {result.model_name}")
    print(f"  Loss:       {result.final_loss:.6f}")
    print(f"  Samples:    {result.samples_trained}")
    print(f"  Epochs:     {result.epochs_completed}")
    print(f"  Duration:   {result.duration_s:.3f}s")
    print(f"  Checkpoint: {result.checkpoint_path}")

    # === Assertions ===
    assert result.model_name == "lora_adapter", f"Expected model_name='lora_adapter', got '{result.model_name}'"
    assert result.samples_trained == len(training_data), f"Expected {len(training_data)} samples, got {result.samples_trained}"
    assert result.epochs_completed == 5, f"Expected 5 epochs, got {result.epochs_completed}"
    assert result.final_loss > 0, "Loss should be > 0"
    assert result.duration_s > 0, "Duration should be > 0"
    assert result.checkpoint_path, "Checkpoint path should be set"
    # np.savez adds .npz extension
    cp = result.checkpoint_path
    cp_npz = cp + ".npz" if not cp.endswith(".npz") else cp
    assert os.path.exists(cp_npz), f"Checkpoint not found: {cp_npz}"
    print("\n[PASS] Training result fields correct")

    # === Verify checkpoint file ===
    print(f"  Checkpoint file: {cp_npz} ({os.path.getsize(cp_npz)} bytes)")
    assert os.path.getsize(cp_npz) > 0, "Checkpoint file should not be empty"
    print("[PASS] Checkpoint saved successfully")

    # === Verify best checkpoint saved ===
    best_path = os.path.join(CHECKPOINT_DIR, "lora_best.npz")
    assert os.path.exists(best_path), "Best checkpoint should be saved"
    print("[PASS] Best checkpoint saved")

    # === Run second training to verify loss tracking ===
    print("\nTraining round 2 (verify continued training)...")
    result2 = await trainer.train(training_data)
    print(f"  Loss round 2: {result2.final_loss:.6f}")
    assert result2.final_loss > 0, "Second training loss should be > 0"
    print("[PASS] Second training round completed")

    # === Test empty data ===
    empty_result = await trainer.train([])
    assert empty_result.samples_trained == 0, "Empty data should train 0 samples"
    assert empty_result.final_loss == 0.0, "Empty data should have 0 loss"
    print("[PASS] Empty data handled gracefully")

    # === Training history ===
    assert len(trainer._training_history) == 2, f"Expected 2 in history, got {len(trainer._training_history)}"
    print("[PASS] Training history tracked")

    # Cleanup
    shutil.rmtree(CHECKPOINT_DIR, ignore_errors=True)

    print("\n" + "=" * 60)
    print("ALL LORA TRAINING TESTS PASSED")
    print("=" * 60)

asyncio.run(test_lora_training())
