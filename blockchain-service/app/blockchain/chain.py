"""Core blockchain layer: provider, contracts, custodial signing, receipts,
revert decoding and event decoding. Everything the API returns about a
transaction (block, gas, decoded events) is produced here so the UI can show
what really happened on-chain."""
from __future__ import annotations

import json
import threading
from decimal import Decimal
from typing import Any

from eth_account import Account
from web3 import Web3
from web3._utils.events import get_event_data
from web3.exceptions import ContractCustomError, ContractLogicError

from .. import config

Account.enable_unaudited_hdwallet_features()

ABI_DIR = config.ROOT / "abi"
CONTRACT_NAMES = ["ReputationRegistry", "InsurancePool", "LoanEscrow", "LenderLiquidityPool"]
LOAN_STATES = ["NONE", "FUNDED", "REPAID", "DEFAULTED"]

w3 = Web3(Web3.HTTPProvider(config.RPC_URL, request_kwargs={"timeout": 30}))
_tx_lock = threading.Lock()


class ChainError(Exception):
    """A failure that is the caller's fault (revert, bad input)."""

    def __init__(self, message: str, code: str = "CHAIN_ERROR"):
        super().__init__(message)
        self.message = message
        self.code = code


# --------------------------------------------------------------------------
# Contracts
# --------------------------------------------------------------------------
ABIS: dict[str, list] = {}
CONTRACTS: dict[str, Any] = {}
ADDR_TO_NAME: dict[str, str] = {}
EVENT_BY_TOPIC: dict[str, tuple[str, dict]] = {}  # topic0 -> (contract, abi entry)
ERROR_BY_SELECTOR: dict[str, str] = {}


def _sig(entry: dict) -> str:
    return f"{entry['name']}({','.join(_type(i) for i in entry.get('inputs', []))})"


def _type(i: dict) -> str:
    if i["type"].startswith("tuple"):
        inner = ",".join(_type(c) for c in i["components"])
        return f"({inner}){i['type'][5:]}"
    return i["type"]


def load_contracts() -> None:
    ABIS.clear(); CONTRACTS.clear(); ADDR_TO_NAME.clear(); EVENT_BY_TOPIC.clear(); ERROR_BY_SELECTOR.clear()
    for name in CONTRACT_NAMES:
        addr = config.CONTRACT_ADDRESSES.get(name)
        abi_file = ABI_DIR / f"{name}.json"
        if not addr or not abi_file.exists():
            continue
        abi = json.loads(abi_file.read_text())
        ABIS[name] = abi
        CONTRACTS[name] = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=abi)
        ADDR_TO_NAME[Web3.to_checksum_address(addr)] = name
        for e in abi:
            if e["type"] == "event":
                topic = "0x" + Web3.keccak(text=_sig(e)).hex().removeprefix("0x")
                EVENT_BY_TOPIC[topic] = (name, e)
            elif e["type"] == "error":
                sel = "0x" + Web3.keccak(text=_sig(e)).hex().removeprefix("0x")[:8]
                ERROR_BY_SELECTOR[sel] = e["name"]


load_contracts()


def contract(name: str):
    if name not in CONTRACTS:
        raise ChainError(f"Contract {name} is not configured. Run `npm run deploy` in /blockchain.", "NOT_DEPLOYED")
    return CONTRACTS[name]


def is_connected() -> bool:
    try:
        return w3.is_connected()
    except Exception:
        return False


# --------------------------------------------------------------------------
# Accounts (custodial demo wallets)
# --------------------------------------------------------------------------
_DEMO_ACCOUNTS: list[Any] = []


def demo_accounts() -> list[Any]:
    if not _DEMO_ACCOUNTS:
        for i in range(config.DEMO_ACCOUNT_COUNT):
            _DEMO_ACCOUNTS.append(Account.from_mnemonic(config.DEMO_MNEMONIC, account_path=f"m/44'/60'/0'/0/{i}"))
    return _DEMO_ACCOUNTS


def protocol_account():
    if config.BACKEND_PRIVATE_KEY:
        return Account.from_key(config.BACKEND_PRIVATE_KEY)
    return demo_accounts()[0]


def signer_for(address: str):
    address = to_checksum(address)
    if address == protocol_account().address:
        return protocol_account()
    if not config.DEMO_MODE:
        raise ChainError("Custodial signing is disabled (DEMO_MODE=false)", "CUSTODY_DISABLED")
    for acct in demo_accounts():
        if acct.address == address:
            return acct
    raise ChainError(f"No custodial key for {address}. Use one of the demo wallets.", "UNKNOWN_WALLET")


def to_checksum(address: str) -> str:
    if not isinstance(address, str) or not Web3.is_address(address):
        raise ChainError(f"Invalid address: {address}", "BAD_ADDRESS")
    return Web3.to_checksum_address(address)


def eth_to_wei(amount) -> int:
    try:
        d = Decimal(str(amount))
    except Exception:
        raise ChainError("Invalid amount", "BAD_AMOUNT")
    if d <= 0:
        raise ChainError("Amount must be greater than zero", "BAD_AMOUNT")
    return int(d * Decimal(10**18))


# --------------------------------------------------------------------------
# Revert decoding
# --------------------------------------------------------------------------
def _explain_error(exc: Exception) -> str:
    data = None
    if isinstance(exc, ContractCustomError):
        data = exc.data
    elif exc.args and isinstance(exc.args[0], str) and exc.args[0].startswith("0x"):
        data = exc.args[0]
    if isinstance(data, str) and data.startswith("0x") and len(data) >= 10:
        name = ERROR_BY_SELECTOR.get(data[:10])
        if name:
            return name
    text = str(exc)
    for sel, name in ERROR_BY_SELECTOR.items():
        if sel in text:
            return name
    if isinstance(exc, ContractLogicError):
        return str(exc.message or exc)
    return text[:300]


# --------------------------------------------------------------------------
# Transactions
# --------------------------------------------------------------------------
def _jsonable(v: Any) -> Any:
    if isinstance(v, (bytes, bytearray)):
        return "0x" + bytes(v).hex()
    if isinstance(v, int) and not isinstance(v, bool):
        return str(v) if abs(v) > 2**53 else v
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if hasattr(v, "items"):
        return {k: _jsonable(x) for k, x in v.items()}
    return v


def decode_log(log) -> dict | None:
    topics = log["topics"]
    if not topics:
        return None
    topic0 = topics[0].hex() if hasattr(topics[0], "hex") else topics[0]
    topic0 = "0x" + topic0.removeprefix("0x")
    hit = EVENT_BY_TOPIC.get(topic0)
    if not hit:
        return None
    cname, abi = hit
    # Make sure the log was emitted by that contract
    if ADDR_TO_NAME.get(Web3.to_checksum_address(log["address"])) != cname:
        return None
    ev = get_event_data(w3.codec, abi, log)
    return {
        "contract": cname,
        "event": abi["name"],
        "args": {k: _jsonable(v) for k, v in dict(ev["args"]).items()},
        "logIndex": ev["logIndex"],
        "address": log["address"],
        "txHash": "0x" + ev["transactionHash"].hex().removeprefix("0x"),
        "blockNumber": ev["blockNumber"],
    }


def decode_logs(receipt) -> list[dict]:
    out = []
    for log in receipt["logs"]:
        d = decode_log(log)
        if d:
            out.append(d)
    return out


def receipt_summary(tx_hash, receipt=None, tx=None) -> dict:
    """Everything the UI needs to describe a mined transaction."""
    receipt = receipt or w3.eth.get_transaction_receipt(tx_hash)
    tx = tx or w3.eth.get_transaction(tx_hash)
    block = w3.eth.get_block(receipt["blockNumber"])
    gas_price = receipt.get("effectiveGasPrice", tx.get("gasPrice", 0))
    fee_wei = receipt["gasUsed"] * gas_price
    to = receipt.get("to")
    return {
        "txHash": "0x" + bytes(receipt["transactionHash"]).hex(),
        "status": "success" if receipt["status"] == 1 else "reverted",
        "blockNumber": receipt["blockNumber"],
        "blockHash": "0x" + bytes(block["hash"]).hex(),
        "timestamp": block["timestamp"],
        "confirmations": w3.eth.block_number - receipt["blockNumber"] + 1,
        "from": receipt["from"],
        "to": to,
        "toContract": ADDR_TO_NAME.get(to) if to else None,
        "valueWei": str(tx["value"]),
        "valueEth": str(Decimal(tx["value"]) / Decimal(10**18)),
        "gasUsed": receipt["gasUsed"],
        "gasLimit": tx["gas"],
        "gasPriceGwei": str(Decimal(gas_price) / Decimal(10**9)),
        "feeEth": str(Decimal(fee_wei) / Decimal(10**18)),
        "nonce": tx["nonce"],
        "events": decode_logs(receipt),
    }


def send_tx(fn, sender: str, value: int = 0, *, signer=None) -> dict:
    """Sign + send a contract call from a custodial account and wait for the receipt."""
    sender = to_checksum(sender)
    acct = signer or signer_for(sender)
    with _tx_lock:  # serialise nonces for the demo signers
        base = {"from": sender, "value": value, "chainId": config.CHAIN_ID}
        try:
            gas = fn.estimate_gas(base)
        except Exception as exc:  # reverts surface here
            raise ChainError(_explain_error(exc), "REVERTED")
        tx = fn.build_transaction(
            {
                **base,
                "nonce": w3.eth.get_transaction_count(sender, "pending"),
                "gas": int(gas * 1.25) + 10_000,
                "gasPrice": w3.eth.gas_price,
            }
        )
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    summary = receipt_summary(tx_hash, receipt)
    if receipt["status"] != 1:
        raise ChainError("Transaction reverted on-chain", "REVERTED")
    return summary


def find_event(summary: dict, name: str) -> dict:
    for e in summary["events"]:
        if e["event"] == name:
            return e
    raise ChainError(f"Expected event {name} was not emitted", "MISSING_EVENT")


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------
def wei_to_eth(wei: int) -> str:
    return str(Decimal(wei) / Decimal(10**18))


def loan_to_dict(loan_id: int, t=None) -> dict:
    escrow = contract("LoanEscrow")
    t = t or escrow.functions.getLoan(loan_id).call()
    (borrower, lender, insurer, principal, interest, repaid, premium, duration, start, deadline, apr, score, insured, state) = t
    now = w3.eth.get_block("latest")["timestamp"]
    state_name = LOAN_STATES[state]
    due = max(principal + interest - repaid, 0) if state == 1 else 0
    return {
        "loanId": loan_id,
        "borrower": borrower,
        "lender": lender,
        "insurer": insurer if insured else None,
        "principalEth": wei_to_eth(principal),
        "interestEth": wei_to_eth(interest),
        "repaidEth": wei_to_eth(repaid),
        "premiumEth": wei_to_eth(premium),
        "amountDueEth": wei_to_eth(due),
        "durationSeconds": duration,
        "startTime": start,
        "deadline": deadline,
        "aprBps": apr,
        "creditScore": score,
        "isInsured": insured,
        "state": state_name,
        "overdue": state_name == "FUNDED" and now > deadline + escrow.functions.gracePeriod().call(),
        "secondsRemaining": max(deadline - now, 0) if state_name == "FUNDED" else 0,
    }


def offer_to_dict(offer_id: int, t=None) -> dict:
    pool = contract("LenderLiquidityPool")
    t = t or pool.functions.offers(offer_id).call()
    lender, amount, duration, min_score, min_apr, max_apr, created, active = t
    return {
        "offerId": offer_id,
        "lender": lender,
        "amountEth": wei_to_eth(amount),
        "durationSeconds": duration,
        "durationDays": duration // 86400,
        "minCreditScore": min_score,
        "minAprBps": min_apr,
        "maxAprBps": max_apr,
        "createdAt": created,
        "active": active,
    }


def reputation_of(address: str) -> dict:
    reg = contract("ReputationRegistry")
    addr = to_checksum(address)
    r = reg.functions.getRecord(addr).call()
    loans_taken, repaid, defaulted, borrowed, total_repaid, first, last, flagged = r
    return {
        "address": addr,
        "loansTaken": loans_taken,
        "loansRepaid": repaid,
        "loansDefaulted": defaulted,
        "totalBorrowedEth": wei_to_eth(borrowed),
        "totalRepaidEth": wei_to_eth(total_repaid),
        "firstLoanAt": first or None,
        "lastActivityAt": last or None,
        "flagged": flagged,
        "reputationPoints": reg.functions.reputationPoints(addr).call(),
    }


def insurer_of(address: str) -> dict:
    pool = contract("InsurancePool")
    addr = to_checksum(address)
    (balance, reserved, earned, paid, active, total, bps, accepting) = pool.functions.getInsurer(addr).call()
    return {
        "address": addr,
        "balanceEth": wei_to_eth(balance),
        "reservedEth": wei_to_eth(reserved),
        "freeEth": wei_to_eth(balance - reserved),
        "premiumsEarnedEth": wei_to_eth(earned),
        "totalPaidOutEth": wei_to_eth(paid),
        "activePolicies": active,
        "totalPolicies": total,
        "premiumBps": bps,
        "accepting": accepting,
    }
