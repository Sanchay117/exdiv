// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ERC-8056 (Scaled UI Amount) as implemented by Robinhood stock tokens.
/// One raw token stands for `uiMultiplier / 1e18` shares. Robinhood raises the multiplier to
/// reinvest cash dividends and multiplies it on splits, so balances never rebase.
interface IScaledUIAmount {
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);

    function uiMultiplier() external view returns (uint256);
}

interface IScaledUIAmountNewUIMultiplier {
    /// @notice The scheduled multiplier; equals the current one when nothing is scheduled.
    function newUIMultiplier() external view returns (uint256);

    /// @notice When `newUIMultiplier` takes effect. `uiMultiplier()` switches with no transaction.
    function effectiveAt() external view returns (uint256);
}
