// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IScaledUIAmount, IScaledUIAmountNewUIMultiplier} from "../interfaces/IERC8056.sol";

/// @title MockStockToken
/// @notice TESTNET ONLY. A stand-in for a dividend-paying Robinhood stock token, which testnet doesn't have
/// (its AMZN, TSLA, AMD, PLTR and NFLX pay no dividends, so their multipliers sit at 1.0). It implements the
/// same ERC-8056 surface, with immediate and scheduled multiplier updates. The owner is a keeper that copies
/// the mainnet token's multiplier, so testnet dividends follow the real ones.
contract MockStockToken is ERC20, Ownable, ERC165, IScaledUIAmount, IScaledUIAmountNewUIMultiplier {
    uint256 public constant FAUCET_AMOUNT = 100e18;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    uint256 private _uiMultiplier = 1e18;
    uint256 private _newUIMultiplier = 1e18;
    uint256 private _effectiveAt;

    mapping(address => uint256) public lastFaucet;

    error FaucetCooldown(uint256 availableAt);
    error EffectiveInPast();

    constructor(string memory name_, string memory symbol_, address owner_) ERC20(name_, symbol_) Ownable(owner_) {}

    function uiMultiplier() public view returns (uint256) {
        return block.timestamp >= _effectiveAt ? _newUIMultiplier : _uiMultiplier;
    }

    function newUIMultiplier() external view returns (uint256) {
        return _newUIMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        return _effectiveAt;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf(account) * uiMultiplier() / 1e18;
    }

    function totalSupplyUI() external view returns (uint256) {
        return totalSupply() * uiMultiplier() / 1e18;
    }

    function oraclePaused() external pure returns (bool) {
        return false;
    }

    /// @notice Applies a new multiplier now.
    function updateMultiplier(uint256 multiplier) external onlyOwner {
        _applyMultiplier(multiplier);
    }

    function _applyMultiplier(uint256 multiplier) internal {
        uint256 old = uiMultiplier();
        _uiMultiplier = multiplier;
        _newUIMultiplier = multiplier;
        _effectiveAt = block.timestamp;
        emit UIMultiplierUpdated(old, multiplier, block.timestamp);
    }

    /// @notice Schedules a new multiplier; `uiMultiplier()` switches at `at` with no transaction.
    function updateMultiplier(uint256 multiplier, uint256 at) external onlyOwner {
        if (at < block.timestamp) revert EffectiveInPast();
        uint256 old = uiMultiplier();
        _uiMultiplier = old;
        _newUIMultiplier = multiplier;
        _effectiveAt = at;
        emit UIMultiplierUpdated(old, multiplier, at);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Test tokens for anyone, once a day.
    function faucet() external {
        uint256 next = lastFaucet[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucet[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xa60bf13d // IScaledUIAmount
            || interfaceId == 0x4bd27648 // IScaledUIAmountNewUIMultiplier
            || interfaceId == 0xd890fd71 // IScaledUIAmountBalances
            || super.supportsInterface(interfaceId);
    }
}
