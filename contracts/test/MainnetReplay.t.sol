// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DividendIndex} from "../src/DividendIndex.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

/// @notice Replays every multiplier change Robinhood has made on Robinhood Chain mainnet (fixture: all
/// `UIMultiplierUpdated` events from all 195 stock tokens up to block 77,396,069) through the classifier.
/// Each step must be classified with no freeze and no attestation: 45 reinvested dividends across 42 tokens, and
/// CRWD's 4:1 split (announced twice).
contract MainnetReplayTest is Test {
    struct Replay {
        string[] symbols;
        address[] tokens;
        uint256[] oldMultipliers;
        uint256[] newMultipliers;
        uint256[] effectiveAts;
    }

    DividendIndex internal index;
    mapping(address real => MockStockToken) internal mirror;
    uint256 internal dividends;
    uint256 internal splitSteps;

    function _load() internal view returns (Replay memory r) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/mainnet-multipliers.json"));
        r.symbols = vm.parseJsonStringArray(json, ".symbols");
        r.tokens = vm.parseJsonAddressArray(json, ".tokens");
        r.oldMultipliers = vm.parseJsonUintArray(json, ".oldMultipliers");
        r.newMultipliers = vm.parseJsonUintArray(json, ".newMultipliers");
        r.effectiveAts = vm.parseJsonUintArray(json, ".effectiveAts");
    }

    function test_replayEveryMainnetMultiplierChange() public {
        Replay memory r = _load();
        assertEq(r.symbols.length, 47);
        index = new DividendIndex(address(this));
        vm.warp(1_780_000_000); // before the first event (2026-07-02)

        for (uint256 i; i < r.tokens.length; ++i) {
            MockStockToken token = mirror[r.tokens[i]];
            if (address(token) == address(0)) {
                token = new MockStockToken(r.symbols[i], r.symbols[i], address(this));
                mirror[r.tokens[i]] = token;
                index.register(address(token));
            }
            uint256 prevIndex = index.latestIndex(address(token));
            uint256 prevMultiplier = token.uiMultiplier();
            if (r.effectiveAts[i] > block.timestamp) vm.warp(r.effectiveAts[i]);
            token.updateMultiplier(r.newMultipliers[i]);
            uint256 idx = index.sync(address(token));

            assertFalse(index.isFrozen(address(token)), r.symbols[i]);
            if (r.newMultipliers[i] == prevMultiplier) continue; // CRWD's split was announced twice
            if (idx > prevIndex) {
                ++dividends;
                // A dividend moves the index by exactly the multiplier step.
                assertApproxEqRel(idx * prevMultiplier / prevIndex, r.newMultipliers[i], 1e6, r.symbols[i]);
            } else {
                ++splitSteps;
                assertEq(keccak256(bytes(r.symbols[i])), keccak256("CRWD"));
                assertEq(r.newMultipliers[i], 4 * prevMultiplier);
            }
        }
        assertEq(dividends, 45, "dividends");
        assertEq(splitSteps, 1, "splits");
    }
}
