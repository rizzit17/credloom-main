// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InsurancePool
 * @author CredLoom
 *
 * @notice Insurers stake ETH and publish underwriting terms (premium rate and
 *         whether they accept new policies). When a loan names an insurer,
 *         LoanEscrow reserves coverage against that insurer's free balance and
 *         pays them a premium. On default the reserved coverage pays the lender.
 *
 * @dev Coverage is reserved per loan, so one deposit can never back more
 *      principal than it holds. Insurers can only withdraw unreserved funds.
 */
contract InsurancePool {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    struct Insurer {
        uint256 balance; // total staked incl. premiums, minus payouts
        uint256 reserved; // locked behind active policies
        uint256 premiumsEarned;
        uint256 totalPaidOut;
        uint32 activePolicies;
        uint32 totalPolicies;
        uint16 premiumBps; // premium charged on principal
        bool accepting; // whether new policies may be written
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable owner;
    address public loanEscrowContract;
    mapping(address => Insurer) private insurers;
    uint256 public totalStaked;
    uint256 public totalReserved;

    uint16 public constant MAX_PREMIUM_BPS = 2000; // 20%

    uint256 private _lock = 1;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event InsurerDeposited(address indexed insurer, uint256 amount, uint256 newBalance);
    event InsurerWithdrew(address indexed insurer, uint256 amount, uint256 newBalance);
    event TermsUpdated(address indexed insurer, uint16 premiumBps, bool accepting);
    event CoverageReserved(address indexed insurer, uint256 indexed loanId, uint256 amount, uint256 premium);
    event CoverageReleased(address indexed insurer, uint256 indexed loanId, uint256 amount);
    event InsurancePayout(address indexed insurer, address indexed lender, uint256 indexed loanId, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotAuthorized();
    error AlreadySet();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientFreeBalance();
    error InsufficientBalance();
    error NotAccepting();
    error PremiumTooHigh();
    error PremiumMismatch();
    error TransferFailed();
    error Reentrancy();

    constructor() {
        owner = msg.sender;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyEscrow() {
        if (msg.sender != loanEscrowContract) revert NotAuthorized();
        _;
    }

    function setLoanEscrowContract(address _escrow) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (loanEscrowContract != address(0)) revert AlreadySet();
        if (_escrow == address(0)) revert ZeroAddress();
        loanEscrowContract = _escrow;
    }

    /*//////////////////////////////////////////////////////////////
                              INSURER ACTIONS
    //////////////////////////////////////////////////////////////*/

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        Insurer storage i = insurers[msg.sender];
        i.balance += msg.value;
        totalStaked += msg.value;
        emit InsurerDeposited(msg.sender, msg.value, i.balance);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Insurer storage i = insurers[msg.sender];
        if (i.balance - i.reserved < amount) revert InsufficientFreeBalance();
        i.balance -= amount;
        totalStaked -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit InsurerWithdrew(msg.sender, amount, i.balance);
    }

    function setTerms(uint16 premiumBps, bool accepting) external {
        if (premiumBps > MAX_PREMIUM_BPS) revert PremiumTooHigh();
        Insurer storage i = insurers[msg.sender];
        i.premiumBps = premiumBps;
        i.accepting = accepting;
        emit TermsUpdated(msg.sender, premiumBps, accepting);
    }

    /*//////////////////////////////////////////////////////////////
                              ESCROW ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Reserve coverage for a new policy. Premium is credited to the
    ///         insurer from the msg.value sent by LoanEscrow.
    function reserveCoverage(address insurer, uint256 loanId, uint256 principal)
        external
        payable
        onlyEscrow
        returns (uint256 premium)
    {
        Insurer storage i = insurers[insurer];
        if (!i.accepting) revert NotAccepting();
        if (i.balance - i.reserved < principal) revert InsufficientFreeBalance();

        premium = (principal * i.premiumBps) / 10_000;
        // Escrow must forward exactly the premium it withheld from the borrower.
        if (msg.value != premium) revert PremiumMismatch();

        i.reserved += principal;
        i.balance += premium;
        i.premiumsEarned += premium;
        i.activePolicies += 1;
        i.totalPolicies += 1;
        totalReserved += principal;
        totalStaked += premium;
        emit CoverageReserved(insurer, loanId, principal, premium);
    }

    /// @notice Quote the premium for a given insurer and principal.
    function quotePremium(address insurer, uint256 principal) external view returns (uint256) {
        return (principal * insurers[insurer].premiumBps) / 10_000;
    }

    function releaseCoverage(address insurer, uint256 loanId, uint256 amount) external onlyEscrow {
        Insurer storage i = insurers[insurer];
        i.reserved -= amount;
        i.activePolicies -= 1;
        totalReserved -= amount;
        emit CoverageReleased(insurer, loanId, amount);
    }

    /// @notice Pay the lender out of reserved coverage after a default.
    /// @param reservedAmount the coverage originally reserved (released in full)
    /// @param payAmount the amount actually owed to the lender (<= reservedAmount)
    function payout(address insurer, address lender, uint256 loanId, uint256 reservedAmount, uint256 payAmount)
        external
        onlyEscrow
        nonReentrant
        returns (uint256 paid)
    {
        Insurer storage i = insurers[insurer];
        paid = payAmount > reservedAmount ? reservedAmount : payAmount;
        if (paid > i.balance) paid = i.balance;

        i.reserved -= reservedAmount;
        i.activePolicies -= 1;
        i.balance -= paid;
        i.totalPaidOut += paid;
        totalReserved -= reservedAmount;
        totalStaked -= paid;

        if (paid > 0) {
            (bool ok, ) = payable(lender).call{value: paid}("");
            if (!ok) revert TransferFailed();
        }
        emit InsurancePayout(insurer, lender, loanId, paid);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    function getInsurer(address insurer) external view returns (Insurer memory) {
        return insurers[insurer];
    }

    function getInsurerBalance(address insurer) external view returns (uint256) {
        return insurers[insurer].balance;
    }

    function freeBalance(address insurer) external view returns (uint256) {
        Insurer storage i = insurers[insurer];
        return i.balance - i.reserved;
    }
}
