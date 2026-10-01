// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseTest} from "./Base.t.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

contract DividendIndexTest is BaseTest {
    function _sync() internal returns (uint256) {
        return index.sync(address(spy));
    }

    function test_register_startsAtMultiplier() public view {
        assertEq(index.latestIndex(address(spy)), SPY_MULTIPLIER);
        assertEq(index.recordedMultiplier(address(spy)), SPY_MULTIPLIER);
        assertEq(index.indexAt(address(spy), block.timestamp), SPY_MULTIPLIER);
        assertEq(index.indexAt(address(spy), block.timestamp - 1), 0);
        assertTrue(index.isRegistered(address(spy)));
    }

    function test_register_onlyOwnerAndOnce() public {
        MockStockToken other = new MockStockToken("X", "X", owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        index.register(address(other));

        vm.expectRevert(abi.encodeWithSelector(DividendIndex.AlreadyRegistered.selector, address(spy)));
        vm.prank(owner);
        index.register(address(spy));
    }

    function test_sync_unregisteredReverts() public {
        vm.expectRevert(abi.encodeWithSelector(DividendIndex.NotRegistered.selector, address(usdg)));
        index.sync(address(usdg));
    }

    function test_dividend_raisesIndexProportionally() public {
        uint256 before = _sync();
        _payDividend(29); // SPY's Oct 30 dividend is ~0.29% of the price, before withholding
        uint256 afterIdx = _sync();
        assertEq(afterIdx, before * spy.uiMultiplier() / SPY_MULTIPLIER);
        assertGt(afterIdx, before);
        assertFalse(index.isFrozen(address(spy)));
    }

    function test_dividend_upToFivePercentIsAutomatic() public {
        _setMultiplier(SPY_MULTIPLIER * 105 / 100);
        _sync();
        assertFalse(index.isFrozen(address(spy)));
        assertApproxEqAbs(index.latestIndex(address(spy)), SPY_MULTIPLIER * 105 / 100, 1);
    }

    function test_unexplainedRise_freezes() public {
        _setMultiplier(SPY_MULTIPLIER * 106 / 100); // 6%: too big for a dividend, not a split
        vm.expectEmit(address(index));
        emit DividendIndex.TokenFrozen(address(spy), SPY_MULTIPLIER, SPY_MULTIPLIER * 106 / 100);
        uint256 idx = _sync();
        assertEq(idx, SPY_MULTIPLIER);
        assertTrue(index.isFrozen(address(spy)));

        // Frozen tokens keep returning the last index, even if the multiplier moves again.
        _payDividend(10);
        assertEq(_sync(), SPY_MULTIPLIER);
    }

    function test_decrease_freezes() public {
        _setMultiplier(SPY_MULTIPLIER - 1e15);
        _sync();
        assertTrue(index.isFrozen(address(spy)));
    }

    function test_exactForwardSplit_leavesIndex() public {
        _setMultiplier(SPY_MULTIPLIER * 4); // CRWD-style 4:1
        vm.expectEmit(address(index));
        emit DividendIndex.StepRecorded(
            address(spy), SPY_MULTIPLIER, SPY_MULTIPLIER * 4, 4, 1, SPY_MULTIPLIER, uint48(block.timestamp)
        );
        assertEq(_sync(), SPY_MULTIPLIER);
        assertEq(index.recordedMultiplier(address(spy)), SPY_MULTIPLIER * 4);
        assertEq(index.checkpointCount(address(spy)), 1);
    }

    function test_exactReverseSplit_leavesIndex() public {
        _setMultiplier(SPY_MULTIPLIER / 10);
        assertEq(_sync(), SPY_MULTIPLIER);
        assertFalse(index.isFrozen(address(spy)));
        // A dividend after the reverse split still moves the index by its own size.
        _payDividend(100);
        assertApproxEqRel(_sync(), SPY_MULTIPLIER * 101 / 100, 1e9);
    }

    function test_threeForTwoSplit() public {
        _setMultiplier(SPY_MULTIPLIER * 3 / 2);
        assertEq(_sync(), SPY_MULTIPLIER);
        assertFalse(index.isFrozen(address(spy)));
    }

    function test_unannouncedSplitWithDividend_freezesThenResolves() public {
        uint256 m = SPY_MULTIPLIER * 4 * 1003 / 1000; // 4:1 split and a 0.3% dividend in one step
        _setMultiplier(m);
        _sync();
        assertTrue(index.isFrozen(address(spy)));

        vm.prank(owner);
        index.resolve(address(spy), 4, 1);
        assertFalse(index.isFrozen(address(spy)));
        assertApproxEqRel(index.latestIndex(address(spy)), SPY_MULTIPLIER * 1003 / 1000, 1e9);
    }

    function test_attestedSplit_keepsDividendInSameStep() public {
        vm.prank(attester);
        index.attestSplit(address(spy), 4, 1);
        _setMultiplier(SPY_MULTIPLIER * 4 * 1003 / 1000);
        uint256 idx = _sync();
        assertFalse(index.isFrozen(address(spy)));
        assertApproxEqRel(idx, SPY_MULTIPLIER * 1003 / 1000, 1e9);
        (uint64 num,) = index.pendingSplit(address(spy));
        assertEq(num, 0, "attestation consumed");
    }

    function test_attestation_waitsForMatchingStep() public {
        vm.prank(attester);
        index.attestSplit(address(spy), 2, 1);
        _payDividend(20); // a dividend arrives before the split
        _sync();
        (uint64 num,) = index.pendingSplit(address(spy));
        assertEq(num, 2, "still pending");
        _setMultiplier(spy.uiMultiplier() * 2);
        _sync();
        (num,) = index.pendingSplit(address(spy));
        assertEq(num, 0);
        assertFalse(index.isFrozen(address(spy)));
    }

    function test_attestedStockDividend_isNotPaidToDividendHolders() public {
        // A 5% stock dividend looks like a 5% cash dividend; once announced it's treated as a 21:20 split.
        vm.prank(attester);
        index.attestSplit(address(spy), 21, 20);
        _setMultiplier(SPY_MULTIPLIER * 21 / 20);
        assertApproxEqAbs(_sync(), SPY_MULTIPLIER, 1);
    }

    function test_attestSplit_auth() public {
        vm.expectRevert(DividendIndex.Unauthorized.selector);
        vm.prank(alice);
        index.attestSplit(address(spy), 2, 1);

        vm.startPrank(attester);
        vm.expectRevert(DividendIndex.InvalidRatio.selector);
        index.attestSplit(address(spy), 2, 0);
        vm.expectRevert(DividendIndex.InvalidRatio.selector);
        index.attestSplit(address(spy), 3, 3);
        index.attestSplit(address(spy), 0, 0); // cancel is fine
        vm.stopPrank();
    }

    function test_resolve_boundsOwner() public {
        vm.expectRevert(abi.encodeWithSelector(DividendIndex.NotFrozen.selector, address(spy)));
        vm.prank(owner);
        index.resolve(address(spy), 1, 1);

        _setMultiplier(SPY_MULTIPLIER * 130 / 100); // +30%
        _sync();
        // The owner can't call a 30% jump a dividend...
        vm.expectRevert(
            abi.encodeWithSelector(
                DividendIndex.RatioDoesNotExplainStep.selector, SPY_MULTIPLIER, SPY_MULTIPLIER * 130 / 100
            )
        );
        vm.prank(owner);
        index.resolve(address(spy), 1, 1);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attester));
        vm.prank(attester);
        index.resolve(address(spy), 13, 10);

        // ...only pick a split ratio that leaves at most 20% as dividends.
        vm.prank(owner);
        index.resolve(address(spy), 13, 10);
        assertApproxEqAbs(index.latestIndex(address(spy)), SPY_MULTIPLIER, 1);
    }

    function test_missedSyncs_freezeThenResolveAsDividends() public {
        // Two large dividends land with no sync in between (keeper down, no user activity): 4% then 3%.
        _payDividend(400);
        _payDividend(300);
        _sync();
        assertTrue(index.isFrozen(address(spy)), "7% in one observed step is too big to assume");
        vm.prank(owner);
        index.resolve(address(spy), 1, 1);
        assertApproxEqRel(index.latestIndex(address(spy)), SPY_MULTIPLIER * 104 * 103 / 10_000, 1e9);
    }

    function test_resolve_afterMultiplierRevertsToPrevious() public {
        _setMultiplier(SPY_MULTIPLIER * 2 / 3);
        _sync();
        assertTrue(index.isFrozen(address(spy)));
        _setMultiplier(SPY_MULTIPLIER); // issuer corrects the mistake
        vm.prank(owner);
        index.resolve(address(spy), 1, 1);
        assertFalse(index.isFrozen(address(spy)));
        assertEq(index.latestIndex(address(spy)), SPY_MULTIPLIER);
    }

    function test_scheduledDividend_recordsEffectiveTime() public {
        uint256 at = block.timestamp + 3 days;
        vm.prank(owner);
        spy.updateMultiplier(SPY_MULTIPLIER * 1002 / 1000, at);

        vm.warp(at - 1);
        assertEq(_sync(), SPY_MULTIPLIER, "not yet effective");

        vm.warp(at + 10 days); // nobody syncs for a while
        uint256 idx = _sync();
        assertGt(idx, SPY_MULTIPLIER);
        (uint48 time,) = index.checkpointAt(address(spy), 1);
        assertEq(time, at, "recorded when it took effect, not when synced");
        assertEq(index.indexAt(address(spy), at - 1), SPY_MULTIPLIER);
        assertEq(index.indexAt(address(spy), at), idx);
    }

    function test_previewIndex_matchesSync() public {
        _payDividend(37);
        (uint256 preview, bool frozen) = index.previewIndex(address(spy));
        assertFalse(frozen);
        assertEq(preview, _sync());

        _setMultiplier(spy.uiMultiplier() * 107 / 100);
        (preview, frozen) = index.previewIndex(address(spy));
        assertTrue(frozen);
        assertEq(preview, _sync());
    }

    /// @dev Any run of dividends (each at most 5%) with exact splits in between: the index equals the multiplier
    /// with the splits divided out, and never falls.
    function testFuzz_indexTracksDividendsNotSplits(uint256 seed) public {
        uint256 splitNum = 1;
        uint256 splitDen = 1;
        uint256 last = _sync();
        for (uint256 i; i < 12; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 m = spy.uiMultiplier();
            if (seed % 5 == 0) {
                (uint256 n, uint256 dn) = seed % 2 == 0 ? (uint256(2), uint256(1)) : (uint256(1), uint256(2));
                _setMultiplier(m * n / dn);
                splitNum *= n;
                splitDen *= dn;
            } else {
                _setMultiplier(m + m * (seed % 500) / 10_000); // 0 to 5%
            }
            uint256 idx = _sync();
            assertFalse(index.isFrozen(address(spy)));
            assertGe(idx, last, "monotonic");
            last = idx;
        }
        uint256 expected = spy.uiMultiplier() * splitDen / splitNum;
        assertApproxEqRel(last, expected, 1e9);
    }
}
