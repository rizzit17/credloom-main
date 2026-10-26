// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReputationRegistry
 * @author CredLoom
 *
 * @notice Permanent on-chain credit history. Reputation replaces collateral:
 *         every loan, repayment and default is recorded against the borrower's
 *         address and can be read by anyone.
 *
 * @dev Only the LoanEscrow contract may write. Wiring is done once by the
 *      deployer (owner) after all contracts exist.
 */
contract ReputationRegistry {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    struct Record {
        uint32 loansTaken;
        uint32 loansRepaid;
        uint32 loansDefaulted;
        uint256 totalBorrowed;
        uint256 totalRepaid;
        uint64 firstLoanAt;
        uint64 lastActivityAt;
        bool flagged;
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable owner;
    address public loanEscrowContract;
    mapping(address => Record) private records;

    // Reputation point model (kept on-chain so it is auditable)
    uint256 public constant BASE_POINTS = 500;
    uint256 public constant POINTS_PER_REPAYMENT = 40;
    uint256 public constant PENALTY_PER_DEFAULT = 250;
    uint256 public constant MAX_POINTS = 1000;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event LoanRecorded(address indexed borrower, uint256 amount);
    event RepaymentRecorded(address indexed borrower, uint256 amount, bool loanCompleted);
    event BorrowerFlagged(address indexed borrower, uint32 totalDefaults);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotAuthorized();
    error AlreadySet();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyEscrow() {
        if (msg.sender != loanEscrowContract) revert NotAuthorized();
        _;
    }

    /// @notice One-shot wiring, callable only by the deployer.
    function setLoanEscrowContract(address _escrow) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (loanEscrowContract != address(0)) revert AlreadySet();
        if (_escrow == address(0)) revert ZeroAddress();
        loanEscrowContract = _escrow;
    }

    /*//////////////////////////////////////////////////////////////
                            WRITE (ESCROW ONLY)
    //////////////////////////////////////////////////////////////*/

    function recordLoan(address borrower, uint256 amount) external onlyEscrow {
        Record storage r = records[borrower];
        if (r.loansTaken == 0) r.firstLoanAt = uint64(block.timestamp);
        r.loansTaken += 1;
        r.totalBorrowed += amount;
        r.lastActivityAt = uint64(block.timestamp);
        emit LoanRecorded(borrower, amount);
    }

    function recordRepayment(address borrower, uint256 amount, bool loanCompleted) external onlyEscrow {
        Record storage r = records[borrower];
        r.totalRepaid += amount;
        if (loanCompleted) r.loansRepaid += 1;
        r.lastActivityAt = uint64(block.timestamp);
        emit RepaymentRecorded(borrower, amount, loanCompleted);
    }

    /// @notice Idempotent: flagging an already flagged borrower never reverts,
    ///         so a second default on another loan can always be settled.
    function flagBorrower(address borrower) external onlyEscrow {
        Record storage r = records[borrower];
        r.loansDefaulted += 1;
        r.flagged = true;
        r.lastActivityAt = uint64(block.timestamp);
        emit BorrowerFlagged(borrower, r.loansDefaulted);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    function isBorrowerFlagged(address borrower) external view returns (bool) {
        return records[borrower].flagged;
    }

    function isBorrowerClean(address borrower) external view returns (bool) {
        return !records[borrower].flagged;
    }

    function getRecord(address borrower) external view returns (Record memory) {
        return records[borrower];
    }

    /// @notice Transparent reputation points (0-1000) derived from history.
    function reputationPoints(address borrower) public view returns (uint256) {
        Record memory r = records[borrower];
        uint256 gain = BASE_POINTS + uint256(r.loansRepaid) * POINTS_PER_REPAYMENT;
        uint256 loss = uint256(r.loansDefaulted) * PENALTY_PER_DEFAULT;
        if (loss >= gain) return 0;
        uint256 pts = gain - loss;
        return pts > MAX_POINTS ? MAX_POINTS : pts;
    }
}
