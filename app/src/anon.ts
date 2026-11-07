/**
 * Anon-RPC routes. Every chain call the app makes goes through `route.fetch`, so the RPC
 * provider and the alt-mempool node see an exit relay, not the user's IP.
 *
 * Specifiers and the tor-js gateway are from anon-rpc's adopters.json5
 * (https://github.com/ethereum/anon-rpc at ae7e697a). The specifiers live on mainnet, so the
 * harness reads them once through a bootstrap provider. That one read is not anonymized; it
 * reveals only that this browser loads an anon-rpc worker.
 */

import { AnonRpcWorker } from "@anon-rpc/browser-harness";
import type { FetchLike } from "../../lib/src/client.ts";

export type RouteId = "tor-js" | "nox" | "nym" | "passthrough" | "direct";

type WorkerConfig = ConstructorParameters<typeof AnonRpcWorker>[0]["config"];

interface RouteSpec {
  label: string;
  specifier?: `0x${string}`;
  config?: WorkerConfig;
  /** RPC that holds the specifier contract. Mainnet unless the adopters entry says otherwise. */
  bootstrap?: string;
  anonymizes: boolean;
}

export const ROUTES: Record<RouteId, RouteSpec> = {
  "tor-js": {
    label: "tor-js (Tor)",
    specifier: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
    config: { gateways: ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"] },
    anonymizes: true,
  },
  // The specifier lives on Sepolia (adopters.json5 chainId 11155111); the fetch can reach
  // any chain. TLS to the RPC runs inside the worker, so the exit relays it unread.
  nox: {
    label: "Nox (Sphinx mixnet, default)",
    specifier: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A",
    bootstrap: "https://ethereum-sepolia-rpc.publicnode.com",
    anonymizes: true,
  },
  nym: { label: "Nym mixnet", specifier: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0", anonymizes: true },
  passthrough: {
    label: "passthrough (sandbox only, not anonymous)",
    specifier: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27",
    anonymizes: false,
  },
  direct: { label: "direct (Anon-RPC off, for comparison)", anonymizes: false },
};

/** Mainnet, for the one specifier read. */
const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";

export interface Route {
  id: RouteId;
  fetch: FetchLike;
  ready: Promise<void>;
  close(): void;
}

export function openRoute(id: RouteId): Route {
  const spec = ROUTES[id];
  if (!spec.specifier) {
    return { id, fetch: (url, init) => fetch(url, init), ready: Promise.resolve(), close() {} };
  }
  const worker = new AnonRpcWorker({
    address: spec.specifier,
    config: spec.config,
    preExisting: {
      rpcProvider: {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          const res = await fetch(spec.bootstrap ?? BOOTSTRAP_RPC, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
          });
          const body = await res.json();
          if (body.error) throw new Error(body.error.message);
          return body.result;
        },
      },
    },
  });
  return { id, fetch: worker.fetch, ready: worker.ready, close: () => worker.close() };
}
