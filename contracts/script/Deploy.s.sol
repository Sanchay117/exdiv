// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {ExdivFactory} from "../src/ExdivFactory.sol";
import {ExdivBook} from "../src/ExdivBook.sol";
import {ExdivRouter} from "../src/ExdivRouter.sol";
import {ExdivVault} from "../src/ExdivVault.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

/// @notice Deploys Exdiv to Robinhood Chain testnet (46630).
///
/// Testnet's own stock tokens (AMZN, TSLA, AMD, PLTR, NFLX) implement ERC-8056 but pay no dividends, so they get
/// vaults too, alongside four dividend payers mirrored from mainnet. The mirrors start at their mainnet multipliers
/// (read 2026-10-01) and the keeper (scripts/keeper.ts) copies every later mainnet change.
///
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
contract Deploy is Script {
    address internal constant USDG = 0x7E955252E15c84f5768B83c41a71F9eba181802F;

    uint256 internal constant DEC_2026 = 1_798_675_200; // 2026-12-31 00:00 UTC
    uint256 internal constant DEC_2027 = 1_830_211_200; // 2027-12-31 00:00 UTC

    struct Mirror {
        string name;
        string symbol;
        uint256 multiplier;
    }

    function _mirrors() internal pure returns (Mirror[4] memory) {
        return [
            Mirror("SPDR S&P 500 ETF (testnet mirror)", "SPY", 1_001_717_991_187_472_003),
            Mirror("Schwab US Dividend Equity ETF (testnet mirror)", "SCHD", 1_005_538_606_893_683_992),
            Mirror("Microsoft (testnet mirror)", "MSFT", 1_000_412_952_576_205_964),
            Mirror("UPS (testnet mirror)", "UPS", 1_002_208_724_969_205_741)
        ];
    }

    function _testnetStocks() internal pure returns (address[5] memory) {
        return [
            0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02, // AMZN
            0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E, // TSLA
            0x71178BAc73cBeb415514eB542a8995b82669778d, // AMD
            0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0, // PLTR
            0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93 // NFLX
        ];
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        require(block.chainid == 46_630, "Robinhood Chain testnet only");

        vm.startBroadcast(pk);
        DividendIndex index = new DividendIndex(deployer);
        index.setAttester(deployer);
        ExdivFactory factory = new ExdivFactory(index);
        ExdivBook book = new ExdivBook(IERC20(USDG));
        ExdivRouter router = new ExdivRouter(factory, book);

        Mirror[4] memory mirrors = _mirrors();
        address[] memory tokens = new address[](mirrors.length + 5);
        for (uint256 i; i < mirrors.length; ++i) {
            MockStockToken token = new MockStockToken(mirrors[i].name, mirrors[i].symbol, deployer);
            token.updateMultiplier(mirrors[i].multiplier);
            token.mint(deployer, 10_000e18);
            index.register(address(token));
            factory.createVault(address(token), DEC_2026);
            factory.createVault(address(token), DEC_2027);
            tokens[i] = address(token);
        }
        address[5] memory stocks = _testnetStocks();
        for (uint256 i; i < stocks.length; ++i) {
            index.register(stocks[i]);
            factory.createVault(stocks[i], DEC_2026);
            tokens[mirrors.length + i] = stocks[i];
        }
        vm.stopBroadcast();

        string memory out = "deployment";
        vm.serializeUint(out, "chainId", block.chainid);
        vm.serializeAddress(out, "usdg", USDG);
        vm.serializeAddress(out, "dividendIndex", address(index));
        vm.serializeAddress(out, "factory", address(factory));
        vm.serializeAddress(out, "book", address(book));
        vm.serializeAddress(out, "router", address(router));
        vm.serializeAddress(out, "tokens", tokens);
        string memory json = vm.serializeAddress(out, "vaults", factory.allVaults());
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/robinhood-testnet.json"));

        console.log("DividendIndex", address(index));
        console.log("ExdivFactory ", address(factory));
        console.log("ExdivBook    ", address(book));
        console.log("ExdivRouter  ", address(router));
        console.log("vaults       ", factory.vaultCount());
    }
}
