import os
with open("c:/Users/v-hbonthada/WorkSpace/stock/citadel/.env") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

print("KEY:", repr(os.environ.get("ALPACA_API_KEY", "")))
print("SECRET len:", len(os.environ.get("ALPACA_SECRET_KEY", "")))
print("URL:", repr(os.environ.get("ALPACA_BASE_URL", "")))
