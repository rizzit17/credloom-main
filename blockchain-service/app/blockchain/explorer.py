"""Read-only chain explorer helpers: blocks, transactions, decoded event feed
and protocol-wide statistics, all derived directly from the chain."""
from __future__ import annotations

from decimal import Decimal

from web3 import Web3

from . import chain
from .chain import w3


def _hex(b) -> str:
    return "0x" + bytes(b).hex()


def tx_brief(tx, block_ts: int | None = None) -> dict:
    to = tx.get("to")
    method = None
    cname = chain.ADDR_TO_NAME.get(to) if to else None
    if cname:
        try:
            fn, _ = chain.CONTRACTS[cname].decode_function_input(tx["input"])
            method = fn.fn_name
        except Exception:
            method = None
    elif to and tx["value"] > 0:
        method = "transfer"
    return {
        "txHash": _hex(tx["hash"]),
        "blockNumber": tx["blockNumber"],
        "timestamp": block_ts,
        "from": tx["from"],
        "to": to,
        "toContract": cname,
        "method": method,
        "valueEth": str(Decimal(tx["value"]) / Decimal(10**18)),
    }


def latest_blocks(limit: int = 10) -> list[dict]:
    head = w3.eth.block_number
    out = []
    for n in range(head, max(head - limit, -1), -1):
        b = w3.eth.get_block(n, full_transactions=True)
        out.append(
            {
                "number": b["number"],
                "hash": _hex(b["hash"]),
                "parentHash": _hex(b["parentHash"]),
                "timestamp": b["timestamp"],
                "txCount": len(b["transactions"]),
                "gasUsed": b["gasUsed"],
                "gasLimit": b["gasLimit"],
                "miner": b.get("miner"),
                "transactions": [tx_brief(t, b["timestamp"]) for t in b["transactions"]],
            }
        )
    return out


def block_detail(number: int) -> dict:
    b = w3.eth.get_block(number, full_transactions=True)
    return {
        "number": b["number"],
        "hash": _hex(b["hash"]),
        "parentHash": _hex(b["parentHash"]),
        "timestamp": b["timestamp"],
        "gasUsed": b["gasUsed"],
        "gasLimit": b["gasLimit"],
        "miner": b.get("miner"),
        "transactions": [tx_brief(t, b["timestamp"]) for t in b["transactions"]],
    }


def tx_detail(tx_hash: str) -> dict:
    summary = chain.receipt_summary(tx_hash)
    tx = w3.eth.get_transaction(tx_hash)
    method, args = None, None
    cname = summary["toContract"]
    if cname:
        try:
            fn, params = chain.CONTRACTS[cname].decode_function_input(tx["input"])
            method, args = fn.fn_name, {k: chain._jsonable(v) for k, v in params.items()}
        except Exception:
            pass
    summary["method"] = method
    summary["methodArgs"] = args
    summary["inputBytes"] = (len(tx["input"]) - 2) // 2 if isinstance(tx["input"], str) else len(tx["input"])
    return summary


def events_feed(from_block: int = 0, to_block: int | None = None, limit: int = 100, contract: str | None = None,
                event: str | None = None) -> list[dict]:
    addresses = [c.address for n, c in chain.CONTRACTS.items() if not contract or n == contract]
    if not addresses:
        return []
    to_block = to_block if to_block is not None else w3.eth.block_number
    logs = w3.eth.get_logs({"fromBlock": from_block, "toBlock": to_block, "address": addresses})
    ts_cache: dict[int, int] = {}
    out = []
    for log in logs:
        d = chain.decode_log(log)
        if not d or (event and d["event"] != event):
            continue
        bn = d["blockNumber"]
        if bn not in ts_cache:
            ts_cache[bn] = w3.eth.get_block(bn)["timestamp"]
        d["timestamp"] = ts_cache[bn]
        out.append(d)
    out.sort(key=lambda e: (e["blockNumber"], e["logIndex"]), reverse=True)
    return out[:limit]


def loan_timeline(loan_id: int) -> list[dict]:
    """All events that touched one loan, oldest first. Offer events are linked
    through OfferAccepted so the story starts at the lender's deposit."""
    feed = events_feed(limit=100_000)
    offer_id = None
    for e in feed:
        if e["event"] == "OfferAccepted" and str(e["args"]["loanId"]) == str(loan_id):
            offer_id = str(e["args"]["offerId"])
    related = []
    for e in feed:
        a = e["args"]
        if str(a.get("loanId", "")) == str(loan_id) or (offer_id is not None and str(a.get("offerId", "")) == offer_id):
            related.append(e)
        elif e["event"] in ("LoanFunded", "LoanRepayment", "LoanRepaid", "LoanDefaulted") and False:
            pass
    related.sort(key=lambda e: (e["blockNumber"], e["logIndex"]))
    return related


def stats() -> dict:
    escrow = chain.contract("LoanEscrow")
    pool = chain.contract("LenderLiquidityPool")
    ins = chain.contract("InsurancePool")
    loans = escrow.functions.loanCounter().call()
    offers = pool.functions.offerCounter().call()
    by_state = {"FUNDED": 0, "REPAID": 0, "DEFAULTED": 0}
    open_offers, open_offer_eth = 0, 0
    for i in range(1, offers + 1):
        o = pool.functions.offers(i).call()
        if o[7]:
            open_offers += 1
            open_offer_eth += o[1]
    for i in range(1, loans + 1):
        by_state[chain.LOAN_STATES[escrow.functions.getLoan(i).call()[13]]] += 1
    return {
        "blockNumber": w3.eth.block_number,
        "totalLoans": loans,
        "totalOffers": offers,
        "openOffers": open_offers,
        "openOfferLiquidityEth": chain.wei_to_eth(open_offer_eth),
        "loansByState": by_state,
        "totalOriginatedEth": chain.wei_to_eth(escrow.functions.totalOriginated().call()),
        "totalRepaidPrincipalEth": chain.wei_to_eth(escrow.functions.totalRepaidVolume().call()),
        "totalDefaultedEth": chain.wei_to_eth(escrow.functions.totalDefaultedVolume().call()),
        "insuranceStakedEth": chain.wei_to_eth(ins.functions.totalStaked().call()),
        "insuranceReservedEth": chain.wei_to_eth(ins.functions.totalReserved().call()),
        "defaultRate": (by_state["DEFAULTED"] / (by_state["REPAID"] + by_state["DEFAULTED"]))
        if (by_state["REPAID"] + by_state["DEFAULTED"])
        else 0,
    }
