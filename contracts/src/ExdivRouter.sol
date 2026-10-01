// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ExdivBook} from "./ExdivBook.sol";
import {ExdivFactory} from "./ExdivFactory.sol";
import {ExdivVault} from "./ExdivVault.sol";

/// @title ExdivRouter
/// @notice One-transaction flows that turn dividends into USDG. Holds nothing between calls.
contract ExdivRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    ExdivFactory public immutable factory;
    ExdivBook public immutable book;

    error UnknownVault(address vault);

    constructor(ExdivFactory factory_, ExdivBook book_) {
        factory = factory_;
        book = book_;
    }

    /// @notice "Dividend advance": strips `assets` stock tokens, keeps the principal for `receiver` and sells the
    /// dividend half into `bidIds` for at least `minQuoteOut` USDG. Unsold dividend tokens go to `receiver` too.
    function stripAndSellDividends(
        ExdivVault vault,
        uint256 assets,
        uint256[] calldata bidIds,
        uint256 minQuoteOut,
        address receiver
    ) external nonReentrant returns (uint256 units, uint256 quoteOut) {
        _checkVault(vault);
        IERC20 asset = vault.asset();
        asset.safeTransferFrom(msg.sender, address(this), assets);
        asset.forceApprove(address(vault), assets);
        units = vault.mint(assets, receiver, address(this));

        IERC20 dividend = IERC20(address(vault.dividend()));
        uint256 sold;
        (sold, quoteOut) = _sell(dividend, units, bidIds, minQuoteOut, receiver);
        if (sold < units) dividend.safeTransfer(receiver, units - sold);
    }

    /// @notice "Income mode": claims the caller's dividends and sells them into `bidIds` for USDG.
    /// The caller must first make the router an operator on the vault (`vault.setOperator(router, true)`).
    function claimDividendsForQuote(ExdivVault vault, uint256[] calldata bidIds, uint256 minQuoteOut, address receiver)
        external
        nonReentrant
        returns (uint256 assets, uint256 quoteOut)
    {
        _checkVault(vault);
        assets = vault.claimDividends(msg.sender, address(this));
        IERC20 asset = vault.asset();
        uint256 sold;
        (sold, quoteOut) = _sell(asset, assets, bidIds, minQuoteOut, receiver);
        if (sold < assets) asset.safeTransfer(receiver, assets - sold);
    }

    function _sell(IERC20 token, uint256 amount, uint256[] calldata bidIds, uint256 minQuoteOut, address receiver)
        internal
        returns (uint256 sold, uint256 quoteOut)
    {
        if (amount == 0) return (0, 0);
        token.forceApprove(address(book), amount);
        (sold, quoteOut) = book.sell(address(token), amount, bidIds, minQuoteOut, receiver);
        token.forceApprove(address(book), 0);
    }

    function _checkVault(ExdivVault vault) internal view {
        if (factory.vaultOf(address(vault.asset()), vault.maturity()) != address(vault)) {
            revert UnknownVault(address(vault));
        }
    }
}
