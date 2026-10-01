// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseTest} from "./Base.t.sol";
import {ExdivVault} from "../src/ExdivVault.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {ExdivToken, DividendToken} from "../src/ExdivTokens.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

/// @dev Drives a vault through random deposits, redemptions, transfers, claims, dividends, splits and time.
contract VaultHandler is Test {
    ExdivVault internal vault;
    DividendIndex internal dividendIndex;
    MockStockToken internal spy;
    ExdivToken internal p;
    DividendToken internal d;
    address internal issuer;
    address[3] internal actors;

    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public dividendsPaid;
    uint256 public splits;

    constructor(ExdivVault vault_, address issuer_, address[3] memory actors_) {
        vault = vault_;
        dividendIndex = vault_.dividendIndex();
        spy = MockStockToken(address(vault_.asset()));
        p = vault_.principal();
        d = vault_.dividend();
        issuer = issuer_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function mint(uint256 actorSeed, uint256 assets) external {
        if (block.timestamp >= vault.maturity()) return;
        address a = _actor(actorSeed);
        assets = bound(assets, 1e9, spy.balanceOf(a) / 4 + 1e9);
        if (assets > spy.balanceOf(a) || vault.previewMint(assets) == 0) return;
        vm.prank(a);
        vault.mint(assets, a, a);
        deposited += assets;
    }

    function redeem(uint256 actorSeed, uint256 units) external {
        address a = _actor(actorSeed);
        uint256 max = p.balanceOf(a);
        if (block.timestamp < vault.maturity()) max = Math.min(max, d.balanceOf(a));
        if (max == 0) return;
        units = bound(units, 1, max);
        if (vault.previewRedeem(units) == 0) return;
        vm.prank(a);
        withdrawn += vault.redeem(units, a);
    }

    function claim(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        vm.prank(a);
        withdrawn += vault.claimDividends(a, a);
    }

    function transferDividend(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        amount = bound(amount, 0, d.balanceOf(from));
        vm.prank(from);
        d.transfer(_actor(toSeed), amount);
    }

    function transferPrincipal(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        amount = bound(amount, 0, p.balanceOf(from));
        vm.prank(from);
        p.transfer(_actor(toSeed), amount);
    }

    /// @dev The keeper syncs on every UIMultiplierUpdated event, so each step is classified on its own.
    /// (Unsynced combinations are covered by unit tests: they freeze, by design.)
    function payDividend(uint256 bps) external {
        dividendIndex.sync(address(spy));
        uint256 m = spy.uiMultiplier();
        m += m * bound(bps, 1, 499) / 10_000;
        vm.prank(issuer);
        spy.updateMultiplier(m);
        ++dividendsPaid;
    }

    /// @dev Splits are announced first, as the keeper does from Robinhood's corporate-actions feed, so a dividend
    /// landing in the same unsynced window doesn't freeze the index.
    function split(bool forward) external {
        dividendIndex.sync(address(spy));
        uint256 m = spy.uiMultiplier();
        if (!forward && m < 1e12) return;
        vm.prank(issuer);
        dividendIndex.attestSplit(address(spy), forward ? 2 : 1, forward ? 1 : 2);
        vm.prank(issuer);
        spy.updateMultiplier(forward ? m * 2 : m / 2);
        ++splits;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 45 days));
    }

    function sync() external {
        vault.sync();
    }
}

contract ExdivInvariantTest is BaseTest {
    VaultHandler internal handler;
    uint256 internal lastIndex;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, owner, [alice, bob, carol]);
        targetContract(address(handler));
        (lastIndex,) = vault.previewIndex();
    }

    /// @notice The vault always holds enough stock tokens for every principal unit plus every dividend owed.
    function invariant_solvent() public view {
        uint256 claims = vault.claimable(alice) + vault.claimable(bob) + vault.claimable(carol);
        assertGe(spy.balanceOf(address(vault)), vault.principalBacking() + claims);
    }

    /// @notice Stock tokens are neither created nor lost: deposits = withdrawals + what the vault holds.
    function invariant_conservation() public view {
        assertEq(handler.deposited(), handler.withdrawn() + spy.balanceOf(address(vault)));
    }

    /// @notice Before maturity, P and D are always minted and burned together.
    function invariant_pairedSupplyBeforeMaturity() public view {
        if (block.timestamp < maturity) assertEq(p.totalSupply(), d.totalSupply());
    }

    /// @notice Only exact splits and dividends of at most 5% happen here, so the index never freezes.
    function invariant_neverFrozen() public view {
        assertFalse(index.isFrozen(address(spy)));
    }

    /// @notice The rounding dust the vault keeps stays tiny.
    function invariant_dustBounded() public view {
        uint256 claims = vault.claimable(alice) + vault.claimable(bob) + vault.claimable(carol);
        uint256 held = spy.balanceOf(address(vault));
        uint256 owedOut = vault.principalBacking() + claims;
        assertLe(held - owedOut, 1e6, "dust above 1e-12 tokens");
    }
}
