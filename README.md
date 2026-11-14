# BuilderOS web app

The frontend for BuilderOS: describe a product, review the plan, launch a company on NEAR, and watch teams of AI agents build it on budgets you control.

Built against API contract `2026-11-13` (`docs/API-CONTRACT.md` in the backend repo). If this app and the contract disagree, the contract wins.

## Run it

```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_PRIVY_APP_ID for Google / email sign-in
npm run dev                    # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | BuilderOS API. Defaults to the testnet deployment. |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` or `mainnet`. |
| `NEXT_PUBLIC_NEAR_RPC_URL` | RPC used to broadcast transactions signed by the Privy wallet. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Enables Google and email sign-in. Empty = NEAR wallet only (the Privy SDK is not even downloaded). |
| `NEXT_PUBLIC_TEST_SIGNER` | End-to-end tests only. Never set it in a deployed build. |

The backend must allow the app's origin (CORS) and, for Privy sign-in, have the same `PRIVY_APP_ID`.

## Checks

```bash
npm run typecheck
npm run build
npm run test:e2e     # 45 end-to-end tests: desktop + phone
```

The end-to-end run builds the app against `tests/mock-api` (the contract's shapes with a simulated chain) and signs with a throwaway in-browser key. It never touches testnet. It uses the Chrome installed on the machine; to use Playwright's own browser, run `npx playwright install chromium` and remove `channel` in `playwright.config.ts`.

## How it is put together

```
src/app/         routes: landing, account pages, /c/[slug]/… workspace, /demo, /invite, alert-link redirects
src/features/    one file per area: auth, home, drafts, launch, dashboard, teams, work, approvals, money,
                 members, settings, inbox, invites, account, workspace (the company frame)
src/components/  design system: ui (buttons, panels, dialogs, states), charts, shell, singularity
src/api/         typed client: Bearer token, Idempotency-Key, error envelope → ApiError; one function per endpoint
src/data/        workspace data source: the API for a real company, the /v1/demo payload for the sample one
src/wallet/      one Signer interface (Privy, NEAR wallet-selector, test key), the signing sheet, device keys
src/stream/      one SSE connection per tab, resume from the last event id, event → cache invalidation
src/lib/         money (BigInt, micro-USDC), formatting, access helpers
```

Rules the code holds to:

- **The server decides access.** Pages render what the API returns: a `null` section is not drawn, a 403 becomes "Ask the founder". `lib/access.ts` only hides buttons. Nothing about access is read from browser storage.
- **The wallet signs; the backend never moves money.** Every write goes through `useWrite` / `useSign`: call the API, sign `transactions[]` in order in the signing sheet, wait for the chain, then refetch. A retry of the same click reuses its `Idempotency-Key`.
- **Home is never behind setup.** Sign-in lands on Home; setup is a dismissable progress card.
- **Money is integer micro-USDC strings.** All math is `BigInt` (`lib/money.ts`); numbers are formatted only for display.
- **The demo is the real app.** `/demo` renders the same pages through a demo data source, with every action disabled.

## The black hole

The company is drawn as a black hole (`components/singularity.tsx`, a ray-marched WebGL shader with a CSS fallback), and it means the same thing everywhere it appears: the budget is the mass, teams and agents orbit it, and the spending cap is the horizon nothing passes.

- Landing and sign-in: the full scene, with teams as bodies in orbit.
- Launch: the disk gathers while the company is created, and each team takes its orbit once it exists on chain.
- Daily cap: the horizon gauge fills as today's spend approaches the cap.
- Paused: the mark cools to blue wherever spending is frozen.

It drops resolution, then frame rate, on slow GPUs, pauses off-screen, and renders a single frame when the system asks for reduced motion.

## Before going live

1. Create the Privy app, enable NEAR embedded wallets, and set `NEXT_PUBLIC_PRIVY_APP_ID` (and `PRIVY_APP_ID` on the API).
2. Add the deployed origin to the API's CORS allow-list.
3. Run through sign-in, launch and an approval on testnet: the end-to-end suite proves the app against the contract's shapes, not against live testnet or the real Privy and wallet-selector SDKs.
