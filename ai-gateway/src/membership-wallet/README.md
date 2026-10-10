# Membership wallet verification

This is a read-only mainnet payment verifier, not a wallet, signing service,
exchange integration or refund processor. All financial fixtures in tests are
synthetic. No private key, seed phrase or signing API is used.

New invoices require **both** `MEMBERSHIP_WALLET_ENABLED=true` at the Edge
function and SQL wallet settings with an explicitly configured, enabled public
receiving address. Missing receiving addresses remain closed. An old Stripe
order is never converted into a chain order, and Stripe constraints remain intact.

The worker exports `runMembershipWalletVerificationCycle` from `worker.ts`.
It takes the existing service-only database client, deployment environment,
worker identifier, and optional injected `fetch`/clock. Each bounded batch has
a two-minute SQL lease; stale leases cannot be applied or settled. Unknown DB
acknowledgements are left for idempotent lease recovery, not compensated with a
contradictory failure. HTTP calls are abortable, limited to 8 seconds and 2 MiB,
and reject redirects. Retriable node outages/finality delays retain the claim
and use bounded exponential/provider backoff. Clear mismatches require review.

Deployment environment:

- `MEMBERSHIP_WALLET_ENABLED`: defaults to false.
- `MEMBERSHIP_WALLET_ETHEREUM_RPC_URL`, `MEMBERSHIP_WALLET_BASE_RPC_URL`:
  deployment-only HTTPS URLs, normal port 443, no basic authentication/fragment.
- `MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS`: comma-separated exact hostnames for
  those URLs; no wildcard/prefix match or local/IP hostnames. Secret URL paths
  or query parameters are never returned in errors.
- `MEMBERSHIP_WALLET_TRONGRID_API_KEY`: optional server-only API header;
  TRON reads are fixed to `https://api.trongrid.io/walletsolidity/`.
- `MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE`: defaults to 2, bounded 1–10.

Each supported route has pinned issuer contract identity and six-decimal atomic
units. Ethereum and Base independently check chain IDs 1 and 8453. A payment
requires a successful receipt, an actual matching issuer-emitted `Transfer`
event, an exact recipient and exact invoice amount, a canonical transaction/block,
and finalized/solidified state. The receipt is re-read before producing evidence.
Event identity uses the transaction-local receipt-log index, not EVM block-global
`logIndex`. Amounts are decimal strings/BigInt; calldata, ticker labels, client
`verified` flags, screenshots and a hash merely existing cannot authorize VIP.

The unique decimal invoice amount is allocated by SQL and never reused; this is
an explicit payment-attribution policy, not wallet ownership proof. Browser
claims are authenticated and invoice-owner-scoped, and globally unique transfer
receipts plus lease checks are enforced again by the settlement transaction.
Under/overpayments, split payments and out-of-window transfers do not silently
grant membership or trigger refunds. A transfer paid in the invoice window may
complete verification after invoice expiry. Finality does not substitute for a
correct asset/address/amount.

The verifier relies on trusted deployment node responses; it is not a light
client or continuous re-auditor of already-granted finalized payments. Exceptional
post-finality chain contradictions require operator review and an auditable
payment-policy decision, not automatic fund movements or edits to unrelated
membership grants.

Protocol sources:

- [TRON confirmation semantics](https://developers.tron.network/docs/confirmation-semantics):
  FullNode inclusion is not solidification; execution success must be checked
  separately from availability of a solidified receipt.
- [TRON event log ABI](https://developers.tron.network/docs/event): issuer address
  and indexed recipient/value are decoded from actual receipt logs.
- [TRON account address formats](https://developers.tron.network/docs/account):
  21-byte `41` prefix and Base58Check public addresses.
- [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/):
  receipt status and the `finalized` block tag.

Offline checks:

```sh
node --test ai-gateway/test/membership-wallet.test.ts
node --test tests/membership-wallet-functions.test.mjs
pnpm --dir ai-gateway typecheck
```
