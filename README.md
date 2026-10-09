# PQC Receipt Anchor — post-quantum-signed x402 receipts, anchored on Arbitrum

**What it is:** a 100-line, ownerless, fundless, write-once Solidity contract (`PQCReceiptAnchor`) that
timestamps **ML-DSA-65 (NIST FIPS 204)**-signed [x402](https://x402.org) payment receipts on an Arbitrum
chain, plus an **offline verifier** that checks the post-quantum signature locally and the anchor against
*any* Arbitrum RPC — so a third party can prove, years from now, that *this* receipt for *this* payment
existed no later than block *N*, without trusting the issuer.

Built for the **Arbitrum Open House Singapore — Online Buildathon** (Oct 2026) on top of FractalAI's
production x402 notary (`https://fractalai.net.co/api/x402/witness`, npm `@fractalai/x402-pqc-witness`).

## Why

x402 proves a payment happened. A FractalAI receipt binds that payment to what was bought and signs the
binding with ML-DSA-65 — tamper-evident and safe against a future quantum adversary. But a signature alone
does not prove **when** the receipt existed: whoever holds the key could sign a back-dated receipt tomorrow.
The anchor closes that gap with 96 bytes per receipt on Arbitrum.

## What goes on-chain

| field | derivation | why |
|---|---|---|
| `receiptId` (bytes32) | `sha256(ML-DSA-65 signature bytes)` | unique per issued receipt; write-once |
| `payloadHash` (bytes32) | `sha256(exact bytes the signature covers)` — for a notary seal: `sha256(utf8(domain + "\n" + content_id))` | anyone recomputes it from the receipt |
| `kid` (bytes32) | `sha256(public_key_base64)[:16]` (8 bytes), left-aligned | the issuer's key-directory key id |
| `observedAt` (uint64) | issuer's signing time | claim only; contract rejects > 15 min in the future |

```solidity
function anchor(bytes32 receiptId, bytes32 payloadHash, bytes32 kid, uint64 observedAt) external;
function anchorBatch(bytes32[] receiptIds, bytes32[] payloadHashes, bytes32[] kids, uint64[] observedAts) external; // atomic
function anchoredAt(bytes32 receiptId) external view returns (uint64);   // 0 = never
event ReceiptAnchored(bytes32 indexed receiptId, bytes32 indexed payloadHash, bytes32 indexed kid,
                      uint64 observedAt, address anchoredBy, uint256 anchoredAt);
```

No owner. No roles. No ETH accepted (no `receive`/`fallback`). No upgrade. No external calls. The only state
transition is *unanchored → anchored*, once per `receiptId`. ~95k gas per anchor.

## Verify a receipt without trusting FractalAI

```bash
cd verifier && npm i
# full check: ML-DSA-65 signature + content_id + pinned key directory + on-chain event, via the public RPC
node src/verify-anchor.mjs receipt.json --rpc https://sepolia-rollup.arbitrum.io/rpc
# pin the anchoring EOA too, use your own RPC
node src/verify-anchor.mjs receipt.json --rpc https://arb-sepolia.g.alchemy.com/v2/$KEY --anchored-by 0x…
```

`receipt.json` is the JSON returned by `POST https://fractalai.net.co/api/x402/witness` (the `seal` object
now carries `anchor: { chain_id, contract, tx_hash, log_index, … }`). The verifier is fail-closed: `valid`
is true only if the signature verifies over the recomputed `content_id`, the key is in the trust list, the
RPC's chain id matches, and the on-chain `ReceiptAnchored` event for the recomputed `receiptId` carries the
same `payloadHash` and `kid`. Every negative path returns a `reason`.

By hand (what the verifier does internally):

```bash
jq -r .seal.signature receipt.json | base64 -d | sha256sum                       # receiptId
printf '%s\n%s' "$(jq -r .seal.domain receipt.json)" "$(jq -r .seal.content_id receipt.json)" | sha256sum   # payloadHash
printf '%s' "$(jq -r .seal.public_key receipt.json)" | sha256sum | cut -c1-16     # kid
curl -s -X POST https://sepolia-rollup.arbitrum.io/rpc -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,
 "method":"eth_getLogs","params":[{"address":"<CONTRACT>","fromBlock":"0x0","toBlock":"latest",
 "topics":["0x86069938b925599e2755e87e9b3242e8f6cbd24f2bc3d1ab52bc585d82646184","0x<receiptId>"]}]}'
```

The ML-DSA-65 signature itself: `ml_dsa65.verify(sig, utf8(domain + "\n" + content_id), publicKey)` with
[`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum). Public keys:
`https://fractalai.net.co/.well-known/x402-receipt-keys` (epoch-signed directory; pin it once).

## Deployments

| chain | chainId | address | tx |
|---|---|---|---|
| Arbitrum Sepolia | 421614 | see `deployments/PQCReceiptAnchor-421614.json` (PENDING at time of writing — testnet deployer `0x39db643192c0e81f2BC13883ad8c1a0e4060Bf63`) | — |
| Arbitrum One | 42161 | not yet | — |

```bash
npm i
PRIVATE_KEY=0x… npm run deploy:arbitrum-sepolia      # writes deployments/PQCReceiptAnchor-421614.json
npx hardhat verify --network arbitrumSepolia <address>
```

## Tests

```bash
npm i && npm test
# contract: 20 Hardhat cases — write-once, event shape, atomic batch, zero-value rejection, no owner/ETH,
#           future-skew bound, eth_getLogs lookup by receiptId, gas < 150k
# verifier: 15 node:test cases — REAL ML-DSA-65 keypairs/signatures, mocked JSON-RPC with the exact event
#           encoding; fail-closed on tampered body, untrusted key, wrong chain, wrong payloadHash/kid,
#           missing/reverted tx, duplicate events, pinned anchorer mismatch, low confirmations
```

## Honest limitations

- **Optional and best-effort** on the issuer side: a receipt without `anchor` is still a valid signed
  receipt. The anchor adds "existed by block N"; it does not strengthen the signature.
- **Testnet** today (Arbitrum Sepolia). Arbitrum One is the same script and ~$0.05 of gas.
- **Single anchorer** in practice (FractalAI's EOA). The contract accepts anyone; `anchoredBy` is
  informational unless you pin it.
- **ML-DSA-65 is verified off-chain.** The EVM does not verify FIPS 204; we anchor hashes. We do not claim
  "post-quantum signature verified on-chain". `@noble/post-quantum` implements FIPS 204 but is not a
  CMVP-validated module.
- **No external audit** of the contract, hook or verifier. The contract is deliberately minimal (one
  mapping, one event) to keep the attack surface near zero.
- **L2 confirmations ≠ L1 finality.** `minConfirmations` counts Arbitrum blocks; Ethereum finality follows.
- `observedAt` is an issuer claim; `anchoredAt` (block timestamp) is the fact.

## Layout

```
contracts/PQCReceiptAnchor.sol     the contract
test/PQCReceiptAnchor.test.js      20 Hardhat tests
scripts/deploy.js                  deploy + write deployments/PQCReceiptAnchor-<chainId>.json
verifier/src/verify-anchor.mjs     offline verifier + CLI (ML-DSA-65 + any Arbitrum RPC)
verifier/src/witness-core.mjs      verifySeal() — same code as @fractalai/x402-pqc-witness
verifier/test/                     15 verifier tests
```

License: MIT. Issuer-side integration (the Next.js hook that anchors every paid notary call) lives in
FractalAI's private monorepo; the public npm package `@fractalai/x402-pqc-witness` ships the verifier as
`./verify-anchor` from version 0.1.4.


## Deployed — Arbitrum One mainnet (2026-10-03, verified on-chain)

| Item | Value |
|---|---|
| Contract `PQCReceiptAnchor` | `0x3A23c614033cb22139DC13932524767c5fE841d8` — https://arbiscan.io/address/0x3A23c614033cb22139DC13932524767c5fE841d8 |
| Deploy tx | `0xb42b8df36438a195fc629e15926142dea386aa9fc6ca597c982c9fc0fb0aff44` (block 511335138, deployer `0xC13789e82661635d9Cea38a53A0390CF9939ef4f`, ≈0.0000146 ETH max cost) |
| First anchored receipt | MIDAS alert receipt `fe62b072c2740e7a8d10cf7e643905b7d79f3f9b19f1c3970fc8754f18d538ee` → `receiptId 0xb9b47ba81d30d95a087ac40b4d7c1c07816148251c147121e7c4aac477cd94eb`, `payloadHash 0xef737f1ca8d99fabf58a81373188cc349183bfc8976c1ae3d3861238b498e065`, `kid 0x86c139c960bb274c…` (= active key in the directory), `observedAt 1790473960` |
| Anchor tx | `0x37f0254389deed3953aa44333e32eaeb466f28ff41ac9299eb5285599a7a1174` (block 511335916, logIndex 5, 138,288 gas ≈ 0.0000028 ETH) — https://arbiscan.io/tx/0x37f0254389deed3953aa44333e32eaeb466f28ff41ac9299eb5285599a7a1174 |
| Source verification | pending (no `ARBISCAN_KEY` in this environment): `cd smart-contracts && ARBISCAN_KEY=… npx hardhat verify --network arbitrumOne 0x3A23c614033cb22139DC13932524767c5fE841d8` |

Re-check from any machine: `getAnchor(0xb9b47ba8…94eb)` on the contract returns the payloadHash/kid/observedAt above; the receipt itself is public at https://fractalai.net.co/api/midas/alerts/receipt/fe62b072c2740e7a8d10cf7e643905b7d79f3f9b19f1c3970fc8754f18d538ee and verifies in the browser at https://fractalai.net.co/midas/proof. Arbitrum Sepolia was not used (no faucet accepted a fresh wallet); mainnet gas was cheaper than the time.
