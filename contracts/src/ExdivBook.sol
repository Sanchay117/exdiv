// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ExdivBook
/// @notice A minimal escrowed limit order book that quotes every market in one token (USDG): stock tokens,
/// principal tokens and dividend tokens. Makers escrow what they offer; takers fill listed orders in the order
/// they pass, with a slippage bound. There is no matching engine and no fee, so nothing can be front-run into a
/// worse price than the taker's own limit.
///
/// Prices are quote units per 1e18 base units (USDG has 6 decimals, so $1.00 per token is 1e6).
/// Fee-on-transfer and rebasing tokens are not supported; Robinhood stock tokens and Exdiv tokens are neither.
contract ExdivBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant PRICE_SCALE = 1e18;

    IERC20 public immutable quote;

    struct Order {
        address maker;
        bool isBid;
        address base;
        uint128 price;
        uint128 remaining;
        /// @dev Bids only: quote still escrowed. Fills pay out rounded down, so this always covers the rest.
        uint256 quoteLocked;
    }

    mapping(uint256 id => Order) internal _orders;
    uint256 public nextOrderId = 1;

    event OrderPlaced(
        uint256 indexed id, address indexed maker, address indexed base, bool isBid, uint256 price, uint256 amount
    );
    event OrderFilled(uint256 indexed id, address indexed taker, uint256 baseAmount, uint256 quoteAmount);
    event OrderClosed(uint256 indexed id, uint256 baseRefund, uint256 quoteRefund);

    error ZeroAmount();
    error InvalidBase();
    error NotMaker();
    error Slippage(uint256 actual, uint256 limit);
    error InexactTransfer();

    constructor(IERC20 quote_) {
        quote = quote_;
    }

    // ------------------------------------------------------------------ makers

    /// @notice Escrows `amount` of `base` (ask) or its cost in quote (bid) and lists it at `price`.
    function placeOrder(address base, bool isBid, uint128 price, uint128 amount)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (price == 0 || amount == 0) revert ZeroAmount();
        if (base == address(quote) || base == address(0)) revert InvalidBase();

        uint256 locked;
        if (isBid) {
            locked = Math.mulDiv(amount, price, PRICE_SCALE, Math.Rounding.Ceil);
            _pullExact(quote, locked);
        } else {
            _pullExact(IERC20(base), amount);
        }
        id = nextOrderId++;
        _orders[id] = Order(msg.sender, isBid, base, price, amount, locked);
        emit OrderPlaced(id, msg.sender, base, isBid, price, amount);
    }

    /// @notice Closes the caller's order and refunds whatever is still escrowed.
    function cancelOrder(uint256 id) external nonReentrant {
        Order memory o = _orders[id];
        if (o.maker != msg.sender) revert NotMaker();
        delete _orders[id];
        _refund(id, o);
    }

    // ------------------------------------------------------------------ takers

    /// @notice Sells up to `amount` of `base` into `bidIds`, in the given order, and sends the quote to
    /// `recipient`. Orders that are filled, cancelled, asks or for another token are skipped.
    function sell(address base, uint256 amount, uint256[] calldata bidIds, uint256 minQuoteOut, address recipient)
        external
        nonReentrant
        returns (uint256 sold, uint256 quoteOut)
    {
        for (uint256 i; i < bidIds.length && sold < amount; ++i) {
            (uint256 take, uint256 proceeds) = _fillBid(bidIds[i], base, amount - sold);
            sold += take;
            quoteOut += proceeds;
        }
        if (quoteOut < minQuoteOut) revert Slippage(quoteOut, minQuoteOut);
        if (quoteOut != 0) quote.safeTransfer(recipient, quoteOut);
    }

    /// @notice Buys up to `amount` of `base` from `askIds`, in the given order, paying at most `maxQuoteIn`.
    function buy(address base, uint256 amount, uint256[] calldata askIds, uint256 maxQuoteIn, address recipient)
        external
        nonReentrant
        returns (uint256 bought, uint256 quoteIn)
    {
        for (uint256 i; i < askIds.length && bought < amount; ++i) {
            (uint256 take, uint256 cost) = _fillAsk(askIds[i], base, amount - bought);
            bought += take;
            quoteIn += cost;
        }
        if (quoteIn > maxQuoteIn) revert Slippage(quoteIn, maxQuoteIn);
        if (bought != 0) IERC20(base).safeTransfer(recipient, bought);
    }

    // ------------------------------------------------------------------ views

    function getOrder(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function getOrders(uint256[] calldata ids) external view returns (Order[] memory out) {
        out = new Order[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            out[i] = _orders[ids[i]];
        }
    }

    // ------------------------------------------------------------------ internals

    /// @dev Fills up to `want` of bid `id` if it is a live bid for `base`: the taker's base goes straight to the
    /// maker and the proceeds stay here until the whole sell is done.
    function _fillBid(uint256 id, address base, uint256 want) internal returns (uint256 take, uint256 proceeds) {
        Order storage o = _orders[id];
        if (o.maker == address(0) || !o.isBid || o.base != base) return (0, 0);
        take = Math.min(want, o.remaining);
        proceeds = Math.mulDiv(take, o.price, PRICE_SCALE);
        address maker = o.maker;
        o.remaining -= uint128(take);
        o.quoteLocked -= proceeds;
        emit OrderFilled(id, msg.sender, take, proceeds);
        if (o.remaining == 0) {
            Order memory done = o;
            delete _orders[id];
            _refund(id, done);
        }
        IERC20(base).safeTransferFrom(msg.sender, maker, take);
    }

    /// @dev Fills up to `want` of ask `id` if it is a live ask for `base`; the taker pays the maker directly.
    function _fillAsk(uint256 id, address base, uint256 want) internal returns (uint256 take, uint256 cost) {
        Order storage o = _orders[id];
        if (o.maker == address(0) || o.isBid || o.base != base) return (0, 0);
        take = Math.min(want, o.remaining);
        cost = Math.mulDiv(take, o.price, PRICE_SCALE, Math.Rounding.Ceil);
        address maker = o.maker;
        o.remaining -= uint128(take);
        emit OrderFilled(id, msg.sender, take, cost);
        if (o.remaining == 0) {
            delete _orders[id];
            emit OrderClosed(id, 0, 0);
        }
        quote.safeTransferFrom(msg.sender, maker, cost);
    }

    function _refund(uint256 id, Order memory o) internal {
        uint256 baseRefund = o.isBid ? 0 : o.remaining;
        uint256 quoteRefund = o.isBid ? o.quoteLocked : 0;
        emit OrderClosed(id, baseRefund, quoteRefund);
        if (baseRefund != 0) IERC20(o.base).safeTransfer(o.maker, baseRefund);
        if (quoteRefund != 0) quote.safeTransfer(o.maker, quoteRefund);
    }

    function _pullExact(IERC20 token, uint256 amount) internal {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert InexactTransfer();
    }
}
