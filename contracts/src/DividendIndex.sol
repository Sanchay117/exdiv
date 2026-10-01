// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IScaledUIAmount, IScaledUIAmountNewUIMultiplier} from "./interfaces/IERC8056.sol";

/// @title DividendIndex
/// @notice Splits a stock token's ERC-8056 multiplier into its two causes and tracks the dividend part.
///
/// Robinhood stock tokens reinvest cash dividends by raising `uiMultiplier` (SPY went 1.0 to 1.0017) and
/// apply splits by multiplying it (CRWD went 1.0 to 4.0). Onchain the two look alike. For every registered
/// token this contract keeps a dividend index: share units per raw token, raised by dividends and left
/// alone by splits. It starts at the token's multiplier, so one unit is one share at registration.
///
/// Each multiplier change is classified when it is first observed:
///   1. a split the attester announced in advance (a dividend paid in the same step is kept),
///   2. otherwise, a rise of at most `MAX_DIVIDEND_STEP` is a reinvested cash dividend,
///   3. otherwise, an exact known split ratio (2:1, 3:2, 1:10, ...) is a split,
///   4. anything else freezes the token at its last index until the owner classifies the step.
/// The index never decreases. When resolving a freeze the owner chooses a split ratio, never an index, and
/// whatever it picks has to leave an implied dividend of at most `MAX_RESOLVED_STEP`. That is looser than rule 2
/// so that several dividends missed between syncs can still be paid to dividend holders in full.
contract DividendIndex is Ownable2Step {
    using Checkpoints for Checkpoints.Trace208;
    using SafeCast for uint256;

    uint256 internal constant WAD = 1e18;

    /// @notice Largest single multiplier rise accepted as a reinvested cash dividend (5%).
    /// Quarterly dividends on Robinhood Chain move it by 0.01% to 0.5%.
    uint256 public constant MAX_DIVIDEND_STEP = 0.05e18;

    /// @notice Largest dividend part the owner can assign when resolving a frozen step (20%).
    uint256 public constant MAX_RESOLVED_STEP = 0.2e18;

    /// @notice Rounding slack when matching a step to a split ratio (one part in a billion).
    uint256 public constant TOLERANCE = 1e9;

    /// @notice A split as `num` new shares for every `den` old ones. {1, 1} means no split.
    struct Ratio {
        uint64 num;
        uint64 den;
    }

    struct TokenState {
        bool registered;
        bool frozen;
        uint256 multiplier;
        Ratio pendingSplit;
        Checkpoints.Trace208 index;
    }

    mapping(address token => TokenState) internal _tokens;

    /// @notice Announces upcoming splits, reverse splits and stock dividends (a keeper reading Robinhood's
    /// corporate-actions feed). It can't move the index: an announcement only applies to a step it explains.
    address public attester;

    event TokenRegistered(address indexed token, uint256 multiplier);
    event AttesterSet(address indexed attester);
    event SplitAttested(address indexed token, uint64 num, uint64 den);
    /// @notice A classified multiplier change. `num`/`den` is the split part ({1, 1} for a pure dividend).
    event StepRecorded(
        address indexed token,
        uint256 oldMultiplier,
        uint256 newMultiplier,
        uint64 num,
        uint64 den,
        uint256 index,
        uint48 effectiveTime
    );
    event TokenFrozen(address indexed token, uint256 multiplier, uint256 observedMultiplier);
    event TokenResolved(address indexed token, uint64 num, uint64 den);

    error NotRegistered(address token);
    error AlreadyRegistered(address token);
    error InvalidMultiplier(address token);
    error InvalidRatio();
    error NotFrozen(address token);
    error RatioDoesNotExplainStep(uint256 oldMultiplier, uint256 newMultiplier);
    error Unauthorized();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ------------------------------------------------------------------ admin

    /// @notice Starts tracking a stock token. Curated: only canonical issuer tokens belong here.
    function register(address token) external onlyOwner {
        TokenState storage st = _tokens[token];
        if (st.registered) revert AlreadyRegistered(token);
        uint256 m = IScaledUIAmount(token).uiMultiplier();
        if (m == 0) revert InvalidMultiplier(token);
        st.registered = true;
        st.multiplier = m;
        st.index.push(block.timestamp.toUint48(), m.toUint208());
        emit TokenRegistered(token, m);
    }

    /// @notice Sets (or, with address(0), removes) the attester.
    // forge-lint: disable-next-line(missing-zero-check)
    function setAttester(address newAttester) external onlyOwner {
        attester = newAttester;
        emit AttesterSet(newAttester);
    }

    /// @notice Announces a split of `num`:`den` (e.g. 4:1, or 1:10 for a reverse split, or 21:20 for a 5%
    /// stock dividend). Pass 0:0 to cancel. It is consumed by the first step it explains.
    function attestSplit(address token, uint64 num, uint64 den) external {
        if (msg.sender != attester && msg.sender != owner()) revert Unauthorized();
        if (!_tokens[token].registered) revert NotRegistered(token);
        if ((num == 0) != (den == 0) || (num != 0 && num == den)) revert InvalidRatio();
        _tokens[token].pendingSplit = Ratio(num, den);
        emit SplitAttested(token, num, den);
    }

    /// @notice Unfreezes a token by classifying the step that froze it as a split of `num`:`den`, with whatever
    /// is left over (0 to 20%) counted as dividends. Pass 1:1 when the whole step was dividends.
    function resolve(address token, uint64 num, uint64 den) external onlyOwner {
        TokenState storage st = _tokens[token];
        if (!st.frozen) revert NotFrozen(token);
        if (num == 0 || den == 0) revert InvalidRatio();
        uint256 prev = st.multiplier;
        uint256 observed = IScaledUIAmount(token).uiMultiplier();
        Ratio memory ratio = Ratio(num, den);
        st.frozen = false;
        if (observed != prev) {
            if (observed == 0 || !_explains(prev, observed, ratio, MAX_RESOLVED_STEP)) {
                revert RatioDoesNotExplainStep(prev, observed);
            }
            delete st.pendingSplit;
            _record(token, st, prev, observed, ratio);
        }
        emit TokenResolved(token, num, den);
    }

    // ------------------------------------------------------------------ sync

    /// @notice Classifies any multiplier change since the last call and returns the dividend index.
    /// Never reverts for a registered token: an unexplained change freezes it at its last index instead.
    function sync(address token) external returns (uint256) {
        TokenState storage st = _tokens[token];
        if (!st.registered) revert NotRegistered(token);
        if (st.frozen) return st.index.latest();

        uint256 prev = st.multiplier;
        uint256 observed = IScaledUIAmount(token).uiMultiplier();
        if (observed == prev) return st.index.latest();

        (bool ok, Ratio memory split, bool attested) = _classify(st, prev, observed);
        if (!ok) {
            st.frozen = true;
            emit TokenFrozen(token, prev, observed);
            return st.index.latest();
        }
        if (attested) delete st.pendingSplit;
        return _record(token, st, prev, observed, split);
    }

    // ------------------------------------------------------------------ views

    /// @notice The index `sync` would return right now, and whether the token is (or would become) frozen.
    function previewIndex(address token) external view returns (uint256 index, bool frozen) {
        TokenState storage st = _tokens[token];
        if (!st.registered) revert NotRegistered(token);
        index = st.index.latest();
        if (st.frozen) return (index, true);
        uint256 prev = st.multiplier;
        uint256 observed = IScaledUIAmount(token).uiMultiplier();
        if (observed == prev) return (index, false);
        (bool ok, Ratio memory split,) = _classify(st, prev, observed);
        if (!ok) return (index, true);
        return (Math.max(index, _nextIndex(index, prev, observed, split)), false);
    }

    /// @notice The last recorded index.
    function latestIndex(address token) external view returns (uint256) {
        return _tokens[token].index.latest();
    }

    /// @notice The index in effect at `timestamp`, by recorded effective time. Zero before registration.
    function indexAt(address token, uint256 timestamp) external view returns (uint256) {
        return _tokens[token].index.upperLookupRecent(timestamp.toUint48());
    }

    function isRegistered(address token) external view returns (bool) {
        return _tokens[token].registered;
    }

    function isFrozen(address token) external view returns (bool) {
        return _tokens[token].frozen;
    }

    /// @notice The last multiplier that was classified.
    function recordedMultiplier(address token) external view returns (uint256) {
        return _tokens[token].multiplier;
    }

    function pendingSplit(address token) external view returns (uint64 num, uint64 den) {
        Ratio memory r = _tokens[token].pendingSplit;
        return (r.num, r.den);
    }

    /// @notice Number of recorded index changes, and the (effective time, index) of entry `i`.
    function checkpointCount(address token) external view returns (uint256) {
        return _tokens[token].index.length();
    }

    function checkpointAt(address token, uint32 i) external view returns (uint48 time, uint208 index) {
        Checkpoints.Checkpoint208 memory c = _tokens[token].index.at(i);
        return (c._key, c._value);
    }

    // ------------------------------------------------------------------ internals

    function _classify(TokenState storage st, uint256 prev, uint256 observed)
        internal
        view
        returns (bool ok, Ratio memory split, bool attested)
    {
        if (observed == 0) return (false, split, false);
        Ratio memory pending = st.pendingSplit;
        if (pending.num != 0 && _explains(prev, observed, pending, MAX_DIVIDEND_STEP)) return (true, pending, true);

        Ratio memory none = Ratio(1, 1);
        if (observed > prev && _explains(prev, observed, none, MAX_DIVIDEND_STEP)) return (true, none, false);

        // Unannounced split: only an exact known ratio, so a split can't hide a dividend or vice versa.
        Ratio[16] memory known = _knownSplits();
        for (uint256 i; i < known.length; ++i) {
            uint256 f = _dividendFactor(prev, observed, known[i]);
            if (f + TOLERANCE >= WAD && f <= WAD + TOLERANCE) return (true, known[i], false);
        }
        return (false, split, false);
    }

    /// @dev True when the step from `prev` to `observed` is the split `r` plus a dividend of at most `maxStep`.
    function _explains(uint256 prev, uint256 observed, Ratio memory r, uint256 maxStep) internal pure returns (bool) {
        uint256 f = _dividendFactor(prev, observed, r);
        return f + TOLERANCE >= WAD && f <= WAD + maxStep;
    }

    /// @dev What is left of the step once the split is taken out, in WAD (1e18 = no dividend).
    function _dividendFactor(uint256 prev, uint256 observed, Ratio memory r) internal pure returns (uint256) {
        return Math.mulDiv(observed, uint256(r.den) * WAD, prev * r.num);
    }

    function _nextIndex(uint256 index, uint256 prev, uint256 observed, Ratio memory r) internal pure returns (uint256) {
        return Math.mulDiv(index, observed * r.den, prev * r.num);
    }

    function _record(address token, TokenState storage st, uint256 prev, uint256 observed, Ratio memory split)
        internal
        returns (uint256 index)
    {
        index = st.index.latest();
        uint48 time = _effectiveTime(token, st);
        uint256 next = _nextIndex(index, prev, observed, split);
        // A pure split leaves the index alone; rounding below it is ignored so the index never falls.
        if (next > index) {
            index = next;
            st.index.push(time, index.toUint208());
        }
        st.multiplier = observed;
        emit StepRecorded(token, prev, observed, split.num, split.den, index, time);
    }

    /// @dev When the change took effect: the token's `effectiveAt` if it is in the past, otherwise now.
    /// Clamped to the last checkpoint so the history stays ordered.
    function _effectiveTime(address token, TokenState storage st) internal view returns (uint48) {
        uint256 time = block.timestamp;
        try IScaledUIAmountNewUIMultiplier(token).effectiveAt() returns (uint256 at) {
            if (at != 0 && at < time) time = at;
        } catch {}
        (, uint48 lastKey,) = st.index.latestCheckpoint();
        return Math.max(time, lastKey).toUint48();
    }

    function _knownSplits() internal pure returns (Ratio[16] memory r) {
        r = [
            Ratio(2, 1),
            Ratio(3, 1),
            Ratio(4, 1),
            Ratio(5, 1),
            Ratio(10, 1),
            Ratio(20, 1),
            Ratio(3, 2),
            Ratio(1, 2),
            Ratio(1, 3),
            Ratio(1, 4),
            Ratio(1, 5),
            Ratio(1, 8),
            Ratio(1, 10),
            Ratio(1, 15),
            Ratio(1, 20),
            Ratio(1, 25)
        ];
    }
}
