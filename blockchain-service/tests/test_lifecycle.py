"""End-to-end test of the service against a LIVE local Hardhat node with the
contracts deployed (`npx hardhat node` + `npm run deploy` in /blockchain).

Run:  ./venv/bin/python -m pytest tests -q
The test advances the chain clock, so run it on a disposable node."""
import pytest
from fastapi.testclient import TestClient

from app import config
from app.blockchain import chain
from app.main import app

pytestmark = pytest.mark.skipif(not chain.is_connected() or "LoanEscrow" not in chain.CONTRACTS,
                                reason="needs a running Hardhat node with deployed contracts")

client = TestClient(app)
H = {"X-Service-Key": config.SERVICE_API_KEY}
A = [a.address for a in chain.demo_accounts()]
LENDER, BORROWER, INSURER = A[16], A[18], A[17]  # top accounts: never assigned to app users by the API tests/seed


def post(path, body, ok=True):
    r = client.post(path, json=body, headers=H)
    if ok:
        assert r.status_code == 200, r.text
    return r


def test_health_and_info():
    assert client.get("/health").json()["nodeConnected"] is True
    info = client.get("/system/info").json()
    assert info["chainId"] == config.CHAIN_ID and len(info["contracts"]) == 4


def test_writes_require_service_key():
    r = client.post("/lender/create-offer", json={"lenderAddress": LENDER, "amountEth": 1, "durationDays": 5, "minCreditScore": 0})
    assert r.status_code == 401


def test_validation_errors_are_clean():
    r = post("/lender/create-offer", {"lenderAddress": LENDER, "amountEth": 1, "durationDays": 5, "minCreditScore": 0,
                                     "minAprBps": 2000, "maxAprBps": 500}, ok=False)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "BAD_APR_RANGE"
    r = post("/lender/create-offer", {"lenderAddress": "nope", "amountEth": 1, "durationDays": 5, "minCreditScore": 0}, ok=False)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "BAD_ADDRESS"


def test_repaid_insured_loan_full_lifecycle():
    post("/insurer/deposit", {"insurerAddress": INSURER, "amountEth": 3})
    post("/insurer/terms", {"insurerAddress": INSURER, "premiumBps": 200, "accepting": True})

    created = post("/lender/create-offer", {"lenderAddress": LENDER, "amountEth": 1, "durationDays": 30,
                                            "minCreditScore": 600, "minAprBps": 500, "maxAprBps": 2000}).json()
    offer_id = created["offerId"]
    tx = created["tx"]
    assert tx["status"] == "success" and tx["blockNumber"] > 0 and tx["gasUsed"] > 0
    assert any(e["event"] == "OfferCreated" for e in tx["events"])

    # contract enforces the lender's rules
    bad = post("/loan/accept", {"offerId": offer_id, "borrower": BORROWER, "aprBps": 1000, "creditScore": 500}, ok=False)
    assert bad.status_code == 400 and bad.json()["detail"]["message"] == "CreditScoreTooLow"

    accepted = post("/loan/accept", {"offerId": offer_id, "borrower": BORROWER, "aprBps": 1000, "creditScore": 720,
                                     "isInsured": True, "insurer": INSURER}).json()
    loan_id = accepted["loanId"]
    assert accepted["loan"]["state"] == "FUNDED" and accepted["loan"]["isInsured"]
    assert float(accepted["loan"]["premiumEth"]) == pytest.approx(0.02)
    assert {e["event"] for e in accepted["tx"]["events"]} >= {"OfferAccepted", "LoanFunded", "CoverageReserved"}

    ins = client.get(f"/insurer/{INSURER}").json()
    assert float(ins["reservedEth"]) == pytest.approx(1.0) and ins["activePolicies"] == 1

    part = post("/loan/repay", {"loanId": loan_id, "payer": BORROWER, "amountEth": 0.5}).json()
    assert part["completed"] is False
    full = post("/loan/repay", {"loanId": loan_id, "payer": BORROWER}).json()
    assert full["completed"] is True and full["loan"]["state"] == "REPAID"

    rep = client.get(f"/borrower/{BORROWER}/reputation").json()
    assert rep["loansRepaid"] == 1 and rep["reputationPoints"] == 540 and rep["flagged"] is False

    timeline = client.get(f"/loans/{loan_id}/timeline").json()["events"]
    names = [e["event"] for e in timeline]
    assert names[0] == "OfferCreated" and names[-1] == "LoanRepaid"

    detail = client.get(f"/explorer/tx/{full['tx']['txHash']}").json()
    assert detail["method"] == "repayLoan" and detail["toContract"] == "LoanEscrow"


def test_default_with_insurance_payout_and_time_travel():
    lender, borrower, insurer = A[16], A[19], A[17]
    post("/insurer/deposit", {"insurerAddress": insurer, "amountEth": 2})
    post("/insurer/terms", {"insurerAddress": insurer, "premiumBps": 100, "accepting": True})
    offer = post("/lender/create-offer", {"lenderAddress": lender, "amountEth": 1, "durationDays": 7,
                                          "minCreditScore": 0}).json()["offerId"]
    loan = post("/loan/accept", {"offerId": offer, "borrower": borrower, "aprBps": 1200, "creditScore": 640,
                                 "isInsured": True, "insurer": insurer}).json()["loanId"]

    early = post("/loan/default", {"loanId": loan}, ok=False)
    assert early.status_code == 400 and early.json()["detail"]["message"] == "DeadlineNotPassed"

    before = float(client.get(f"/balance/{lender}").json()["balanceEth"])
    post("/demo/advance-time", {"seconds": 8 * 86400})
    assert client.get(f"/loans/{loan}").json()["overdue"] is True

    res = post("/loan/default", {"loanId": loan}).json()
    ev = next(e for e in res["tx"]["events"] if e["event"] == "LoanDefaulted")
    assert int(ev["args"]["insurancePayout"]) == 10**18
    assert float(client.get(f"/balance/{lender}").json()["balanceEth"]) == pytest.approx(before + 1.0, abs=1e-6)
    assert client.get(f"/borrower/{borrower}/flagged").json()["flagged"] is True

    # a flagged borrower can never borrow again
    offer2 = post("/lender/create-offer", {"lenderAddress": lender, "amountEth": 1, "durationDays": 7,
                                           "minCreditScore": 0}).json()["offerId"]
    blocked = post("/loan/accept", {"offerId": offer2, "borrower": borrower, "aprBps": 1000, "creditScore": 800}, ok=False)
    assert blocked.status_code == 400 and blocked.json()["detail"]["message"] == "BorrowerFlagged"


def test_explorer_and_stats():
    blocks = client.get("/explorer/blocks?limit=5").json()["blocks"]
    assert blocks and blocks[0]["number"] >= blocks[-1]["number"]
    assert client.get("/explorer/events?limit=5").json()["events"]
    s = client.get("/stats").json()
    assert s["totalLoans"] >= 2 and s["loansByState"]["DEFAULTED"] >= 1
