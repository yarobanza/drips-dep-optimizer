# Follow-up issues

These are scoped to be opened as individual GitHub issues. Each has a rough
size estimate and acceptance criteria so they're pickable by a new
contributor.

---

### 1. Support Python (pip/poetry) and Go dependency trees

**Size:** M
Add resolvers analogous to `src/resolvers/npm.ts` / `cargo.ts` for:
- Python: parse `pyproject.toml` (PEP 621 / Poetry) direct deps, and
  `poetry.lock` or `requirements.txt` + a resolved `pip freeze`-style lock
  for transitives. Map package name → PyPI → GitHub repo via PyPI's JSON API
  (`pypi.org/pypi/<name>/json`, which exposes `project_urls`).
- Go: parse `go.mod` for direct deps and `go.sum` for the full resolved set;
  Go module paths are frequently already `github.com/...`, so this one
  should need the least repo-guessing.

**Acceptance criteria:**
- `resolveEcosystemTree()` dispatch in `cli.ts` picks Python/Go automatically
  when `pyproject.toml`/`go.mod` is present.
- Unit tests against real, checked-in lockfiles, mirroring the existing npm
  and cargo test structure.

---

### 2. GitHub Action to auto-suggest split updates on dependency changes

**Size:** M
A reusable GitHub Action (composite or Docker) that runs
`drips-dep-optimizer analyze` on PRs that touch `package.json`/`Cargo.toml`/
lockfiles, and posts a PR comment summarizing what changed in the suggested
split (new matches, dropped matches, percentage deltas) since the last run
(diffing against a committed `drips-split-config.json`).

**Acceptance criteria:**
- `action.yml` at repo root, published under a `v1` tag.
- Comments are idempotent (edits the existing bot comment instead of
  spamming new ones on each push).
- Documented in README under a "CI usage" section.

---

### 3. Visualize the dependency-funding graph

**Size:** M
Add an `drips-dep-optimizer analyze --graph` flag that emits an SVG/HTML
graph (e.g. via `d3` or a simple Graphviz DOT export) showing the dependency
tree with funded-on-Drips nodes highlighted, edge thickness proportional to
suggested split percentage, and unmatched nodes dimmed.

**Acceptance criteria:**
- Works fully offline given an already-generated `drips-split-config.json`
  (i.e. decoupled from the network calls, so it's easy to test).
- Snapshot-style test asserting the DOT/SVG output contains expected node
  count and key edges for the fixture project.

---

### 4. Monorepo / workspace resolution

**Size:** L
Support npm/yarn/pnpm workspaces and Cargo workspaces: discover member
packages, resolve each member's dependency tree, and either (a) produce one
merged split config for the whole repo, or (b) produce one per workspace
member, selectable via a `--workspace <name>` flag.

**Acceptance criteria:**
- Detects workspace roots (`workspaces` field in package.json, `pnpm-workspace.yaml`,
  Cargo `[workspace]` table).
- A fixture monorepo (checked into `examples/`) with 2+ members and at least
  one shared dependency, with tests asserting the merged tree dedupes
  correctly and attributes fan-in across members.

---

### 5. Historical tracking of split changes over time

**Size:** S/M
Add a `drips-dep-optimizer diff` command that compares a newly generated
`drips-split-config.json` against a previously committed one and prints a
human-readable changelog (percentage deltas, newly matched/unmatched deps).
Optionally append to a `SPLIT_HISTORY.md` file with a dated entry, so repos
using this tool build up an auditable record of how their funding
priorities shifted as their dependency tree evolved.

**Acceptance criteria:**
- `diff` command with unit tests covering: no previous file (first run),
  identical configs (no-op), and a config with additions/removals/percentage
  changes.
- `--history` flag on `analyze` that appends to `SPLIT_HISTORY.md`
  automatically.

---

### 6. SDK-assisted apply flow (for maintainers only)

**Size:** L
For the case where the person running the CLI *is* the claimed maintainer
of the source project, add an opt-in `drips-dep-optimizer apply` command
that uses `@drips-network/sdk` to build (but not silently send) the
on-chain split-setting transaction, prompts for explicit confirmation, and
submits it using a wallet connection (e.g. via `wagmi`/`viem` with a local
signer or WalletConnect). This is intentionally separate from `analyze`
and off by default, per the investigation in `SETUP.md` — it should never
be capable of setting a split for a project the invoking wallet hasn't
claimed, since the contracts themselves enforce that, but the UX should
make the authorization boundary explicit anyway.

**Acceptance criteria:**
- Dry-run mode by default; requires `--yes` to actually broadcast.
- Integration test against a local anvil/hardhat fork of the Drips
  contracts (or documented as manual-only if that's impractical for CI).
- README section clearly marking this as an advanced, maintainer-only
  feature, distinct from the guided-manual default flow.

---

### 7. Confirm and pin the production Drips GraphQL endpoint

**Size:** XS
`SETUP.md` documents that we inferred `https://api.drips.network/graphql`
from Drips' own repo READMEs but couldn't verify the exact hostname from
outside a browser session. This issue is just: capture a real DevTools
network trace from drips.network, confirm (or correct) the endpoint and any
required headers, and update the default + `SETUP.md` accordingly. Good
first issue for someone from the Drips team or anyone with five minutes and
a browser.
