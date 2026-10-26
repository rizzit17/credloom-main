// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ReputationRegistry.sol";
import "./InsurancePool.sol";

/**
 * @title LoanEscrow
 * @author CredLoom
 *
 * @notice Lifecycle manager for every loan: funding, (partial) repayment,
 *         default detection, insurance settlement and reputation updates.
 *
 * Interest model: simple interest, computed on-chain and fixed at origination
 *   interest = principal * aprBps * duration / (365 days * 10_000)
 *
 * Insurance model: if the loan is insured, the insurer's premium is withheld
 * from the principal paid out to the borrower and credited to the insurer.
 * Coverage equal to the principal is reserved in InsurancePool until the loan
 * is repaid or defaulted.
 */
contract LoanEscrow {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    enum LoanState {
        NONE,
        FUNDED,
        REPAID,
        DEFAULTED
    }

    struct Loan {
        address borrower;
        address lender;
        address insurer;
        uint256 principal;
        uint256 interest;
        uint256 repaid;
        uint256 premium;
        uint256 duration;
        uint256 startTime;
        uint256 deadline;
        uint16 aprBps;
        uint16 creditScore;
        bool isInsured;
        LoanState state;
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable owner;
    uint256 public immutable gracePeriod; // seconds after deadline before default

    uint256 public loanCounter;
    mapping(uint256 => Loan) private loans;

    ReputationRegistry public immutable reputationRegistry;
    InsurancePool public immutable insurancePool;
    address public liquidityPool;

    uint256 public totalOriginated;
    uint256 public totalRepaidVolume;
    uint256 public totalDefaultedVolume;

    uint256 private _lock = 1;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event LoanFunded(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 principal,
        uint256 interest,
        uint256 deadline,
        uint16 aprBps,
        bool insured
    );
    event LoanRepayment(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 remaining);
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 totalPaid);
    event LoanDefaulted(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 outstandingPrincipal,
        uint256 insurancePayout
    );

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotAuthorized();
    error AlreadySet();
    error ZeroAddress();
    error BorrowerFlagged();
    error LoanNotFound();
    error InvalidState();
    error DeadlineNotPassed();
    error IncorrectAmount();
    error Overpayment();
    error InvalidTerms();
    error TransferFailed();
    error Reentrancy();

    constructor(address _reputationRegistry, address _insurancePool, uint256 _gracePeriod) {
        if (_reputationRegistry == address(0) || _insurancePool == address(0)) revert ZeroAddress();
        owner = msg.sender;
        reputationRegistry = ReputationRegistry(_reputationRegistry);
        insurancePool = InsurancePool(_insurancePool);
        gracePeriod = _gracePeriod;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    function setLiquidityPool(address _pool) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (liquidityPool != address(0)) revert AlreadySet();
        if (_pool == address(0)) revert ZeroAddress();
        liquidityPool = _pool;
    }

    /*//////////////////////////////////////////////////////////////
                              ORIGINATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Called by LenderLiquidityPool when an offer is accepted.
    ///         msg.value must equal the principal held in the offer.
    function createFromOffer(
        address borrower,
        address lender,
        uint256 principal,
        uint16 aprBps,
        uint16 creditScore,
        uint256 duration,
        bool isInsured,
        address insurer
    ) external payable nonReentrant returns (uint256 loanId) {
        if (msg.sender != liquidityPool) revert NotAuthorized();
        if (msg.value != principal || principal == 0) revert IncorrectAmount();
        if (duration == 0 || borrower == address(0) || borrower == lender) revert InvalidTerms();
        if (!reputationRegistry.isBorrowerClean(borrower)) revert BorrowerFlagged();
        if (isInsured && (insurer == address(0) || insurer == borrower || insurer == lender)) revert InvalidTerms();

        loanId = ++loanCounter;
        uint256 interest = (principal * aprBps * duration) / (365 days * 10_000);

        Loan storage l = loans[loanId];
        l.borrower = borrower;
        l.lender = lender;
        l.insurer = isInsured ? insurer : address(0);
        l.principal = principal;
        l.interest = interest;
        l.duration = duration;
        l.startTime = block.timestamp;
        l.deadline = block.timestamp + duration;
        l.aprBps = aprBps;
        l.creditScore = creditScore;
        l.isInsured = isInsured;
        l.state = LoanState.FUNDED;

        totalOriginated += principal;
        reputationRegistry.recordLoan(borrower, principal);

        uint256 toBorrower = principal;
        if (isInsured) {
            uint256 premium = insurancePool.quotePremium(insurer, principal);
            l.premium = premium;
            insurancePool.reserveCoverage{value: premium}(insurer, loanId, principal);
            toBorrower = principal - premium;
        }

        (bool ok, ) = payable(borrower).call{value: toBorrower}("");
        if (!ok) revert TransferFailed();

        emit LoanFunded(loanId, borrower, lender, principal, interest, l.deadline, aprBps, isInsured);
    }

    /*//////////////////////////////////////////////////////////////
                               REPAYMENT
    //////////////////////////////////////////////////////////////*/

    /// @notice Repay any amount up to what is still owed. Each payment is
    ///         forwarded to the lender immediately. Anyone may pay on behalf
    ///         of the borrower. Allowed until the loan is marked defaulted.
    function repayLoan(uint256 loanId) external payable nonReentrant {
        Loan storage l = loans[loanId];
        if (l.state == LoanState.NONE) revert LoanNotFound();
        if (l.state != LoanState.FUNDED) revert InvalidState();
        if (msg.value == 0) revert IncorrectAmount();

        uint256 due = l.principal + l.interest;
        uint256 remaining = due - l.repaid;
        if (msg.value > remaining) revert Overpayment();

        l.repaid += msg.value;
        remaining -= msg.value;
        bool completed = remaining == 0;

        if (completed) {
            l.state = LoanState.REPAID;
            totalRepaidVolume += l.principal;
            if (l.isInsured) insurancePool.releaseCoverage(l.insurer, loanId, l.principal);
        }
        reputationRegistry.recordRepayment(l.borrower, msg.value, completed);

        (bool ok, ) = payable(l.lender).call{value: msg.value}("");
        if (!ok) revert TransferFailed();

        emit LoanRepayment(loanId, msg.sender, msg.value, remaining);
        if (completed) emit LoanRepaid(loanId, l.borrower, due);
    }

    /*//////////////////////////////////////////////////////////////
                             DEFAULT HANDLING
    //////////////////////////////////////////////////////////////*/

    /// @notice Anyone can settle a loan once deadline + grace has passed.
    function markDefault(uint256 loanId) external nonReentrant {
        Loan storage l = loans[loanId];
        if (l.state == LoanState.NONE) revert LoanNotFound();
        if (l.state != LoanState.FUNDED) revert InvalidState();
        if (block.timestamp <= l.deadline + gracePeriod) revert DeadlineNotPassed();

        l.state = LoanState.DEFAULTED;

        // Principal still owed after any partial repayments (repayments count
        // towards principal first for lender-protective accounting).
        uint256 outstandingPrincipal = l.repaid >= l.principal ? 0 : l.principal - l.repaid;
        totalDefaultedVolume += outstandingPrincipal;

        uint256 paid = 0;
        if (l.isInsured) {
            // Insurance settlement can never block reputation damage.
            try insurancePool.payout(l.insurer, l.lender, loanId, l.principal, outstandingPrincipal) returns (uint256 p) {
                paid = p;
            } catch {
                // payout failed; coverage state is untouched, borrower still flagged
            }
        }

        reputationRegistry.flagBorrower(l.borrower);
        emit LoanDefaulted(loanId, l.borrower, outstandingPrincipal, paid);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function amountDue(uint256 loanId) external view returns (uint256) {
        Loan storage l = loans[loanId];
        if (l.state != LoanState.FUNDED) return 0;
        return l.principal + l.interest - l.repaid;
    }

    function isOverdue(uint256 loanId) external view returns (bool) {
        Loan storage l = loans[loanId];
        return l.state == LoanState.FUNDED && block.timestamp > l.deadline + gracePeriod;
    }

    function quoteInterest(uint256 principal, uint16 aprBps, uint256 duration) external pure returns (uint256) {
        return (principal * aprBps * duration) / (365 days * 10_000);
    }
}
