// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {ExdivBook} from "../src/ExdivBook.sol";
import {ExdivRouter} from "../src/ExdivRouter.sol";
import {ExdivVault} from "../src/ExdivVault.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {ExdivFactory} from "../src/ExdivFactory.sol";

contract FeeToken is ERC20 {
    constructor() ERC20("Fee", "FEE") {
        _mint(msg.sender, 1e30);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value / 100);
            value -= value / 100;
        }
        super._update(from, to, value);
    }
}

contract ExdivBookTest is BaseTest {
    uint256 internal constant USD = 1e6;

    function _bid(address maker, address base, uint256 price, uint256 amount) internal returns (uint256) {
        vm.prank(maker);
        return book.placeOrder(base, true, uint128(price), uint128(amount));
    }

    function _ask(address maker, address base, uint256 price, uint256 amount) internal returns (uint256) {
        vm.prank(maker);
        return book.placeOrder(base, false, uint128(price), uint128(amount));
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        (ids[0], ids[1]) = (a, b);
    }

    function test_bid_escrowsQuoteAndRefundsOnCancel() public {
        uint256 id = _bid(bob, address(spy), 700 * USD, 2e18);
        assertEq(usdg.balanceOf(address(book)), 1400 * USD);
        ExdivBook.Order memory o = book.getOrder(id);
        assertEq(o.maker, bob);
        assertEq(o.remaining, 2e18);

        vm.expectRevert(ExdivBook.NotMaker.selector);
        vm.prank(alice);
        book.cancelOrder(id);

        vm.prank(bob);
        book.cancelOrder(id);
        assertEq(usdg.balanceOf(address(book)), 0);
        assertEq(usdg.balanceOf(bob), 1_000_000 * USD);
        assertEq(book.getOrder(id).maker, address(0));
    }

    function test_sell_walksBidsInGivenOrder() public {
        uint256 best = _bid(bob, address(spy), 701 * USD, 1e18);
        uint256 next = _bid(carol, address(spy), 699 * USD, 5e18);
        vm.prank(alice);
        (uint256 sold, uint256 out) = book.sell(address(spy), 3e18, _ids(best, next), 2000 * USD, alice);
        assertEq(sold, 3e18);
        assertEq(out, 701 * USD + 2 * 699 * USD);
        assertEq(spy.balanceOf(bob), 1001e18);
        assertEq(spy.balanceOf(carol), 1002e18);
        assertEq(book.getOrder(best).maker, address(0), "filled order closed");
        assertEq(book.getOrder(next).remaining, 3e18);
        assertEq(usdg.balanceOf(address(book)), 3 * 699 * USD, "escrow covers what's left");
    }

    function test_sell_slippageReverts() public {
        uint256 id = _bid(bob, address(spy), 700 * USD, 1e18);
        vm.expectRevert(abi.encodeWithSelector(ExdivBook.Slippage.selector, 700 * USD, 701 * USD));
        vm.prank(alice);
        book.sell(address(spy), 1e18, _ids(id), 701 * USD, alice);
    }

    function test_sell_skipsWrongOrders() public {
        uint256 ask = _ask(bob, address(spy), 700 * USD, 1e18);
        uint256 otherBase = _bid(bob, address(p), 680 * USD, 1e18);
        uint256 gone = _bid(carol, address(spy), 700 * USD, 1e18);
        vm.prank(carol);
        book.cancelOrder(gone);
        vm.prank(alice);
        (uint256 sold, uint256 out) = book.sell(address(spy), 1e18, _ids(ask, otherBase), 0, alice);
        assertEq(sold + out, 0);
    }

    function test_buy_fromAsks() public {
        _mint(bob, 10e18);
        uint256 id = _ask(bob, address(d), 2 * USD, 10e18);
        uint256 bobUsdBefore = usdg.balanceOf(bob);
        vm.prank(alice);
        (uint256 bought, uint256 paid) = book.buy(address(d), 4e18, _ids(id), 8 * USD, alice);
        assertEq(bought, 4e18);
        assertEq(paid, 8 * USD);
        assertEq(d.balanceOf(alice), 4e18);
        assertEq(usdg.balanceOf(bob), bobUsdBefore + 8 * USD);

        vm.expectRevert(abi.encodeWithSelector(ExdivBook.Slippage.selector, 2 * USD, 1 * USD));
        vm.prank(alice);
        book.buy(address(d), 1e18, _ids(id), 1 * USD, alice);
    }

    function test_rounding_favoursMakers() public {
        // 1 wei at $0.70 rounds to 0 for a seller and up to 1 unit for a buyer.
        uint256 bid = _bid(bob, address(spy), 700_000, 1e18);
        vm.prank(alice);
        (, uint256 out) = book.sell(address(spy), 1, _ids(bid), 0, alice);
        assertEq(out, 0);
        uint256 ask = _ask(bob, address(spy), 700_000, 1e18);
        vm.prank(alice);
        (, uint256 paid) = book.buy(address(spy), 1, _ids(ask), 1, alice);
        assertEq(paid, 1);
    }

    function test_fullFill_refundsBidDust() public {
        uint256 id = _bid(bob, address(spy), 333_333, 1e18); // escrow rounds up
        uint256 escrow = usdg.balanceOf(address(book));
        vm.startPrank(alice);
        book.sell(address(spy), 0.5e18, _ids(id), 0, alice);
        book.sell(address(spy), 0.5e18, _ids(id), 0, alice);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(book)), 0, "nothing stranded");
        assertEq(usdg.balanceOf(alice) - 1_000_000 * USD + usdg.balanceOf(bob), 1_000_000 * USD);
        assertLe(usdg.balanceOf(alice) - 1_000_000 * USD, escrow);
    }

    function test_placeOrder_guards() public {
        vm.startPrank(alice);
        vm.expectRevert(ExdivBook.ZeroAmount.selector);
        book.placeOrder(address(spy), true, 0, 1);
        vm.expectRevert(ExdivBook.InvalidBase.selector);
        book.placeOrder(address(usdg), false, 1, 1);
        vm.stopPrank();

        FeeToken fee = new FeeToken();
        fee.approve(address(book), type(uint256).max);
        vm.expectRevert(ExdivBook.InexactTransfer.selector);
        book.placeOrder(address(fee), false, 1, 1e18);
    }

    function testFuzz_bidEscrowAlwaysCoversFills(uint128 price, uint128 amount, uint128[4] memory fills) public {
        price = uint128(bound(price, 1, 1e12));
        amount = uint128(bound(amount, 1, 1e24));
        usdg.mint(bob, type(uint128).max);
        vm.prank(owner);
        spy.mint(alice, 1e24);
        uint256 id = _bid(bob, address(spy), price, amount);
        uint256 paid;
        for (uint256 i; i < fills.length; ++i) {
            vm.prank(alice);
            (, uint256 out) = book.sell(address(spy), bound(fills[i], 0, amount), _ids(id), 0, alice);
            paid += out;
        }
        ExdivBook.Order memory o = book.getOrder(id);
        assertEq(usdg.balanceOf(address(book)), o.quoteLocked, "escrow is exactly the open order's lock");
        assertGe(o.quoteLocked, uint256(o.remaining) * price / 1e18);
    }
}

contract ExdivRouterTest is BaseTest {
    uint256 internal constant USD = 1e6;

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function test_stripAndSellDividends() public {
        // Bob bids $2.50 per SPY dividend unit for the year (SPY pays ~$7.5 a year, ~$5.3 after withholding).
        vm.prank(bob);
        uint256 bid = book.placeOrder(address(d), true, uint128(2.5e6), 100e18);

        uint256 usdBefore = usdg.balanceOf(alice);
        vm.prank(alice);
        (uint256 units, uint256 quoteOut) = router.stripAndSellDividends(vault, 10e18, _ids(bid), 25 * USD, alice);

        assertEq(units, 10e18 * SPY_MULTIPLIER / WAD);
        assertEq(p.balanceOf(alice), units, "alice keeps the price exposure");
        assertEq(d.balanceOf(alice), 0);
        assertEq(d.balanceOf(bob), units, "bob now collects the dividends");
        assertEq(quoteOut, units * 2.5e6 / 1e18);
        assertEq(usdg.balanceOf(alice), usdBefore + quoteOut);
        assertEq(spy.balanceOf(address(router)) + d.balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_stripAndSell_returnsUnsoldDividends() public {
        vm.prank(bob);
        uint256 bid = book.placeOrder(address(d), true, uint128(2.5e6), 4e18);
        vm.prank(alice);
        (uint256 units,) = router.stripAndSellDividends(vault, 10e18, _ids(bid), 0, alice);
        assertEq(d.balanceOf(alice), units - 4e18);
    }

    function test_stripAndSell_slippage() public {
        vm.prank(bob);
        uint256 bid = book.placeOrder(address(d), true, uint128(2.5e6), 100e18);
        vm.expectRevert();
        vm.prank(alice);
        router.stripAndSellDividends(vault, 10e18, _ids(bid), 100 * USD, alice);
    }

    function test_unknownVaultRejected() public {
        DividendIndex rogueIndex = new DividendIndex(address(this));
        rogueIndex.register(address(spy));
        ExdivVault rogue = new ExdivFactory(rogueIndex).createVault(address(spy), maturity);
        vm.expectRevert(abi.encodeWithSelector(ExdivRouter.UnknownVault.selector, address(rogue)));
        vm.prank(alice);
        router.stripAndSellDividends(rogue, 1e18, new uint256[](0), 0, alice);
    }

    function test_claimDividendsForQuote() public {
        _mint(alice, 100e18);
        _payDividend(30);
        vm.prank(bob);
        uint256 bid = book.placeOrder(address(spy), true, uint128(700e6), 10e18);

        vm.expectRevert(ExdivVault.NotAuthorized.selector);
        vm.prank(alice);
        router.claimDividendsForQuote(vault, _ids(bid), 0, alice);

        vm.startPrank(alice);
        vault.setOperator(address(router), true);
        uint256 usdBefore = usdg.balanceOf(alice);
        (uint256 assets, uint256 quoteOut) = router.claimDividendsForQuote(vault, _ids(bid), 0, alice);
        vm.stopPrank();
        assertApproxEqRel(assets, 0.2991e18, 0.001e18);
        assertEq(quoteOut, assets * 700e6 / 1e18);
        assertEq(usdg.balanceOf(alice), usdBefore + quoteOut);
        assertEq(vault.claimable(alice), 0);
    }
}
