// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {ExdivFactory} from "../src/ExdivFactory.sol";
import {ExdivBook} from "../src/ExdivBook.sol";
import {ExdivRouter} from "../src/ExdivRouter.sol";

/// @notice Deploys Exdiv on Robinhood Chain mainnet (4663) against Robinhood's own stock tokens and Paxos USDG.
/// Same contracts as testnet, no mocks: the vaults need no oracle, only the tokens' ERC-8056 multipliers.
///
///   forge script script/DeployMainnet.s.sol --rpc-url robinhood --broadcast
contract DeployMainnet is Script {
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    uint256 internal constant DEC_2026 = 1_798_675_200; // 2026-12-31 00:00 UTC
    uint256 internal constant DEC_2027 = 1_830_211_200; // 2027-12-31 00:00 UTC

    /// @dev Dividend payers with at least one dividend already reinvested onchain (read 2026-10-01).
    function _tokens() internal pure returns (address[8] memory) {
        return [
            0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, // SPY
            0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, // QQQ
            0xd63ABB2C13d7a8421a8017a712802053568e3C1D, // SCHD
            0xe93237C50D904957Cf27E7B1133b510C669c2e74, // MSFT
            0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, // AAPL
            0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, // NVDA
            0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, // TSM
            0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2 // UPS
        ];
    }

    function run() external {
        uint256 pk = vm.envUint("MAINNET_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        require(block.chainid == 4663, "Robinhood Chain mainnet only");

        vm.startBroadcast(pk);
        DividendIndex index = new DividendIndex(deployer);
        index.setAttester(deployer);
        ExdivFactory factory = new ExdivFactory(index);
        ExdivBook book = new ExdivBook(IERC20(USDG));
        ExdivRouter router = new ExdivRouter(factory, book);
        address[8] memory tokens = _tokens();
        for (uint256 i; i < tokens.length; ++i) {
            index.register(tokens[i]);
            factory.createVault(tokens[i], DEC_2026);
            factory.createVault(tokens[i], DEC_2027);
        }
        vm.stopBroadcast();

        string memory out = "deployment";
        vm.serializeUint(out, "chainId", block.chainid);
        vm.serializeAddress(out, "usdg", USDG);
        vm.serializeAddress(out, "dividendIndex", address(index));
        vm.serializeAddress(out, "factory", address(factory));
        vm.serializeAddress(out, "book", address(book));
        vm.serializeAddress(out, "router", address(router));
        string memory json = vm.serializeAddress(out, "vaults", factory.allVaults());
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/robinhood-mainnet.json"));
        console.log("DividendIndex", address(index));
        console.log("ExdivFactory ", address(factory));
        console.log("vaults       ", factory.vaultCount());
    }
}
