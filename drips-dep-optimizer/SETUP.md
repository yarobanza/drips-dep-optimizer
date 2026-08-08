# SETUP.md

This document has two jobs:

1. Explain, honestly, what we found when investigating what's actually
   possible via Drips Network's public interfaces — before writing a line
   of matching/split code — and what that means for this tool's design.
2. Get you running locally.

## 1. What we investigated

The task brief asked us to check for a public Drips API (`api.drips.network`
or similar) by inspecting drips.network's own network requests, and to use
it if available. Here's what that investigation turned up, using Drips'
own public GitHub repositories (`drips-network/*`) as the source of truth,
since that's more durable than a one-time devtools network trace:

### Read path: a public, read-only GraphQL API exists

- `drips-network/graphql-api` is a NestJS GraphQL service that sits in front
  of `drips-network/events-processor`, a read-only indexer that ingests
  on-chain Drips protocol events plus IPFS metadata into Postgres. Its own
  README describes it as providing "a single, convenient and fast endpoint
  for querying decentralized data within the Drips Network."
- This is the same data source the drips.network web app itself queries to
  render project pages, funding totals, and split graphs — i.e. it's not a
  side project, it's the app's own backend.
- Both `events-processor` and `graphql-api` are explicitly documented as
  "read-only": Ethereum and IPFS remain the source of truth, and anyone can
  self-host an instance and reach the same state as the production one.
- **This tool defaults to `https://api.drips.network/graphql`** for reads
  (project lookup by GitHub URL, claim status). This default is our best
  inference from the repo's stated purpose and Drips' own domain naming —
  **we could not 100% pin down the exact production hostname/path from
  outside a browser session**, since it isn't published as a versioned,
  documented endpoint. **Please verify it yourself before relying on this
  in anger**: open https://www.drips.network in a browser, open DevTools →
  Network, filter for `graphql`, and watch the request made when you view
  any project page. If the hostname differs, override it with:

  ```bash
  export DRIPS_GRAPHQL_URL="https://whatever-it-actually-is/graphql"
  ```

  The CLI ships a `drips-dep-optimizer doctor` command specifically to make
  this easy to check and fix without reading code.

- Because we could not verify the exact endpoint from this environment, the
  client (`src/drips/client.ts`) is written to **fail gracefully and
  loudly**: if the endpoint is wrong or unreachable, the CLI prints a clear
  warning, reports zero matches, and exits cleanly rather than silently
  producing a bogus split config.

### Write path: there is no public API for setting splits — and there
### can't sensibly be one

- We looked for any mutation-style endpoint (REST or GraphQL) that would let
  a third party set or propose a split on a project's behalf. There isn't
  one, and the reason is structural, not an oversight: splits are an
  on-chain authorization. Setting a split means the *claimed maintainer's
  wallet* signs a transaction against the Drips protocol contracts (see
  `drips-network/sdk`, the official TypeScript SDK for interacting with
  those contracts, and `drips-network/contracts`). An API that let anyone
  set someone else's splits would defeat the entire trust model.
- The only legitimate ways to actually apply a split are:
  1. Through the Drips web app UI, connecting the wallet that claimed the
     project, or
  2. Programmatically via `@drips-network/sdk`, but still requiring a
     signer for the claiming wallet — i.e. this is "automatable" only in
     the sense that *the maintainer* could script it for *their own*
     project, not that a third-party tool can set it for them.
- **Conclusion for this tool**: we generate a ready-to-use split
  configuration as structured JSON (account IDs, URLs, percentages,
  rationale) plus a human-readable Markdown checklist for applying it
  through the Drips UI. We do not attempt to fake automation here — seeing
  no available API call to set a split and building browser automation
  around it felt like the wrong trade-off for a v0.1, and out of step with
  why Drips designed it this way. This could change later — see the
  "SDK-assisted apply" issue in the issue tracker.

### What this means for the README's "automated vs manual" framing

| Step | Automated? |
|---|---|
| Parse `package.json`/`Cargo.toml` + lockfile, resolve full dependency tree | Fully automated |
| Map package name to GitHub repo (via npm registry / crates.io metadata) | Fully automated |
| Check whether that repo has a claimed Drips project | Fully automated (read-only GraphQL) |
| Score criticality (direct/transitive, fan-in, core-infra heuristics) | Fully automated, deterministic |
| Turn scores into a suggested percentage split | Automated; optionally refined by an LLM if `ANTHROPIC_API_KEY` is set |
| Generate a ready-to-use split config (JSON) | Fully automated |
| Actually apply the split on-chain | Guided-manual — requires the claiming maintainer's wallet signature via the Drips UI (instructions generated for you) |

## 2. Local development setup

Requirements: Node.js >= 18.

```bash
git clone <this-repo>
cd drips-dep-optimizer
npm install
npm run build
npm test
```

Run against a project directly with `tsx` (no build needed):

```bash
npm run start -- analyze /path/to/some/project
```

Or after building:

```bash
node dist/cli.js analyze /path/to/some/project
```

Check Drips API connectivity:

```bash
node dist/cli.js doctor
```

### Environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `DRIPS_GRAPHQL_URL` | Override the Drips GraphQL endpoint | No — defaults to `https://api.drips.network/graphql` |
| `ANTHROPIC_API_KEY` | Enables LLM-refined rationale/percentage nudging | No — falls back to deterministic heuristics if unset |

### Testing philosophy

All tests are fully offline and deterministic:

- Dependency resolution is tested against **real, checked-in**
  `package-lock.json` (generated via `npm install --package-lock-only`
  against real packages: `express`, `lodash`, `chalk`) and a hand-verified
  `Cargo.lock` (real crates: `serde`, `tokio`, `anyhow`, and their actual
  transitive deps at the time of writing).
- All Drips API and package-registry calls are mocked at the `fetch` layer,
  so tests never depend on network access, don't hit rate limits, and don't
  break if `api.drips.network`'s schema changes.
- `tests/integration.test.ts` runs the full pipeline — resolve, match,
  score, write files — end to end against the real fixture tree, and
  asserts on the actual JSON/Markdown that gets written to disk.

See `README.md` for the project pitch and `ISSUES.md` for the scoped
follow-up work.
