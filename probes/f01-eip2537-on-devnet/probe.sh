#!/usr/bin/env bash
# F1 probe: are the EIP-2537 precompiles live on the devnet? Known-answer inputs:
#   0x0b G1ADD(inf, inf)           -> 128 zero bytes
#   0x0d G2ADD(inf, inf)           -> 256 zero bytes
#   0x0f PAIRING((inf, inf))       -> 1
#   0x11 MAP_FP2_TO_G2(0)          -> a fixed non-zero point
# and the gas eth_estimateGas reports for each call (base tx included).
set -euo pipefail
rpc="${ETHREX_URL:-https://altmempool.forshtat.com}"
zeros() { printf '0%.0s' $(seq 1 "$1"); }

echo "client $(cast rpc web3_clientVersion --rpc-url "$rpc")"
for spec in "0x0b:$(zeros 512)" "0x0d:$(zeros 1024)" "0x0f:$(zeros 768)" "0x11:$(zeros 256)"; do
    addr="$(printf '0x%040x' $((${spec%%:*})))"
    data="0x${spec#*:}"
    echo "${spec%%:*} out $(cast call "$addr" "$data" --rpc-url "$rpc")"
    echo "${spec%%:*} gas $(cast estimate "$addr" "$data" --rpc-url "$rpc")"
done
