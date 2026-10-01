// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DividendIndex} from "./DividendIndex.sol";
import {ExdivToken, DividendToken, IDividendHook} from "./ExdivTokens.sol";
import {DateLabel} from "./libraries/DateLabel.sol";

/// @title ExdivVault
/// @notice Strips the dividends off one Robinhood stock token until a maturity date.
///
/// Deposit stock tokens and receive one principal token (P) and one dividend token (D) per share unit, where
/// units are counted at the token's dividend index (see DividendIndex). Robinhood reinvests each dividend by
/// raising the multiplier, so after a dividend fewer raw tokens make up one unit. The vault keeps exactly one
/// unit's worth of raw tokens behind every P and hands the surplus to whoever held D when it was paid.
///
///   - P is the stock without its dividends. At maturity one P redeems for one unit's worth of tokens.
///   - D is every dividend paid until maturity, claimable as stock tokens at any time.
///   - Before maturity one P and one D together always redeem for one unit's worth of tokens.
///
/// The vault has no price oracle, no admin and no liquidations. Its only input is the multiplier, read through
/// the dividend index. All rounding favours the vault.
contract ExdivVault is IDividendHook, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant WAD = 1e18;

    IERC20 public immutable asset;
    DividendIndex public immutable dividendIndex;
    uint256 public immutable maturity;
    ExdivToken public immutable principal;
    DividendToken public immutable dividend;

    /// @notice The dividend index at maturity, fixed on the first interaction after it. Zero until then.
    uint256 public settledIndex;
    /// @notice Raw stock tokens owed to D holders and not yet claimed.
    uint256 public totalOwed;
    mapping(address holder => uint256) public owed;
    /// @notice The index each holder's dividends were last settled at.
    mapping(address holder => uint256) public userIndex;
    /// @notice Addresses allowed to claim a holder's dividends (e.g. the router, to pay them out in USDG).
    mapping(address holder => mapping(address operator => bool)) public isOperator;

    event Minted(
        address indexed caller, address indexed principalTo, address indexed dividendTo, uint256 assets, uint256 units
    );
    event Redeemed(address indexed caller, address indexed receiver, uint256 units, uint256 assets);
    event DividendsClaimed(address indexed holder, address indexed receiver, uint256 assets);
    event Settled(uint256 index);
    event OperatorSet(address indexed holder, address indexed operator, bool approved);

    error Matured();
    error IndexFrozen();
    error ZeroAmount();
    error NotAuthorized();
    error OnlyDividendToken();

    constructor(IERC20 asset_, DividendIndex dividendIndex_, uint256 maturity_) {
        asset = asset_;
        dividendIndex = dividendIndex_;
        maturity = maturity_;
        string memory symbol = IERC20Metadata(address(asset_)).symbol();
        string memory date = DateLabel.format(maturity_);
        principal =
            new ExdivToken(string.concat("Exdiv ", symbol, " Principal ", date), string.concat(symbol, "-P-", date));
        dividend =
            new DividendToken(string.concat("Exdiv ", symbol, " Dividends ", date), string.concat(symbol, "-D-", date));
    }

    // ------------------------------------------------------------------ actions

    /// @notice Deposits `assets` stock tokens; mints the same number of P and D units to the two receivers.
    function mint(uint256 assets, address principalTo, address dividendTo)
        external
        nonReentrant
        returns (uint256 units)
    {
        if (block.timestamp >= maturity) revert Matured();
        uint256 index = _reliableIndex();
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), assets);
        uint256 received = asset.balanceOf(address(this)) - balanceBefore;

        units = Math.mulDiv(received, index, WAD);
        if (units == 0) revert ZeroAmount();
        principal.mint(principalTo, units);
        dividend.mint(dividendTo, units);
        emit Minted(msg.sender, principalTo, dividendTo, received, units);
    }

    /// @notice Burns `units` and sends their stock tokens to `receiver`. Before maturity this takes both P and
    /// D from the caller (dividends already earned stay claimable); after maturity P alone.
    function redeem(uint256 units, address receiver) external nonReentrant returns (uint256 assets) {
        if (units == 0) revert ZeroAmount();
        uint256 index = _reliableIndex();
        principal.burn(msg.sender, units);
        if (block.timestamp < maturity) dividend.burn(msg.sender, units);

        assets = Math.mulDiv(units, WAD, index);
        if (assets == 0) revert ZeroAmount();
        asset.safeTransfer(receiver, assets);
        emit Redeemed(msg.sender, receiver, units, assets);
    }

    /// @notice Pays `holder`'s accrued dividends, in stock tokens, to `receiver`.
    /// Works while the index is frozen: a stale index can only under-count, and the rest accrues later.
    function claimDividends(address holder, address receiver) external nonReentrant returns (uint256 assets) {
        if (msg.sender != holder && !isOperator[holder][msg.sender]) revert NotAuthorized();
        (uint256 index,) = _index();
        _accrue(holder, index);
        assets = owed[holder];
        if (assets == 0) return 0;
        owed[holder] = 0;
        totalOwed -= assets;
        asset.safeTransfer(receiver, assets);
        emit DividendsClaimed(holder, receiver, assets);
    }

    function setOperator(address operator, bool approved) external {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
    }

    /// @notice Picks up new dividends and, after maturity, fixes the settled index. Anyone can call it.
    function sync() external returns (uint256 index, bool reliable) {
        return _index();
    }

    /// @inheritdoc IDividendHook
    function beforeDividendTransfer(address from, address to) external {
        if (msg.sender != address(dividend)) revert OnlyDividendToken();
        (uint256 index,) = _index();
        if (from != address(0)) _accrue(from, index);
        if (to != address(0) && to != from) _accrue(to, index);
    }

    // ------------------------------------------------------------------ views

    /// @notice The index the next interaction will use, and whether mint and redeem would accept it.
    /// After maturity and before settlement this reads recorded history; call `sync` to include a step
    /// that nobody has synced yet.
    function previewIndex() public view returns (uint256 index, bool reliable) {
        if (settledIndex != 0) return (settledIndex, true);
        (uint256 latest, bool frozen) = dividendIndex.previewIndex(address(asset));
        if (block.timestamp < maturity) return (latest, !frozen);
        return (dividendIndex.indexAt(address(asset), maturity), !frozen);
    }

    function previewMint(uint256 assets) external view returns (uint256) {
        (uint256 index,) = previewIndex();
        return Math.mulDiv(assets, index, WAD);
    }

    function previewRedeem(uint256 units) external view returns (uint256) {
        (uint256 index,) = previewIndex();
        return Math.mulDiv(units, WAD, index);
    }

    /// @notice Dividends `holder` could claim now, in stock tokens.
    function claimable(address holder) external view returns (uint256) {
        (uint256 index,) = previewIndex();
        return owed[holder] + _pending(holder, index);
    }

    /// @notice Stock tokens that must stay in the vault for outstanding P, rounded up.
    function principalBacking() external view returns (uint256) {
        (uint256 index,) = previewIndex();
        return Math.mulDiv(principal.totalSupply(), WAD, index, Math.Rounding.Ceil);
    }

    // ------------------------------------------------------------------ internals

    /// @dev Before maturity: the live dividend index. After: the index at maturity, fixed once the dividend index
    /// isn't frozen (a frozen step may still turn out to belong before maturity). `reliable` is false while
    /// frozen, since the true index may be higher.
    function _index() internal returns (uint256 index, bool reliable) {
        uint256 settled = settledIndex;
        if (settled != 0) return (settled, true);
        address token = address(asset);
        uint256 latest = dividendIndex.sync(token);
        bool frozen = dividendIndex.isFrozen(token);
        if (block.timestamp < maturity) return (latest, !frozen);

        index = dividendIndex.indexAt(token, maturity);
        if (frozen) return (index, false);
        settledIndex = index;
        emit Settled(index);
        return (index, true);
    }

    function _reliableIndex() internal returns (uint256 index) {
        bool reliable;
        (index, reliable) = _index();
        if (!reliable) revert IndexFrozen();
    }

    function _accrue(address holder, uint256 index) internal {
        uint256 last = userIndex[holder];
        if (index <= last) return;
        uint256 amount = _pending(holder, index);
        userIndex[holder] = index;
        if (amount != 0) {
            owed[holder] += amount;
            totalOwed += amount;
        }
    }

    /// @dev Units held since index `last` were backed by `units / last` raw tokens and now need `units / index`.
    /// The difference is the dividend, in raw tokens, rounded down.
    function _pending(address holder, uint256 index) internal view returns (uint256) {
        uint256 last = userIndex[holder];
        if (last == 0 || index <= last) return 0;
        uint256 units = dividend.balanceOf(holder);
        if (units == 0) return 0;
        return Math.mulDiv(units, (index - last) * WAD, last * index);
    }
}
