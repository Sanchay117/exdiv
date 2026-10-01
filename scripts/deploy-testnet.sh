#!/usr/bin/env bash
# Deploys Exdiv to Robinhood Chain testnet end to end: contracts (verified on Blockscout), ABIs and addresses into
# the app, keeper run, and order-book seeding. Reads PRIVATE_KEY from contracts/.env.
#
#   scripts/deploy-testnet.sh            # deploy
#   scripts/deploy-testnet.sh --bridge   # first bridge Sepolia ETH from the same key into Robinhood testnet
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source contracts/.env; set +a

RH_RPC=${RH_TESTNET_RPC:-https://rpc.testnet.chain.robinhood.com}
SEPOLIA_RPC=${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}
INBOX=0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4   # Robinhood testnet delayed inbox on Sepolia
DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")

if [[ "${1:-}" == "--bridge" ]]; then
  BAL=$(cast balance "$DEPLOYER" --rpc-url "$SEPOLIA_RPC")
  SEND=$(python3 -c "print(max(0, $BAL - 3 * 10**15))")   # keep 0.003 ETH for Sepolia gas
  echo "bridging $SEND wei from Sepolia"
  cast send "$INBOX" "depositEth()" --value "$SEND" --private-key "$PRIVATE_KEY" --rpc-url "$SEPOLIA_RPC"
  echo "waiting for the deposit on Robinhood testnet (usually 10 to 15 minutes)"
  until [[ "$(cast balance "$DEPLOYER" --rpc-url "$RH_RPC")" != "0" ]]; do sleep 20; done
fi

echo "deployer $DEPLOYER: $(cast balance "$DEPLOYER" --rpc-url "$RH_RPC" --ether) ETH on Robinhood testnet"
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$RH_RPC" --broadcast --slow \
  --verify --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/)
node scripts/export-abis.ts
node scripts/keeper.ts
node scripts/market-maker.ts
echo "done: addresses in contracts/deployments/robinhood-testnet.json"
