"""Comprehensive inference test for all ML models."""
import sys, time, os
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'src')

# === 1. Sentence-Transformers Embedding Test ===
print('=' * 60)
print('TEST 1: Sentence-Transformers Embeddings')
print('=' * 60)
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('all-MiniLM-L6-v2')
texts = [
    'Apple stock surged 5% after strong earnings',
    'AAPL shares rose on positive quarterly results',
    'Bitcoin crashed 20% amid regulatory concerns',
    'The weather is sunny today',
]
t0 = time.time()
embeddings = model.encode(texts)
t1 = time.time()
print(f'Encoded {len(texts)} texts in {t1-t0:.3f}s')
print(f'Embedding shape: {embeddings.shape}')

from numpy.linalg import norm
def cosine(a, b):
    return np.dot(a, b) / (norm(a) * norm(b))

sim_apple_aapl = cosine(embeddings[0], embeddings[1])
sim_apple_btc = cosine(embeddings[0], embeddings[2])
sim_apple_weather = cosine(embeddings[0], embeddings[3])
print(f'  Apple-AAPL similarity:   {sim_apple_aapl:.4f} (expect high)')
print(f'  Apple-Bitcoin similarity: {sim_apple_btc:.4f} (expect medium)')
print(f'  Apple-Weather similarity: {sim_apple_weather:.4f} (expect low)')
assert sim_apple_aapl > sim_apple_weather, "Semantic similarity ranking failed"
print('  PASS: Semantic similarity ranking correct')

# === 2. FAISS Vector Search Test ===
print()
print('=' * 60)
print('TEST 2: FAISS Vector Index')
print('=' * 60)
import faiss

dim = embeddings.shape[1]
index = faiss.IndexFlatIP(dim)
faiss.normalize_L2(embeddings)
index.add(embeddings)
print(f'FAISS index: {index.ntotal} vectors, dim={dim}')

query = model.encode(['tech stock rally'])
faiss.normalize_L2(query)
D, I = index.search(query, 3)
print(f'Query: "tech stock rally"')
for rank, (dist, idx) in enumerate(zip(D[0], I[0])):
    print(f'  #{rank+1}: score={dist:.4f} -> "{texts[idx]}"')
assert I[0][0] in [0, 1], "FAISS should return Apple/AAPL stock texts first"
print('  PASS: FAISS search returns relevant results')

# === 3. FinBERT Sentiment Test ===
print()
print('=' * 60)
print('TEST 3: FinBERT Sentiment Analysis')
print('=' * 60)
from transformers import pipeline
sentiment = pipeline('sentiment-analysis', model='ProsusAI/finbert', top_k=None)

headlines = [
    ('Apple reports record quarterly revenue beating expectations', 'positive'),
    ('Fed raises interest rates, markets tumble', 'negative'),
    ('Company announces routine board meeting', 'neutral'),
    ('Massive layoffs expected as recession fears grow', 'negative'),
    ('Tesla delivers 500k vehicles, stock jumps 8%', 'positive'),
]
correct = 0
for text, expected in headlines:
    result = sentiment(text)[0]
    top = max(result, key=lambda x: x['score'])
    match = '✓' if top['label'] == expected else '✗'
    if top['label'] == expected:
        correct += 1
    print(f'  [{match}] [{top["label"]:>8s} {top["score"]:.3f}] {text}')

print(f'  Accuracy: {correct}/{len(headlines)}')
assert correct >= 3, f"FinBERT accuracy too low: {correct}/{len(headlines)}"
print('  PASS: FinBERT sentiment analysis working')

# === 4. Hardware Accelerator Test ===
print()
print('=' * 60)
print('TEST 4: Hardware Accelerator Detection')
print('=' * 60)
from hardware.accelerator import get_accelerator
accel = get_accelerator()
info = accel.device_info()
print(f'Name:    {accel.name()}')
print(f'Backend: {info["backend"]}')
print(f'Device:  {info.get("device", "N/A")}')
assert info["backend"] in ('CUDA', 'MPS', 'CPU'), f"Unknown backend: {info['backend']}"
print('  PASS: Hardware accelerator detected')

print()
print('=' * 60)
print('ALL INFERENCE TESTS PASSED')
print('=' * 60)
