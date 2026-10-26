// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LoanEscrow.sol";

/**
 * @title LenderLiquidityPool
 * @author CredLoom
 *
 * @notice Lenders lock ETH in an offer and publish the rules under which it
 *         may be lent: duration, minimum borrower credit score and an APR band.
 *         The protocol (credit oracle) attests the borrower's AI credit score
 *         and APR when accepting, and the contract itself enforces the lender's
 *         rules, so the oracle cannot lend outside what the lender allowed.
 */
contract LenderLiquidityPool {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    struct Offer {
        address lender;
        uint256 amount;
        uint256 duration;
        uint16 minCreditScore;
        uint16 minAprBps;
        uint16 maxAprBps;
        uint64 createdAt;
        bool active;
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable owner;
    address public protocol;
    address public loanEscrow;

    uint256 public offerCounter;
    mapping(uint256 => Offer) public offers;

    uint16 public constant ABSOLUTE_MAX_APR_BPS = 3000; // 30%
    uint16 public constant MAX_SCORE = 1000;

    uint256 private _lock = 1;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event OfferCreated(
        uint256 indexed offerId,
        address indexed lender,
        uint256 amount,
        uint256 duration,
        uint16 minCreditScore,
        uint16 minAprBps,
        uint16 maxAprBps
    );
    event OfferWithdrawn(uint256 indexed offerId, address indexed lender, uint256 amount);
    event OfferAccepted(
        uint256 indexed offerId,
        uint256 indexed loanId,
        address indexed borrower,
        uint16 aprBps,
        uint16 creditScore
    );

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotAuthorized();
    error AlreadySet();
    error ZeroAddress();
    error NotLender();
    error OfferInactive();
    error InvalidParams();
    error CreditScoreTooLow();
    error AprOutOfRange();
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

    modifier onlyProtocol() {
        if (msg.sender != protocol) revert NotAuthorized();
        _;
    }

    function setProtocol(address _protocol) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (protocol != address(0)) revert AlreadySet();
        if (_protocol == address(0)) revert ZeroAddress();
        protocol = _protocol;
    }

    function setLoanEscrow(address _loanEscrow) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (loanEscrow != address(0)) revert AlreadySet();
        if (_loanEscrow == address(0)) revert ZeroAddress();
        loanEscrow = _loanEscrow;
    }

    /*//////////////////////////////////////////////////////////////
                              LENDER ACTIONS
    //////////////////////////////////////////////////////////////*/

    function createOffer(uint256 duration, uint16 minCreditScore, uint16 minAprBps, uint16 maxAprBps)
        external
        payable
        returns (uint256 offerId)
    {
        if (msg.value == 0 || duration == 0) revert InvalidParams();
        if (minCreditScore > MAX_SCORE) revert InvalidParams();
        if (minAprBps > maxAprBps || maxAprBps > ABSOLUTE_MAX_APR_BPS) revert InvalidParams();

        offerId = ++offerCounter;
        offers[offerId] = Offer({
            lender: msg.sender,
            amount: msg.value,
            duration: duration,
            minCreditScore: minCreditScore,
            minAprBps: minAprBps,
            maxAprBps: maxAprBps,
            createdAt: uint64(block.timestamp),
            active: true
        });
        emit OfferCreated(offerId, msg.sender, msg.value, duration, minCreditScore, minAprBps, maxAprBps);
    }

    function withdrawOffer(uint256 offerId) external nonReentrant {
        Offer storage o = offers[offerId];
        if (o.lender != msg.sender) revert NotLender();
        if (!o.active) revert OfferInactive();

        o.active = false;
        uint256 amount = o.amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit OfferWithdrawn(offerId, msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            PROTOCOL ACTION
    //////////////////////////////////////////////////////////////*/

    /// @notice Match a borrower with an offer. The lender's rules are enforced
    ///         here, on-chain, against the oracle-attested score and APR.
    function acceptOffer(
        uint256 offerId,
        address borrower,
        uint16 aprBps,
        uint16 creditScore,
        bool isInsured,
        address insurer
    ) external onlyProtocol nonReentrant returns (uint256 loanId) {
        Offer storage o = offers[offerId];
        if (!o.active) revert OfferInactive();
        if (creditScore < o.minCreditScore) revert CreditScoreTooLow();
        if (aprBps < o.minAprBps || aprBps > o.maxAprBps) revert AprOutOfRange();

        o.active = false;

        loanId = LoanEscrow(loanEscrow).createFromOffer{value: o.amount}(
            borrower, o.lender, o.amount, aprBps, creditScore, o.duration, isInsured, insurer
        );

        emit OfferAccepted(offerId, loanId, borrower, aprBps, creditScore);
    }
}
