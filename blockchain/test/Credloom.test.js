const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const E = (v) => ethers.parseEther(String(v));

async function deployAll(grace = 0) {
  const [owner, lender, borrower, insurer, other, borrower2] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("ReputationRegistry")).deploy();
  const insurance = await (await ethers.getContractFactory("InsurancePool")).deploy();
  const escrow = await (
    await ethers.getContractFactory("LoanEscrow")
  ).deploy(await registry.getAddress(), await insurance.getAddress(), grace);
  const pool = await (await ethers.getContractFactory("LenderLiquidityPool")).deploy();

  await registry.setLoanEscrowContract(await escrow.getAddress());
  await insurance.setLoanEscrowContract(await escrow.getAddress());
  await escrow.setLiquidityPool(await pool.getAddress());
  await pool.setLoanEscrow(await escrow.getAddress());
  await pool.setProtocol(owner.address);
  return { owner, lender, borrower, insurer, other, borrower2, registry, insurance, escrow, pool };
}

// helper: lender creates an offer, protocol accepts it for `borrower`
async function openLoan(ctx, { amount = 1, days = 30, apr = 1000, score = 700, insured = false, who } = {}) {
  const b = who || ctx.borrower;
  await ctx.pool.connect(ctx.lender).createOffer(days * DAY, 600, 500, 2500, { value: E(amount) });
  const offerId = await ctx.pool.offerCounter();
  await ctx.pool.acceptOffer(
    offerId,
    b.address,
    apr,
    score,
    insured,
    insured ? ctx.insurer.address : ethers.ZeroAddress
  );
  return { offerId, loanId: await ctx.escrow.loanCounter() };
}

describe("Credloom protocol", () => {
  describe("Wiring & access control", () => {
    it("only the owner can wire contracts, and only once", async () => {
      const c = await deployAll();
      await expect(c.registry.connect(c.other).setLoanEscrowContract(c.other.address)).to.be.revertedWithCustomError(
        c.registry,
        "NotAuthorized"
      );
      await expect(c.registry.setLoanEscrowContract(c.other.address)).to.be.revertedWithCustomError(
        c.registry,
        "AlreadySet"
      );
      await expect(c.escrow.connect(c.other).setLiquidityPool(c.other.address)).to.be.revertedWithCustomError(
        c.escrow,
        "NotAuthorized"
      );
    });

    it("only the protocol can accept offers", async () => {
      const c = await deployAll();
      await c.pool.connect(c.lender).createOffer(30 * DAY, 600, 500, 2500, { value: E(1) });
      await expect(
        c.pool.connect(c.other).acceptOffer(1, c.borrower.address, 1000, 700, false, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(c.pool, "NotAuthorized");
    });

    it("escrow functions cannot be called directly", async () => {
      const c = await deployAll();
      await expect(
        c.escrow.createFromOffer(c.borrower.address, c.lender.address, 1, 1000, 700, DAY, false, ethers.ZeroAddress, {
          value: 1,
        })
      ).to.be.revertedWithCustomError(c.escrow, "NotAuthorized");
      await expect(c.registry.connect(c.other).flagBorrower(c.borrower.address)).to.be.revertedWithCustomError(
        c.registry,
        "NotAuthorized"
      );
    });
  });

  describe("Lender offers", () => {
    it("creates an offer holding the funds, and the lender can withdraw", async () => {
      const c = await deployAll();
      await expect(c.pool.connect(c.lender).createOffer(30 * DAY, 650, 500, 2000, { value: E(2) }))
        .to.emit(c.pool, "OfferCreated")
        .withArgs(1, c.lender.address, E(2), 30 * DAY, 650, 500, 2000);
      expect(await ethers.provider.getBalance(await c.pool.getAddress())).to.equal(E(2));

      await expect(c.pool.connect(c.other).withdrawOffer(1)).to.be.revertedWithCustomError(c.pool, "NotLender");
      await expect(() => c.pool.connect(c.lender).withdrawOffer(1)).to.changeEtherBalance(c.lender, E(2));
      await expect(c.pool.connect(c.lender).withdrawOffer(1)).to.be.revertedWithCustomError(c.pool, "OfferInactive");
    });

    it("rejects invalid offer parameters", async () => {
      const c = await deployAll();
      const p = c.pool.connect(c.lender);
      await expect(p.createOffer(DAY, 600, 500, 2000)).to.be.revertedWithCustomError(c.pool, "InvalidParams"); // 0 value
      await expect(p.createOffer(0, 600, 500, 2000, { value: 1 })).to.be.revertedWithCustomError(c.pool, "InvalidParams");
      await expect(p.createOffer(DAY, 600, 2000, 500, { value: 1 })).to.be.revertedWithCustomError(c.pool, "InvalidParams");
      await expect(p.createOffer(DAY, 600, 500, 3500, { value: 1 })).to.be.revertedWithCustomError(c.pool, "InvalidParams");
      await expect(p.createOffer(DAY, 1200, 500, 2000, { value: 1 })).to.be.revertedWithCustomError(c.pool, "InvalidParams");
    });

    it("enforces the lender's score and APR band on-chain", async () => {
      const c = await deployAll();
      await c.pool.connect(c.lender).createOffer(30 * DAY, 650, 800, 1500, { value: E(1) });
      const a = (apr, score) => c.pool.acceptOffer(1, c.borrower.address, apr, score, false, ethers.ZeroAddress);
      await expect(a(1000, 600)).to.be.revertedWithCustomError(c.pool, "CreditScoreTooLow");
      await expect(a(700, 700)).to.be.revertedWithCustomError(c.pool, "AprOutOfRange");
      await expect(a(1600, 700)).to.be.revertedWithCustomError(c.pool, "AprOutOfRange");
      await expect(a(1000, 700)).to.emit(c.pool, "OfferAccepted");
    });
  });

  describe("Loan origination", () => {
    it("funds the borrower with the principal and stores terms", async () => {
      const c = await deployAll();
      const before = await ethers.provider.getBalance(c.borrower.address);
      await openLoan(c, { amount: 1, days: 365, apr: 1000 });
      expect((await ethers.provider.getBalance(c.borrower.address)) - before).to.equal(E(1));

      const loan = await c.escrow.getLoan(1);
      expect(loan.borrower).to.equal(c.borrower.address);
      expect(loan.lender).to.equal(c.lender.address);
      expect(loan.principal).to.equal(E(1));
      expect(loan.interest).to.equal(E(0.1)); // 10% APR for one year
      expect(loan.creditScore).to.equal(700);
      expect(loan.state).to.equal(1);
    });

    it("computes simple interest proportional to duration", async () => {
      const c = await deployAll();
      expect(await c.escrow.quoteInterest(E(10), 1200, 30 * DAY)).to.equal((E(10) * 1200n * BigInt(30 * DAY)) / (365n * 86400n * 10000n));
    });

    it("records the loan in the reputation registry", async () => {
      const c = await deployAll();
      await openLoan(c);
      const r = await c.registry.getRecord(c.borrower.address);
      expect(r.loansTaken).to.equal(1);
      expect(r.totalBorrowed).to.equal(E(1));
      expect(r.flagged).to.equal(false);
    });

    it("refuses a loan to the lender themself", async () => {
      const c = await deployAll();
      await c.pool.connect(c.lender).createOffer(DAY, 0, 0, 2500, { value: E(1) });
      await expect(
        c.pool.acceptOffer(1, c.lender.address, 1000, 700, false, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(c.escrow, "InvalidTerms");
    });

    it("an offer can only be taken once", async () => {
      const c = await deployAll();
      await openLoan(c);
      await expect(
        c.pool.acceptOffer(1, c.borrower2.address, 1000, 700, false, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(c.pool, "OfferInactive");
    });
  });

  describe("Repayment", () => {
    it("full repayment forwards funds to the lender and builds reputation", async () => {
      const c = await deployAll();
      await openLoan(c, { amount: 1, days: 365, apr: 1000 });
      const due = await c.escrow.amountDue(1);
      expect(due).to.equal(E(1.1));

      await expect(() => c.escrow.connect(c.borrower).repayLoan(1, { value: due })).to.changeEtherBalance(c.lender, due);
      expect((await c.escrow.getLoan(1)).state).to.equal(2);
      expect(await c.escrow.amountDue(1)).to.equal(0);

      const r = await c.registry.getRecord(c.borrower.address);
      expect(r.loansRepaid).to.equal(1);
      expect(r.totalRepaid).to.equal(due);
      expect(await c.registry.reputationPoints(c.borrower.address)).to.equal(540);
    });

    it("supports partial repayments and rejects overpayment", async () => {
      const c = await deployAll();
      await openLoan(c, { amount: 1, days: 365, apr: 1000 });
      await expect(c.escrow.connect(c.borrower).repayLoan(1, { value: E(0.4) }))
        .to.emit(c.escrow, "LoanRepayment")
        .withArgs(1, c.borrower.address, E(0.4), E(0.7));
      expect(await c.escrow.amountDue(1)).to.equal(E(0.7));
      await expect(c.escrow.connect(c.borrower).repayLoan(1, { value: E(0.8) })).to.be.revertedWithCustomError(
        c.escrow,
        "Overpayment"
      );
      await expect(c.escrow.connect(c.borrower).repayLoan(1, { value: E(0.7) })).to.emit(c.escrow, "LoanRepaid");
      await expect(c.escrow.connect(c.borrower).repayLoan(1, { value: 1 })).to.be.revertedWithCustomError(
        c.escrow,
        "InvalidState"
      );
    });

    it("rejects zero value and unknown loans", async () => {
      const c = await deployAll();
      await openLoan(c);
      await expect(c.escrow.repayLoan(1, { value: 0 })).to.be.revertedWithCustomError(c.escrow, "IncorrectAmount");
      await expect(c.escrow.repayLoan(99, { value: 1 })).to.be.revertedWithCustomError(c.escrow, "LoanNotFound");
    });
  });

  describe("Default handling", () => {
    it("cannot default before the deadline, and unknown loans are rejected", async () => {
      const c = await deployAll();
      await openLoan(c);
      await expect(c.escrow.markDefault(1)).to.be.revertedWithCustomError(c.escrow, "DeadlineNotPassed");
      await expect(c.escrow.markDefault(42)).to.be.revertedWithCustomError(c.escrow, "LoanNotFound");
    });

    it("flags the borrower permanently and blocks further loans", async () => {
      const c = await deployAll();
      await openLoan(c, { days: 7 });
      await time.increase(8 * DAY);
      expect(await c.escrow.isOverdue(1)).to.equal(true);
      await expect(c.escrow.markDefault(1)).to.emit(c.escrow, "LoanDefaulted").withArgs(1, c.borrower.address, E(1), 0);

      expect(await c.registry.isBorrowerFlagged(c.borrower.address)).to.equal(true);
      expect((await c.escrow.getLoan(1)).state).to.equal(3);
      await expect(openLoan(c)).to.be.revertedWithCustomError(c.escrow, "BorrowerFlagged");
      expect(await c.registry.reputationPoints(c.borrower.address)).to.equal(250);
    });

    it("regression: a second default for the same borrower no longer reverts", async () => {
      const c = await deployAll();
      // two concurrent loans before the borrower is flagged
      await openLoan(c, { days: 7 });
      await openLoan(c, { days: 7 });
      await time.increase(8 * DAY);
      await c.escrow.markDefault(1);
      await expect(c.escrow.markDefault(2)).to.emit(c.escrow, "LoanDefaulted");
      expect((await c.registry.getRecord(c.borrower.address)).loansDefaulted).to.equal(2);
    });

    it("respects the grace period", async () => {
      const c = await deployAll(3 * DAY);
      await openLoan(c, { days: 7 });
      await time.increase(8 * DAY);
      expect(await c.escrow.isOverdue(1)).to.equal(false);
      await expect(c.escrow.markDefault(1)).to.be.revertedWithCustomError(c.escrow, "DeadlineNotPassed");
      await time.increase(3 * DAY);
      await expect(c.escrow.markDefault(1)).to.emit(c.escrow, "LoanDefaulted");
    });

    it("a loan cannot be repaid after being defaulted", async () => {
      const c = await deployAll();
      await openLoan(c, { days: 1 });
      await time.increase(2 * DAY);
      await c.escrow.markDefault(1);
      await expect(c.escrow.repayLoan(1, { value: 1 })).to.be.revertedWithCustomError(c.escrow, "InvalidState");
      await expect(c.escrow.markDefault(1)).to.be.revertedWithCustomError(c.escrow, "InvalidState");
    });
  });

  describe("Insurance", () => {
    async function insurerReady(c, stake = 5, premiumBps = 200) {
      await c.insurance.connect(c.insurer).deposit({ value: E(stake) });
      await c.insurance.connect(c.insurer).setTerms(premiumBps, true);
    }

    it("insurer can deposit, set terms and withdraw free funds", async () => {
      const c = await deployAll();
      await insurerReady(c);
      expect(await c.insurance.getInsurerBalance(c.insurer.address)).to.equal(E(5));
      await expect(() => c.insurance.connect(c.insurer).withdraw(E(1))).to.changeEtherBalance(c.insurer, E(1));
      await expect(c.insurance.connect(c.insurer).withdraw(E(10))).to.be.revertedWithCustomError(
        c.insurance,
        "InsufficientFreeBalance"
      );
      await expect(c.insurance.connect(c.insurer).setTerms(2500, true)).to.be.revertedWithCustomError(
        c.insurance,
        "PremiumTooHigh"
      );
    });

    it("insured loan reserves coverage and pays the premium from the principal", async () => {
      const c = await deployAll();
      await insurerReady(c, 5, 200); // 2%
      const before = await ethers.provider.getBalance(c.borrower.address);
      await openLoan(c, { amount: 1, insured: true });
      expect((await ethers.provider.getBalance(c.borrower.address)) - before).to.equal(E(0.98));

      const ins = await c.insurance.getInsurer(c.insurer.address);
      expect(ins.reserved).to.equal(E(1));
      expect(ins.premiumsEarned).to.equal(E(0.02));
      expect(ins.balance).to.equal(E(5.02));
      expect(ins.activePolicies).to.equal(1);
      expect(await c.insurance.freeBalance(c.insurer.address)).to.equal(E(4.02));
      // reserved funds cannot be withdrawn
      await expect(c.insurance.connect(c.insurer).withdraw(E(4.5))).to.be.revertedWithCustomError(
        c.insurance,
        "InsufficientFreeBalance"
      );
    });

    it("rejects insured loans when insurer is not accepting or under-staked", async () => {
      const c = await deployAll();
      await c.pool.connect(c.lender).createOffer(30 * DAY, 0, 0, 2500, { value: E(1) });
      const accept = () => c.pool.acceptOffer(1, c.borrower.address, 1000, 700, true, c.insurer.address);
      await expect(accept()).to.be.revertedWithCustomError(c.insurance, "NotAccepting");
      await c.insurance.connect(c.insurer).setTerms(100, true);
      await expect(accept()).to.be.revertedWithCustomError(c.insurance, "InsufficientFreeBalance");
    });

    it("regression: one deposit cannot back more principal than it holds", async () => {
      const c = await deployAll();
      await insurerReady(c, 1, 0);
      await openLoan(c, { amount: 1, insured: true });
      await c.pool.connect(c.lender).createOffer(30 * DAY, 0, 0, 2500, { value: E(1) });
      await expect(
        c.pool.acceptOffer(2, c.borrower2.address, 1000, 700, true, c.insurer.address)
      ).to.be.revertedWithCustomError(c.insurance, "InsufficientFreeBalance");
    });

    it("repayment releases the reserved coverage", async () => {
      const c = await deployAll();
      await insurerReady(c);
      await openLoan(c, { amount: 1, days: 30, apr: 1000, insured: true });
      await c.escrow.connect(c.borrower).repayLoan(1, { value: await c.escrow.amountDue(1) });
      const ins = await c.insurance.getInsurer(c.insurer.address);
      expect(ins.reserved).to.equal(0);
      expect(ins.activePolicies).to.equal(0);
    });

    it("default pays the lender from the insurer's stake", async () => {
      const c = await deployAll();
      await insurerReady(c, 5, 200);
      await openLoan(c, { amount: 1, days: 7, insured: true });
      await time.increase(8 * DAY);
      await expect(() => c.escrow.markDefault(1)).to.changeEtherBalance(c.lender, E(1));
      const ins = await c.insurance.getInsurer(c.insurer.address);
      expect(ins.balance).to.equal(E(4.02)); // 5 + 0.02 premium - 1 payout
      expect(ins.reserved).to.equal(0);
      expect(ins.totalPaidOut).to.equal(E(1));
      expect(await c.registry.isBorrowerFlagged(c.borrower.address)).to.equal(true);
    });

    it("partial repayment reduces the insurance payout", async () => {
      const c = await deployAll();
      await insurerReady(c, 5, 0);
      await openLoan(c, { amount: 1, days: 7, insured: true });
      await c.escrow.connect(c.borrower).repayLoan(1, { value: E(0.3) });
      await time.increase(8 * DAY);
      await expect(c.escrow.markDefault(1)).to.emit(c.escrow, "LoanDefaulted").withArgs(1, c.borrower.address, E(0.7), E(0.7));
    });
  });

  describe("Reputation points", () => {
    it("rise with repayments and fall with defaults", async () => {
      const c = await deployAll();
      expect(await c.registry.reputationPoints(c.other.address)).to.equal(500);
      await openLoan(c, { days: 30 });
      await c.escrow.connect(c.borrower).repayLoan(1, { value: await c.escrow.amountDue(1) });
      expect(await c.registry.reputationPoints(c.borrower.address)).to.equal(540);
    });
  });
});
