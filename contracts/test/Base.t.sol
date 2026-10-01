// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {ExdivFactory} from "../src/ExdivFactory.sol";
import {ExdivVault} from "../src/ExdivVault.sol";
import {ExdivBook} from "../src/ExdivBook.sol";
import {ExdivRouter} from "../src/ExdivRouter.sol";
import {ExdivToken, DividendToken} from "../src/ExdivTokens.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract BaseTest is Test {
    uint256 internal constant WAD = 1e18;
    /// @dev SPY's real mainnet multiplier on 2026-10-01: one reinvested dividend since launch.
    uint256 internal constant SPY_MULTIPLIER = 1_001_717_991_187_472_003;

    address internal owner = makeAddr("owner");
    address internal attester = makeAddr("attester");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    MockStockToken internal spy;
    MockUSDG internal usdg;
    DividendIndex internal index;
    ExdivFactory internal factory;
    ExdivBook internal book;
    ExdivRouter internal router;
    ExdivVault internal vault;
    ExdivToken internal p;
    DividendToken internal d;
    uint256 internal maturity;

    function setUp() public virtual {
        vm.warp(1_790_000_000); // 2026-09-21
        spy = new MockStockToken("Test SPY", "SPY", owner);
        usdg = new MockUSDG();
        vm.prank(owner);
        spy.updateMultiplier(SPY_MULTIPLIER);

        index = new DividendIndex(owner);
        vm.startPrank(owner);
        index.register(address(spy));
        index.setAttester(attester);
        vm.stopPrank();

        factory = new ExdivFactory(index);
        maturity = block.timestamp + 365 days;
        vault = factory.createVault(address(spy), maturity);
        p = vault.principal();
        d = vault.dividend();
        book = new ExdivBook(usdg);
        router = new ExdivRouter(factory, book);

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; ++i) {
            vm.prank(owner);
            spy.mint(users[i], 1000e18);
            usdg.mint(users[i], 1_000_000e6);
            vm.startPrank(users[i]);
            spy.approve(address(vault), type(uint256).max);
            spy.approve(address(router), type(uint256).max);
            spy.approve(address(book), type(uint256).max);
            p.approve(address(book), type(uint256).max);
            d.approve(address(book), type(uint256).max);
            usdg.approve(address(book), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// @dev Robinhood reinvests a dividend: multiplier *= 1 + bps / 10000.
    function _payDividend(uint256 bps) internal {
        uint256 m = spy.uiMultiplier() * (10_000 + bps) / 10_000;
        vm.prank(owner);
        spy.updateMultiplier(m);
    }

    function _setMultiplier(uint256 m) internal {
        vm.prank(owner);
        spy.updateMultiplier(m);
    }

    function _mint(address who, uint256 assets) internal returns (uint256 units) {
        vm.prank(who);
        units = vault.mint(assets, who, who);
    }
}
