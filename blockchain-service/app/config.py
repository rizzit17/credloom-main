"""Runtime configuration. Environment variables win; deployment.json (written by
`npm run deploy` in /blockchain) is used for contract addresses as a fallback."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _load_deployment() -> dict:
    path = ROOT / "deployment.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}


DEPLOYMENT = _load_deployment()

RPC_URL = os.getenv("RPC_URL", "http://127.0.0.1:8545")
CHAIN_ID = int(os.getenv("CHAIN_ID", DEPLOYMENT.get("chainId", 31337)))
NETWORK_NAME = os.getenv("NETWORK_NAME", "Credloom Local Testnet (Hardhat)")

# Custodial demo signing. The accounts are derived from the public Hardhat dev
# mnemonic, so this MUST stay false on any real network.
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
DEMO_MNEMONIC = os.getenv("DEMO_MNEMONIC", "test test test test test test test test test test test junk")
DEMO_ACCOUNT_COUNT = int(os.getenv("DEMO_ACCOUNT_COUNT", "20"))

# Shared secret between the Node backend and this service for write endpoints.
SERVICE_API_KEY = os.getenv("SERVICE_API_KEY", "")

# Optional explicit protocol key; defaults to demo account #0 (the deployer).
BACKEND_PRIVATE_KEY = os.getenv("BACKEND_PRIVATE_KEY", "")

CONTRACT_ADDRESSES = {
    "ReputationRegistry": DEPLOYMENT.get("contracts", {}).get("ReputationRegistry") or os.getenv("REPUTATION_REGISTRY_ADDRESS"),
    "InsurancePool": DEPLOYMENT.get("contracts", {}).get("InsurancePool") or os.getenv("INSURANCE_POOL_ADDRESS"),
    "LoanEscrow": DEPLOYMENT.get("contracts", {}).get("LoanEscrow") or os.getenv("LOAN_ESCROW_ADDRESS"),
    "LenderLiquidityPool": DEPLOYMENT.get("contracts", {}).get("LenderLiquidityPool") or os.getenv("LIQUIDITY_POOL_ADDRESS"),
}
