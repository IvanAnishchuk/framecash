# framecash tasks. `just` lists them. Run from the repo root.
#
# Builds are bounded to 2 jobs: forge and go both default to every core.

set shell := ["bash", "-euo", "pipefail", "-c"]

cli := "node cli/src/main.ts"

default:
    @just --list --unsorted

# --- install and check -----------------------------------------------------------------

# Install every Node package. The library first: the others import it by path.
install:
    npm install --prefix lib --no-audit --no-fund
    npm install --prefix cli --no-audit --no-fund
    npm install --prefix app --no-audit --no-fund

# Every suite: Solidity (with TypeScript vectors over FFI), TypeScript, Go.
test: build
    forge test --root contracts
    node --test lib/test/*.test.ts
    npx --prefix lib tsc --noEmit -p lib
    npx --prefix cli tsc --noEmit -p cli
    npx --prefix app tsc --noEmit -p app
    cd workflow && GOMAXPROCS=2 nice -n19 go test -p 2 ./mint/ ./announce/ -count=1

build:
    forge build --root contracts --quiet

# The CRE workflow's wasm target, without running it.
build-wasm:
    cd workflow && GOMAXPROCS=2 GOOS=wasip1 GOARCH=wasm nice -n19 go build -p 2 -o /dev/null ./blindmint/

# --- the protocol on the devnet ------------------------------------------------------------

# Throwaway keys into .env, funded from the devnet's shared genesis key.
init:
    {{ cli }} init

# Deploy and stake a pool. Resets the CLI wallet in .tmp/framecash.json.
deploy: build
    {{ cli }} deploy

deposit amount:
    {{ cli }} deposit {{ amount }}

# The local mint: answer every pending deposit once.
mint:
    {{ cli }} mint

# The local mint as a service.
mint-watch:
    {{ cli }} mint --watch

sync:
    {{ cli }} sync

pay to amount:
    {{ cli }} pay {{ to }} {{ amount }}

status:
    {{ cli }} status

# init, deploy, deposit, mint, sync, pay, mint the change, restore from the seed.
demo: build
    {{ cli }} demo

# --- the browser app ------------------------------------------------------------------

# http://localhost:5173 (tor-js), or ?route=nym, ?route=passthrough, ?route=direct.
# Run `just cre-mint` beside it so deposits to the CRE pool get minted.
app:
    npx --prefix app vite app --port 5173

# --- the CRE mint ---------------------------------------------------------------------

# workflow/.env from the root .env: the same mint keys as the local mint.
workflow-env:
    {{ cli }} workflow-env

# Deploy a DevnetForwarder and a pool that trusts it, for the CRE mint. Then put the two
# addresses in workflow/project.yaml and workflow/blindmint/config.devnet.json.
deploy-cre: build
    {{ cli }} deploy --cre

# Simulate the CRE mint on one deposit tx. INDEX is the Deposited log's index in that tx
# (a value-carrying tx emits an EIP-7708 Transfer log first; in a payment the change
# deposit is log 1). Needs `cre login`. The CLI reads project.yaml from the working
# directory, so this runs inside workflow/.
cre-mint-once tx index="1": workflow-env
    cd workflow && GOMAXPROCS=2 nice -n19 cre workflow simulate blindmint -e .env -T devnet-settings \
        --allow-unknown-chains --non-interactive --broadcast --trigger-index 0 \
        --evm-tx-hash {{ tx }} --evm-event-index {{ index }}

# The CRE mint as a service: fires on each Deposited log. Needs `cre login`.
cre-mint: workflow-env
    cd workflow && GOMAXPROCS=2 nice -n19 cre workflow simulate blindmint -e .env -T devnet-settings \
        --allow-unknown-chains --non-interactive --broadcast --listen --trigger-index 0
