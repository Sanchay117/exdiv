// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DividendIndex} from "./DividendIndex.sol";
import {ExdivVault} from "./ExdivVault.sol";

/// @title ExdivFactory
/// @notice Deploys one ExdivVault per (stock token, maturity). Permissionless for any token the dividend index
/// tracks, so the token list is curated in one place.
contract ExdivFactory {
    DividendIndex public immutable dividendIndex;

    uint256 public constant MIN_TERM = 1 hours;
    uint256 public constant MAX_TERM = 10 * 365 days;

    mapping(address asset => mapping(uint256 maturity => address)) public vaultOf;
    address[] internal _vaults;

    event VaultCreated(
        address indexed asset, uint256 indexed maturity, address vault, address principal, address dividend
    );

    error NotRegistered(address asset);
    error InvalidMaturity(uint256 maturity);
    error VaultExists(address vault);

    constructor(DividendIndex dividendIndex_) {
        dividendIndex = dividendIndex_;
    }

    function createVault(address asset, uint256 maturity) external returns (ExdivVault vault) {
        if (!dividendIndex.isRegistered(asset)) revert NotRegistered(asset);
        if (maturity < block.timestamp + MIN_TERM || maturity > block.timestamp + MAX_TERM) {
            revert InvalidMaturity(maturity);
        }
        address existing = vaultOf[asset][maturity];
        if (existing != address(0)) revert VaultExists(existing);

        vault = new ExdivVault{salt: keccak256(abi.encode(asset, maturity))}(IERC20(asset), dividendIndex, maturity);
        vaultOf[asset][maturity] = address(vault);
        _vaults.push(address(vault));
        emit VaultCreated(asset, maturity, address(vault), address(vault.principal()), address(vault.dividend()));
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 i) external view returns (address) {
        return _vaults[i];
    }

    function allVaults() external view returns (address[] memory) {
        return _vaults;
    }
}
