"""HTTP API of the Credloom blockchain service.

Read endpoints are public (the chain is public anyway). Write endpoints sign
transactions with custodial demo keys and therefore require the shared
`X-Service-Key` header when SERVICE_API_KEY is configured."""
from __future__ import annotations

import hmac
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from .. import config
from ..blockchain import chain, explorer
from ..blockchain.chain import ChainError, w3

router = APIRouter()


# ---------------------------------------------------------------- security
def require_service_key(x_service_key: str = Header(default="")):
    if config.SERVICE_API_KEY and not hmac.compare_digest(x_service_key, config.SERVICE_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing service key")


write_guard = [Depends(require_service_key)]


def run(fn, *a, **kw):
    """Translate chain-layer failures into HTTP errors."""
    try:
        return fn(*a, **kw)
    except ChainError as e:
        raise HTTPException(status_code=400, detail={"message": e.message, "code": e.code})
    except HTTPException:
        raise
    except Exception as e:  # node unreachable, etc.
        if not chain.is_connected():
            raise HTTPException(status_code=503, detail={"message": "Blockchain node unreachable", "code": "NODE_DOWN"})
        raise HTTPException(status_code=500, detail={"message": f"{type(e).__name__}: {e}", "code": "INTERNAL"})


# ------------------------------------------------------------------ models
class Address(BaseModel):
    @staticmethod
    def check(v: str) -> str:
        return chain.to_checksum(v)


class CreateOffer(BaseModel):
    lenderAddress: str
    amountEth: Decimal = Field(gt=0, le=10_000)
    durationDays: int = Field(ge=1, le=365)
    minCreditScore: int = Field(ge=0, le=1000)
    minAprBps: int = Field(default=500, ge=0, le=3000)
    maxAprBps: int = Field(default=2500, ge=0, le=3000)


class WithdrawOffer(BaseModel):
    lenderAddress: str
    offerId: int = Field(ge=1)


class AcceptLoan(BaseModel):
    offerId: int = Field(ge=1)
    borrower: str
    aprBps: int = Field(ge=0, le=3000)
    creditScore: int = Field(ge=0, le=1000)
    isInsured: bool = False
    insurer: str | None = None


class Repay(BaseModel):
    loanId: int = Field(ge=1)
    payer: str
    amountEth: Decimal | None = Field(default=None, gt=0)  # omitted => pay everything due


class DefaultLoan(BaseModel):
    loanId: int = Field(ge=1)


class InsurerFunds(BaseModel):
    insurerAddress: str
    amountEth: Decimal = Field(gt=0, le=10_000)


class InsurerTerms(BaseModel):
    insurerAddress: str
    premiumBps: int = Field(ge=0, le=2000)
    accepting: bool = True


class AdvanceTime(BaseModel):
    seconds: int = Field(ge=1, le=365 * 86400)

    @field_validator("seconds")
    @classmethod
    def _ok(cls, v):
        return v


# ------------------------------------------------------------------ system
@router.get("/health")
def health():
    ok = chain.is_connected()
    return {
        "status": "ok" if ok else "degraded",
        "nodeConnected": ok,
        "contractsLoaded": sorted(chain.CONTRACTS.keys()),
        "demoMode": config.DEMO_MODE,
    }


@router.get("/system/info")
def system_info():
    def _info():
        head = w3.eth.get_block("latest")
        return {
            "network": config.NETWORK_NAME,
            "chainId": config.CHAIN_ID,
            "rpcUrl": config.RPC_URL,
            "blockNumber": head["number"],
            "latestBlockTimestamp": head["timestamp"],
            "gasPriceGwei": str(Decimal(w3.eth.gas_price) / Decimal(10**9)),
            "protocolSigner": chain.protocol_account().address,
            "gracePeriodSeconds": chain.contract("LoanEscrow").functions.gracePeriod().call(),
            "demoMode": config.DEMO_MODE,
            "contracts": {k: v.address for k, v in chain.CONTRACTS.items()},
            "deployedAt": config.DEPLOYMENT.get("deployedAt"),
        }

    return run(_info)


@router.get("/system/contracts")
def system_contracts():
    return {k: v.address for k, v in chain.CONTRACTS.items()}


@router.get("/stats")
def stats():
    return run(explorer.stats)


@router.get("/accounts")
def accounts():
    """Custodial demo wallets and their balances."""
    def _accounts():
        out = []
        for i, a in enumerate(chain.demo_accounts()):
            out.append({"index": i, "address": a.address, "balanceEth": chain.wei_to_eth(w3.eth.get_balance(a.address))})
        return out

    if not config.DEMO_MODE:
        raise HTTPException(status_code=404, detail="Demo accounts disabled")
    return run(_accounts)


@router.get("/wallet/{address}/activity")
def wallet_activity(address: str):
    """On-chain footprint used as a credit-scoring feature."""
    def _do():
        a = chain.to_checksum(address)
        return {
            "address": a,
            "transactionCount": w3.eth.get_transaction_count(a),
            "balanceEth": chain.wei_to_eth(w3.eth.get_balance(a)),
        }

    return run(_do)


@router.get("/balance/{address}")
def balance(address: str):
    def _b():
        a = chain.to_checksum(address)
        wei = w3.eth.get_balance(a)
        return {"address": a, "balanceWei": str(wei), "balanceEth": chain.wei_to_eth(wei)}

    return run(_b)


# ----------------------------------------------------------------- lender
@router.post("/lender/create-offer", dependencies=write_guard)
def create_offer(p: CreateOffer):
    def _do():
        if p.minAprBps > p.maxAprBps:
            raise ChainError("minAprBps cannot exceed maxAprBps", "BAD_APR_RANGE")
        pool = chain.contract("LenderLiquidityPool")
        fn = pool.functions.createOffer(p.durationDays * 86400, p.minCreditScore, p.minAprBps, p.maxAprBps)
        s = chain.send_tx(fn, p.lenderAddress, chain.eth_to_wei(p.amountEth))
        ev = chain.find_event(s, "OfferCreated")
        return {"success": True, "offerId": int(ev["args"]["offerId"]), "tx": s}

    return run(_do)


@router.post("/lender/withdraw-offer", dependencies=write_guard)
def withdraw_offer(p: WithdrawOffer):
    def _do():
        fn = chain.contract("LenderLiquidityPool").functions.withdrawOffer(p.offerId)
        return {"success": True, "offerId": p.offerId, "tx": chain.send_tx(fn, p.lenderAddress)}

    return run(_do)


@router.get("/offers")
def list_offers(activeOnly: bool = False, lender: str | None = None):
    def _do():
        pool = chain.contract("LenderLiquidityPool")
        n = pool.functions.offerCounter().call()
        out = [chain.offer_to_dict(i) for i in range(1, n + 1)]
        if activeOnly:
            out = [o for o in out if o["active"]]
        if lender:
            la = chain.to_checksum(lender)
            out = [o for o in out if o["lender"] == la]
        return {"offers": list(reversed(out))}

    return run(_do)


@router.get("/offers/{offer_id}")
def get_offer(offer_id: int):
    return run(chain.offer_to_dict, offer_id)


# ------------------------------------------------------------------- loans
@router.post("/loan/accept", dependencies=write_guard)
def accept_loan(p: AcceptLoan):
    """Protocol (credit oracle) matches a borrower to an offer. The score and
    APR are checked against the lender's rules inside the smart contract."""
    def _do():
        borrower = chain.to_checksum(p.borrower)
        insurer = chain.to_checksum(p.insurer) if p.isInsured else "0x0000000000000000000000000000000000000000"
        if p.isInsured and not p.insurer:
            raise ChainError("An insurer address is required for insured loans", "MISSING_INSURER")
        proto = chain.protocol_account()
        fn = chain.contract("LenderLiquidityPool").functions.acceptOffer(
            p.offerId, borrower, p.aprBps, p.creditScore, p.isInsured, insurer
        )
        s = chain.send_tx(fn, proto.address, signer=proto)
        accepted = chain.find_event(s, "OfferAccepted")
        loan_id = int(accepted["args"]["loanId"])
        return {"success": True, "loanId": loan_id, "loan": chain.loan_to_dict(loan_id), "tx": s}

    return run(_do)


@router.post("/loan/repay", dependencies=write_guard)
def repay_loan(p: Repay):
    def _do():
        escrow = chain.contract("LoanEscrow")
        due = escrow.functions.amountDue(p.loanId).call()
        if due == 0:
            raise ChainError("Nothing is due on this loan", "NOTHING_DUE")
        value = due if p.amountEth is None else chain.eth_to_wei(p.amountEth)
        s = chain.send_tx(escrow.functions.repayLoan(p.loanId), p.payer, value)
        completed = any(e["event"] == "LoanRepaid" for e in s["events"])
        return {"success": True, "completed": completed, "loan": chain.loan_to_dict(p.loanId), "tx": s}

    return run(_do)


@router.post("/loan/default", dependencies=write_guard)
def default_loan(p: DefaultLoan):
    def _do():
        proto = chain.protocol_account()
        s = chain.send_tx(chain.contract("LoanEscrow").functions.markDefault(p.loanId), proto.address, signer=proto)
        return {"success": True, "loan": chain.loan_to_dict(p.loanId), "tx": s}

    return run(_do)


@router.get("/loans")
def list_loans(borrower: str | None = None, lender: str | None = None, insurer: str | None = None,
               state: str | None = None):
    def _do():
        n = chain.contract("LoanEscrow").functions.loanCounter().call()
        out = [chain.loan_to_dict(i) for i in range(1, n + 1)]
        for key, val in (("borrower", borrower), ("lender", lender), ("insurer", insurer)):
            if val:
                a = chain.to_checksum(val)
                out = [l for l in out if l[key] == a]
        if state:
            out = [l for l in out if l["state"] == state.upper()]
        return {"loans": list(reversed(out))}

    return run(_do)


@router.get("/loans/{loan_id}")
def get_loan(loan_id: int):
    def _do():
        loan = chain.loan_to_dict(loan_id)
        if loan["state"] == "NONE":
            raise HTTPException(status_code=404, detail={"message": "Loan not found", "code": "NOT_FOUND"})
        loan["reputation"] = chain.reputation_of(loan["borrower"])
        return loan

    return run(_do)


@router.get("/loans/{loan_id}/timeline")
def loan_timeline(loan_id: int):
    return run(lambda: {"loanId": loan_id, "events": explorer.loan_timeline(loan_id)})


# --------------------------------------------------------------- reputation
@router.get("/borrower/{address}/reputation")
def reputation(address: str):
    return run(chain.reputation_of, address)


@router.get("/borrower/{address}/flagged")
def flagged(address: str):
    return run(lambda: {"flagged": chain.contract("ReputationRegistry").functions.isBorrowerFlagged(chain.to_checksum(address)).call()})


# ----------------------------------------------------------------- insurer
@router.get("/insurer/{address}")
def insurer_info(address: str):
    return run(chain.insurer_of, address)


@router.post("/insurer/deposit", dependencies=write_guard)
def insurer_deposit(p: InsurerFunds):
    def _do():
        s = chain.send_tx(chain.contract("InsurancePool").functions.deposit(), p.insurerAddress, chain.eth_to_wei(p.amountEth))
        return {"success": True, "insurer": chain.insurer_of(p.insurerAddress), "tx": s}

    return run(_do)


@router.post("/insurer/withdraw", dependencies=write_guard)
def insurer_withdraw(p: InsurerFunds):
    def _do():
        fn = chain.contract("InsurancePool").functions.withdraw(chain.eth_to_wei(p.amountEth))
        s = chain.send_tx(fn, p.insurerAddress)
        return {"success": True, "insurer": chain.insurer_of(p.insurerAddress), "tx": s}

    return run(_do)


@router.post("/insurer/terms", dependencies=write_guard)
def insurer_terms(p: InsurerTerms):
    def _do():
        fn = chain.contract("InsurancePool").functions.setTerms(p.premiumBps, p.accepting)
        s = chain.send_tx(fn, p.insurerAddress)
        return {"success": True, "insurer": chain.insurer_of(p.insurerAddress), "tx": s}

    return run(_do)


@router.get("/insurers")
def insurers():
    """Every address that has ever interacted with the insurance pool."""
    def _do():
        feed = explorer.events_feed(contract="InsurancePool", limit=100_000)
        addrs = []
        for e in reversed(feed):
            a = e["args"].get("insurer")
            if a and a not in addrs:
                addrs.append(a)
        return {"insurers": [chain.insurer_of(a) for a in addrs]}

    return run(_do)


# ---------------------------------------------------------------- explorer
@router.get("/explorer/blocks")
def blocks(limit: int = Query(10, ge=1, le=50)):
    return run(lambda: {"blocks": explorer.latest_blocks(limit)})


@router.get("/explorer/blocks/{number}")
def block(number: int):
    return run(explorer.block_detail, number)


@router.get("/explorer/tx/{tx_hash}")
def tx(tx_hash: str):
    return run(explorer.tx_detail, tx_hash)


@router.get("/explorer/events")
def events(fromBlock: int = 0, limit: int = Query(50, ge=1, le=500), contract: str | None = None,
           event: str | None = None):
    return run(lambda: {"events": explorer.events_feed(fromBlock, None, limit, contract, event)})


# -------------------------------------------------------- demo time travel
@router.get("/demo/time")
def demo_time():
    return run(lambda: {"blockTimestamp": w3.eth.get_block("latest")["timestamp"], "blockNumber": w3.eth.block_number})


@router.post("/demo/advance-time", dependencies=write_guard)
def advance_time(p: AdvanceTime):
    """Fast-forward the local chain clock so deadlines and defaults can be demonstrated."""
    if not config.DEMO_MODE:
        raise HTTPException(status_code=403, detail="Time travel is only available in demo mode")

    def _do():
        w3.provider.make_request("evm_increaseTime", [p.seconds])
        w3.provider.make_request("evm_mine", [])
        b = w3.eth.get_block("latest")
        return {"advancedSeconds": p.seconds, "blockNumber": b["number"], "blockTimestamp": b["timestamp"]}

    return run(_do)
