// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

interface IDividendHook {
    /// @notice Settles dividends for both parties before any balance of the dividend token moves.
    function beforeDividendTransfer(address from, address to) external;
}

/// @notice A token minted and burned only by the vault that deployed it. 18 decimals, one unit is one
/// share (as of the vault's index) of the underlying stock.
contract ExdivToken is ERC20, ERC20Permit {
    address public immutable vault;

    error OnlyVault();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) ERC20Permit(name_) {
        vault = msg.sender;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }
}

/// @notice The dividend half. Every balance change first lets the vault settle accrued dividends, so
/// dividends follow whoever held the token when they were paid.
contract DividendToken is ExdivToken {
    constructor(string memory name_, string memory symbol_) ExdivToken(name_, symbol_) {}

    function _update(address from, address to, uint256 value) internal override {
        IDividendHook(vault).beforeDividendTransfer(from, to);
        super._update(from, to, value);
    }
}
