# KYA-OS Agent Dashboard

A learning project: a small, end-to-end demo built to understand what [`@kya-os/mcp`](https://github.com/decentralized-identity/kya-os-mcp) can do. It exercises the whole stack, **identity → authority → accountability → revocation**, through one MCP server, one scripted agent and a live dashboard.

> Unofficial and not affiliated with the KYA-OS project. Demo-grade code: in-memory state, keys stored on disk, no auth on the API. Do not use it as a production reference.

## The scenario

A tiny "Team Tasks" MCP server that an AI agent uses on behalf of a human (the _Responsible Party_, you).

| Tool          | Access    | Scope          |
| ------------- | --------- | -------------- |
| `list_tasks`  | public    | none           |
| `add_task`    | delegated | `tasks:write`  |
| `delete_task` | delegated | `tasks:delete` |

## What the demo shows

1. **Identity.** The agent, the server and the human each have a `did:key`. Every call carries a signed request proof, and every result a signed response proof.
2. **Authority.** A protected call is refused until the human approves. Approving issues a delegation credential (VC-JWT) **signed by the human's key**, scoped to one tool and expiring in 10 minutes. The server only trusts the human's DID as a root issuer.
3. **Holder of key.** The agent proves possession of its own key on every call, so an approved grant can't be replayed by someone who merely knows its DID.
4. **Revocation.** Revoking a delegation flips a StatusList2021 bit, and the very next call is refused.
5. **Accountability.** Every call and decision is written to a signed audit journal that can be sealed into a Merkle checkpoint.

## Run it

Requires Node 20+.

```bash
npm install
npm run server   # MCP at :3002/mcp, API at :3002/api
npm run web      # dashboard at http://localhost:5173
```

Open the dashboard and click **Run demo**, then:

1. Approve the `add_task` card (`tasks:write`).
2. Approve the `delete_task` card (`tasks:delete`), a separate consent because it is a separate scope.
3. Click **Revoke** on the `tasks:write` delegation. The agent's next `add_task` is refused.
4. Click **Seal checkpoint**.
5. Click any row to open the proof drawer, which decodes the JWS and re-verifies it on the server.

Headless variant (the script plays the human too): start the server, then `cd agent && npx tsx src/index.ts --auto`.

## Where to look

| File                        | What it demonstrates                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `server/src/mcp.ts`         | `createKyaOsMiddleware`, `wrapWithProof`, `wrapWithDelegation`, the low-level `Server` API |
| `server/src/index.ts`       | `createKyaOsTransport` (required since 1.20) and a tap that publishes proofs               |
| `server/src/delegations.ts` | `DelegationCredentialIssuer`, VC-JWT, `StatusList2021Manager` with gzip                    |
| `server/src/consent.ts`     | Pending challenges, approving into an agent-anchored `GrantStore` grant                    |
| `server/src/audit.ts`       | Signed audit journal and Merkle checkpoints                                                |
| `server/src/api.ts`         | REST + SSE for the dashboard, proof re-verification with `ProofVerifier`                   |
| `agent/src/index.ts`        | A holder-of-key agent: `generateRequestProof` on every call                                |
| `proxy/src/index.ts`        | A stdio MCP server that signs calls for hosts that cannot (Claude Desktop)                 |
| `web/src/state.ts`          | The UI as a projection of one server event log                                             |

## Layout

```
server/   MCP server, dashboard API, event bus
agent/    scripted demo agent with its own DID
proxy/    stdio signing proxy for Claude Desktop
web/      Vite + React + Tailwind dashboard
shared/   event and DTO types shared by server and web
```

## Caveats

- Identities are generated and stored in `.kya-os/` (git-ignored, mode 0600). The human's and the agent's keys live on the server for demo simplicity. In a real system each would stay on its owner's device.
- Everything is in memory, so a restart clears tasks, delegations and the audit log. Keys survive.
- The library cannot tell "never authorized" from "revoked": both produce a fresh consent challenge. The dashboard labels the revoked case itself.
