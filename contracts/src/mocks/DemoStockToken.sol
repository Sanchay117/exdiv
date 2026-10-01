// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockStockToken} from "./MockStockToken.sol";

/// @title DemoStockToken
/// @notice TESTNET ONLY. A stand-in stock that pays a small dividend whenever anyone asks (at most every ten
/// minutes), so the dividend side of Exdiv can be tried without waiting weeks for a real ex-date. Like a Robinhood
/// stock token, it pays by raising its ERC-8056 multiplier.
contract DemoStockToken is MockStockToken {
    /// @notice Each demo dividend raises the multiplier by this much (0.3%, a typical quarterly payout).
    uint256 public constant DIVIDEND_BPS = 30;
    uint256 public constant DIVIDEND_COOLDOWN = 10 minutes;

    uint256 public lastDividend;

    error DividendCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, address owner_) MockStockToken(name_, symbol_, owner_) {}

    /// @notice Pays a 0.3% dividend to every holder, reinvested into the multiplier.
    function payDividend() external {
        uint256 next = lastDividend + DIVIDEND_COOLDOWN;
        if (lastDividend != 0 && block.timestamp < next) revert DividendCooldown(next);
        lastDividend = block.timestamp;
        _applyMultiplier(uiMultiplier() * (10_000 + DIVIDEND_BPS) / 10_000);
    }
}
