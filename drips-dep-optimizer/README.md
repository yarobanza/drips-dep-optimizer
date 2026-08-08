# drips-dep-optimizer

A CLI that reads your project's dependency tree, checks which of your
dependencies are already receiving [Drips](https://www.drips.network)
funding, and generates a ready-to-use suggested funding split — so
supporting the open-source you depend on takes minutes, not a spreadsheet.

Built as complementary tooling for the
[Drips Wave: Stellar Program](https://www.drips.network/wave/stellar) — it's
not a replacement for the Drips app, it's the "figure out what to fund and
roughly how much" step that currently has to be done by hand.

```
$ drips-dep-optimizer analyze .

drips-dep-optimizer — analyzing /Users/you/my-app (npm)

Resolved 214 dependencies (12 direct, 202 transitive).
Cross-referencing against Drips Network...
  checked 214/214

Found 9 dependencies already funded on Drips (205 not matched).
Generating split suggestions...

Done.
  ./drips-split-output/drips-split-config.json
  ./drips-split-output/SETUP_INSTRUCTIONS.md

Note: applying the split still requires a signed on-chain transaction from
the claimed maintainer via the Drips app — see SETUP_INSTRUCTIONS.md.
```

## What it does

1. **Resolves your full dependency tree** — direct and transitive — from
   `package.json` + `package-lock.json` (npm) or `Cargo.toml` + `Cargo.lock`
   (Cargo).
2. **Cross-references every dependency against Drips Network**, via package
   registry metadata (npm registry / crates.io) → GitHub repo → Drips'
   public read-only GraphQL API, to find which ones are already claimed and
   fundable on Drips.
3. **Scores each match's criticality** using transparent, deterministic
   heuristics: direct vs. transitive, how many other in-tree packages depend
   on it (fan-in), and whether it looks like core infrastructure (a
   runtime/framework/SDK) vs. a small utility.
4. **Optionally refines those scores with an LLM** (Claude, via the
   Anthropic API) for a short human-readable rationale per dependency and
   small, bounded percentage nudges — only if you set `ANTHROPIC_API_KEY`.
   Works fine without it; you just get the deterministic heuristic scores
   and a heuristic-based rationale instead.
5. **Writes a ready-to-use split config**: a JSON file with account IDs,
   URLs, and percentages, plus a Markdown checklist for applying it in the
   Drips UI.

## What's automated vs. what's guided-manual

This matters enough that we wrote it up properly — see
[`SETUP.md`](./SETUP.md) for the full investigation notes on what Drips'
public interfaces actually expose. Short version:

- Everything through **generating the split config is fully automated**:
  dependency resolution, Drips matching, criticality scoring, percentage
  suggestions, and file output.
- **Applying the split is guided-manual**, not automated, because Drips has
  no public API for setting splits — and structurally can't, since a split
  is an on-chain authorization that only the claimed maintainer's wallet can
  sign. We generate a step-by-step checklist for the Drips UI instead of
  pretending otherwise.

## Installation

```bash
git clone https://github.com/<you>/drips-dep-optimizer
cd drips-dep-optimizer
npm install
npm run build
npm link   # optional, for a global `drips-dep-optimizer` command
```

Requires Node.js >= 18.

## Usage

```bash
# Analyze the current directory (auto-detects npm vs Cargo)
drips-dep-optimizer analyze .

# Analyze a specific project, force ecosystem, custom output dir
drips-dep-optimizer analyze ../some-other-repo --ecosystem cargo --out ./out

# Check whether the Drips API is reachable from your network
drips-dep-optimizer doctor
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DRIPS_GRAPHQL_URL` | Override the Drips GraphQL endpoint (see `SETUP.md` — we couldn't 100% pin this down from outside a browser session) |
| `ANTHROPIC_API_KEY` | Optional. Enables LLM-refined rationale and small percentage adjustments |

## Example output

Tested against a real, checked-in `package-lock.json` fixture in
`examples/sample-npm-project` (real deps: `express`, `lodash`, `chalk`,
71 packages once resolved). See `tests/integration.test.ts` for the
end-to-end assertions on the generated output shape.

`drips-split-config.json`:

```json
{
  "generatedAt": "2026-08-05T12:00:00.000Z",
  "sourceProject": "sample-npm-project",
  "totalPercentage": 100,
  "receivers": [
    {
      "accountId": "123456789",
      "url": "github.com/expressjs/express",
      "percentage": 62.5,
      "rationale": "Heuristic score 88/100 — direct dependency (+40); depended on by 4 package(s) in this tree (+27); matches core-infrastructure naming pattern (+20); tree depth 0 (+10)."
    }
  ],
  "unmatched": [
    { "name": "lodash", "reason": "Not found on Drips (checked github.com/lodash/lodash)" }
  ]
}
```

## Project status & scope

This is an MVP submitted for the Drips Wave: Stellar Program. It works, is
tested, and is honest about its limits (see `SETUP.md`). It currently
supports npm and Cargo; see [`ISSUES.md`](./ISSUES.md) for scoped follow-up
work including Python/Go support, a GitHub Action, dependency-funding graph
visualization, monorepo support, and historical split tracking.

## Development

See [`SETUP.md`](./SETUP.md) for local dev setup, the Drips API
investigation notes, and testing philosophy.

```bash
npm install
npm run lint    # typecheck
npm test        # vitest, fully offline/mocked
npm run build
```

## License

MIT — see [`LICENSE`](./LICENSE).
