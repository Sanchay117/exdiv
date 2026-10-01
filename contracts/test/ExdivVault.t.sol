// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "./Base.t.sol";
import {ExdivVault} from "../src/ExdivVault.sol";
import {ExdivFactory} from "../src/ExdivFactory.sol";
import {ExdivToken} from "../src/ExdivTokens.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {DemoStockToken} from "../src/mocks/DemoStockToken.sol";

contract ExdivVaultTest is BaseTest {
    function test_metadata() public view {
        assertEq(p.symbol(), "SPY-P-21SEP2027");
        assertEq(d.symbol(), "SPY-D-21SEP2027");
        assertEq(p.name(), "Exdiv SPY Principal 21SEP2027");
        assertEq(d.name(), "Exdiv SPY Dividends 21SEP2027");
        assertEq(p.decimals(), 18);
        assertEq(address(vault.asset()), address(spy));
        assertEq(vault.maturity(), maturity);
    }

    function test_mint_unitsAreShares() public {
        uint256 units = _mint(alice, 10e18);
        // 10 raw SPY tokens at multiplier 1.0017 stand for 10.017 shares.
        assertEq(units, 10e18 * SPY_MULTIPLIER / WAD);
        assertEq(p.balanceOf(alice), units);
        assertEq(d.balanceOf(alice), units);
        assertEq(spy.balanceOf(address(vault)), 10e18);
        assertEq(vault.previewMint(10e18), units);
    }

    function test_mint_separateReceivers() public {
        vm.prank(alice);
        uint256 units = vault.mint(5e18, bob, carol);
        assertEq(p.balanceOf(bob), units);
        assertEq(d.balanceOf(carol), units);
        assertEq(p.balanceOf(alice) + d.balanceOf(alice), 0);
    }

    function test_mint_zeroReverts() public {
        vm.expectRevert(ExdivVault.ZeroAmount.selector);
        vm.prank(alice);
        vault.mint(0, alice, alice);
    }

    function test_redeemPair_roundTripsWithoutDividends() public {
        uint256 units = _mint(alice, 10e18);
        vm.prank(alice);
        uint256 assets = vault.redeem(units, alice);
        assertApproxEqAbs(assets, 10e18, 1);
        assertLe(assets, 10e18, "rounding favours the vault");
        assertEq(p.totalSupply(), 0);
        assertEq(d.totalSupply(), 0);
    }

    function test_redeemBeforeMaturity_needsDividendToken() public {
        uint256 units = _mint(alice, 10e18);
        vm.prank(alice);
        d.transfer(bob, 1);
        vm.expectRevert(); // ERC20InsufficientBalance on the D burn
        vm.prank(alice);
        vault.redeem(units, alice);
    }

    function test_dividend_accruesToDividendHolder() public {
        uint256 units = _mint(alice, 100e18);
        uint256 i0 = SPY_MULTIPLIER;
        _payDividend(30); // +0.30%
        uint256 i1 = spy.uiMultiplier() * i0 / SPY_MULTIPLIER;

        uint256 expected = units * WAD / i0 - units * WAD / i1;
        assertApproxEqAbs(vault.claimable(alice), expected, 2);
        // 100 tokens, 0.30% dividend: about 0.3 tokens.
        assertApproxEqRel(vault.claimable(alice), 0.2991e18, 0.001e18);

        vm.prank(alice);
        uint256 claimed = vault.claimDividends(alice, alice);
        assertApproxEqAbs(claimed, expected, 2);
        assertEq(vault.claimable(alice), 0);

        // The pair now redeems for fewer raw tokens, each worth more: the same number of shares.
        vm.prank(alice);
        uint256 assets = vault.redeem(units, alice);
        assertApproxEqAbs(assets + claimed, 100e18, 2);
        assertApproxEqAbs(assets * spy.uiMultiplier() / WAD, units, 2, "P is exactly one share unit");
    }

    function test_dividend_followsTransfers() public {
        uint256 units = _mint(alice, 100e18);
        _payDividend(50);
        uint256 aliceFirst = vault.claimable(alice);

        vm.prank(alice);
        d.transfer(bob, units);
        _payDividend(50);

        assertEq(vault.claimable(alice), aliceFirst, "alice keeps only the dividend paid while she held D");
        assertApproxEqRel(vault.claimable(bob), aliceFirst, 0.01e18, "bob gets the second one");
        assertEq(vault.owed(alice), aliceFirst);
    }

    function test_principalHolder_getsNoDividendsUntilMaturity() public {
        uint256 units = _mint(alice, 100e18);
        vm.prank(alice);
        d.transfer(bob, units); // alice keeps only P

        _payDividend(30);
        _payDividend(30);
        vm.warp(maturity);
        vault.sync();

        vm.prank(alice);
        uint256 assets = vault.redeem(units, alice);
        // P redeems for exactly `units` shares at the settled index; bob holds the dividends.
        assertApproxEqAbs(assets * spy.uiMultiplier() / WAD, units, 2);
        vm.prank(bob);
        uint256 dividends = vault.claimDividends(bob, bob);
        assertApproxEqAbs(assets + dividends, 100e18, 3);
        assertLe(assets + dividends, 100e18);
    }

    function test_afterMaturity_dividendsBelongToPrincipal() public {
        uint256 units = _mint(alice, 100e18);
        vm.warp(maturity + 1);
        vault.sync();
        uint256 settled = vault.settledIndex();
        assertEq(settled, SPY_MULTIPLIER);

        _payDividend(100);
        assertEq(vault.claimable(alice), 0, "D stops accruing at maturity");

        vm.prank(alice);
        uint256 assets = vault.redeem(units, alice); // P alone after maturity
        assertApproxEqAbs(assets, 100e18, 1);
        assertEq(d.balanceOf(alice), units, "D was not needed");
        // The raw tokens carry the post-maturity dividend in their multiplier.
        assertApproxEqRel(assets * spy.uiMultiplier() / WAD, units * 101 / 100, 1e9);
    }

    function test_settlement_countsDividendEffectiveBeforeMaturity() public {
        _mint(alice, 100e18);
        // Scheduled to take effect an hour before maturity; nobody syncs until well after.
        vm.prank(owner);
        spy.updateMultiplier(SPY_MULTIPLIER * 1003 / 1000, maturity - 1 hours);
        vm.warp(maturity + 30 days);
        vault.sync();
        assertApproxEqRel(vault.settledIndex(), SPY_MULTIPLIER * 1003 / 1000, 1e9);
        assertGt(vault.claimable(alice), 0);
    }

    function test_settlement_excludesDividendEffectiveAfterMaturity() public {
        _mint(alice, 100e18);
        vm.prank(owner);
        spy.updateMultiplier(SPY_MULTIPLIER * 1003 / 1000, maturity + 1 hours);
        vm.warp(maturity + 30 days);
        vault.sync();
        assertEq(vault.settledIndex(), SPY_MULTIPLIER);
        assertEq(vault.claimable(alice), 0);
    }

    function test_settlement_ignoresLaterSyncsByOtherVaults() public {
        ExdivVault later = factory.createVault(address(spy), maturity + 180 days);
        _mint(alice, 100e18);
        vm.warp(maturity + 1);
        _payDividend(40);
        later.sync(); // the shared index records the post-maturity dividend first
        vault.sync();
        assertEq(vault.settledIndex(), SPY_MULTIPLIER);
    }

    function test_mintAfterMaturity_reverts() public {
        vm.warp(maturity);
        vm.expectRevert(ExdivVault.Matured.selector);
        vm.prank(alice);
        vault.mint(1e18, alice, alice);
    }

    function test_frozenIndex_blocksMintAndRedeemButNotClaimsOrTransfers() public {
        uint256 units = _mint(alice, 100e18);
        _payDividend(30);
        vault.sync();
        uint256 owedBefore = vault.claimable(alice);

        _setMultiplier(spy.uiMultiplier() * 110 / 100); // unexplained +10%
        vault.sync();
        assertTrue(index.isFrozen(address(spy)));

        vm.startPrank(alice);
        vm.expectRevert(ExdivVault.IndexFrozen.selector);
        vault.mint(1e18, alice, alice);
        vm.expectRevert(ExdivVault.IndexFrozen.selector);
        vault.redeem(units, alice);
        d.transfer(bob, units / 2); // D still moves, at the last good index
        uint256 claimed = vault.claimDividends(alice, alice);
        vm.stopPrank();
        assertEq(claimed, owedBefore);

        // The owner classifies the step as a 21:20 stock dividend plus a ~4.8% cash dividend.
        vm.prank(owner);
        index.resolve(address(spy), 21, 20);
        assertGt(vault.claimable(alice), 0, "alice's remaining half catches up");
        assertGt(vault.claimable(bob), 0);
        vm.prank(alice);
        vault.redeem(units / 2, alice);
    }

    function test_frozenAtMaturity_waitsToSettle() public {
        uint256 units = _mint(alice, 100e18);
        vm.warp(maturity + 1);
        _setMultiplier(SPY_MULTIPLIER * 110 / 100);
        (, bool reliable) = vault.sync();
        assertFalse(reliable);
        assertEq(vault.settledIndex(), 0, "not settled while frozen");
        vm.expectRevert(ExdivVault.IndexFrozen.selector);
        vm.prank(alice);
        vault.redeem(units, alice);

        vm.prank(owner);
        index.resolve(address(spy), 11, 10);
        vault.sync();
        assertEq(vault.settledIndex(), SPY_MULTIPLIER);
        vm.prank(alice);
        vault.redeem(units, alice);
    }

    function test_claim_operator() public {
        _mint(alice, 100e18);
        _payDividend(30);
        vm.expectRevert(ExdivVault.NotAuthorized.selector);
        vm.prank(bob);
        vault.claimDividends(alice, bob);

        vm.prank(alice);
        vault.setOperator(bob, true);
        vm.prank(bob);
        uint256 got = vault.claimDividends(alice, bob);
        assertGt(got, 0);
        assertEq(spy.balanceOf(bob), 1000e18 + got);
    }

    function test_views() public {
        uint256 units = _mint(alice, 10e18);
        assertLe(vault.previewRedeem(units), 10e18, "rounds down");
        assertApproxEqAbs(vault.previewRedeem(units), 10e18, 1);
        assertGe(vault.principalBacking(), vault.previewRedeem(units), "backing rounds up");
        assertEq(factory.vaultAt(0), address(vault));
        vm.prank(alice);
        assertEq(vault.claimDividends(alice, alice), 0, "nothing to claim yet");
        _payDividend(25);
        (uint256 idx, bool reliable) = vault.previewIndex();
        assertTrue(reliable);
        assertGt(idx, SPY_MULTIPLIER);
    }

    function test_redeem_zeroReverts() public {
        vm.expectRevert(ExdivVault.ZeroAmount.selector);
        vm.prank(alice);
        vault.redeem(0, alice);
    }

    function test_demoStock_paysDividendOnDemand() public {
        DemoStockToken demo = new DemoStockToken("Demo", "DEMO", owner);
        vm.prank(owner);
        index.register(address(demo));
        ExdivVault v = factory.createVault(address(demo), maturity);
        vm.prank(owner);
        demo.mint(alice, 100e18);
        vm.startPrank(alice);
        demo.approve(address(v), type(uint256).max);
        v.mint(100e18, alice, alice);
        vm.stopPrank();

        vm.prank(carol);
        demo.payDividend(); // anyone can
        assertEq(demo.uiMultiplier(), 1.003e18);
        uint256 expected = 100e18 - uint256(100e18) * 1e18 / 1.003e18;
        assertApproxEqRel(v.claimable(alice), expected, 1e9);

        vm.expectRevert(abi.encodeWithSelector(DemoStockToken.DividendCooldown.selector, block.timestamp + 10 minutes));
        demo.payDividend();
        vm.warp(block.timestamp + 10 minutes);
        demo.payDividend();
        assertEq(demo.uiMultiplier(), uint256(1.003e18) * 10_030 / 10_000);
    }

    function test_hook_onlyDividendToken() public {
        vm.expectRevert(ExdivVault.OnlyDividendToken.selector);
        vault.beforeDividendTransfer(alice, bob);
    }

    function test_tokens_onlyVaultMints() public {
        vm.expectRevert(ExdivToken.OnlyVault.selector);
        p.mint(alice, 1);
        vm.expectRevert(ExdivToken.OnlyVault.selector);
        d.burn(alice, 1);
    }

    function test_factory_guards() public {
        vm.expectRevert(abi.encodeWithSelector(ExdivFactory.VaultExists.selector, address(vault)));
        factory.createVault(address(spy), maturity);
        vm.expectRevert(abi.encodeWithSelector(ExdivFactory.InvalidMaturity.selector, block.timestamp));
        factory.createVault(address(spy), block.timestamp);
        MockStockToken stray = new MockStockToken("Stray", "STRAY", owner);
        vm.expectRevert(abi.encodeWithSelector(ExdivFactory.NotRegistered.selector, address(stray)));
        factory.createVault(address(stray), maturity);
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.allVaults()[0], address(vault));
    }

    function test_splitDuringTerm_changesNothingForHolders() public {
        uint256 units = _mint(alice, 100e18);
        _setMultiplier(spy.uiMultiplier() * 4); // 4:1 split: same value, four times the shares per token
        vault.sync();
        assertEq(vault.claimable(alice), 0, "a split is not a dividend");
        vm.prank(alice);
        uint256 assets = vault.redeem(units, alice);
        assertApproxEqAbs(assets, 100e18, 1);
    }

    /// @dev Whatever the sequence of dividends and transfers, redeemed plus claimed never exceeds deposits, and
    /// the shortfall is only rounding.
    function testFuzz_conservation(uint96 depositA, uint96 depositB, uint16 div1, uint16 div2, uint96 moved) public {
        depositA = uint96(bound(depositA, 1e12, 500e18));
        depositB = uint96(bound(depositB, 1e12, 500e18));
        uint256 ua = _mint(alice, depositA);
        uint256 ub = _mint(bob, depositB);
        _payDividend(bound(div1, 0, 499));
        uint256 move = bound(moved, 0, ua);
        vm.prank(alice);
        d.transfer(carol, move);
        _payDividend(bound(div2, 0, 499));

        uint256 out;
        vm.prank(alice);
        out += vault.claimDividends(alice, alice);
        vm.prank(carol);
        out += vault.claimDividends(carol, carol);
        vm.prank(bob);
        out += vault.redeem(ub, bob);
        vm.prank(bob);
        out += vault.claimDividends(bob, bob);
        uint256 carolUnits = d.balanceOf(carol);
        vm.prank(carol);
        d.transfer(alice, carolUnits);
        vm.prank(alice);
        out += vault.redeem(ua, alice);
        vm.prank(alice);
        out += vault.claimDividends(alice, alice);

        uint256 deposited = uint256(depositA) + depositB;
        assertLe(out, deposited, "never pays out more than deposited");
        assertApproxEqAbs(out, deposited, 10, "only rounding dust stays behind");
        assertEq(spy.balanceOf(address(vault)), deposited - out);
    }
}
