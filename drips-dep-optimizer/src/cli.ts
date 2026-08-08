#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { resolveNpmTree } from "./resolvers/npm.js";
import { resolveCargoTree } from "./resolvers/cargo.js";
import { matchDependenciesAgainstDrips } from "./drips/match.js";
import { DripsClient } from "./drips/client.js";
import { buildSplitSuggestions } from "./splits/llm.js";
import { buildSplitConfig, writeSplitConfigJson, writeSplitInstructionsMarkdown } from "./output/writer.js";
import type { DependencyTree, Ecosystem } from "./types.js";

const program = new Command();

program
  .name("drips-dep-optimizer")
  .description(
    "Resolve a project's dependency tree, cross-reference it against Drips Network, " +
      "and generate a suggested funding split configuration.",
  )
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze a project and generate a suggested Drips split config")
  .argument("[dir]", "project directory", ".")
  .option("-o, --out <dir>", "output directory for generated files", "./drips-split-output")
  .option("--ecosystem <ecosystem>", "force 'npm' or 'cargo' instead of auto-detecting")
  .option("--no-llm", "skip LLM refinement even if ANTHROPIC_API_KEY is set")
  .option("--concurrency <n>", "parallel Drips/registry lookups", "6")
  .action(async (dir: string, opts) => {
    const projectDir = path.resolve(dir);
    const ecosystem = detectEcosystem(projectDir, opts.ecosystem);

    console.log(pc.bold(`\ndrips-dep-optimizer`) + pc.dim(` — analyzing ${projectDir} (${ecosystem})\n`));

    const tree: DependencyTree =
      ecosystem === "npm" ? await resolveNpmTree(projectDir) : await resolveCargoTree(projectDir);

    const total = tree.dependencies.size;
    const direct = [...tree.dependencies.values()].filter((d) => d.isDirect).length;
    console.log(`Resolved ${pc.bold(String(total))} dependencies (${direct} direct, ${total - direct} transitive).`);

    console.log(`Cross-referencing against Drips Network...`);
    const { matched, unmatched, apiAvailable } = await matchDependenciesAgainstDrips(tree, {
      concurrency: Number(opts.concurrency) || 6,
      onProgress: (done, totalN) => process.stdout.write(`\r  checked ${done}/${totalN}   `),
    });
    process.stdout.write("\n");

    if (!apiAvailable) {
      console.log(
        pc.yellow(
          "\nWarning: could not reach the Drips public GraphQL API. Nothing could be matched. " +
            "Set DRIPS_GRAPHQL_URL if the endpoint has moved, or check your network connection. " +
            "See SETUP.md for how this was discovered/verified.\n",
        ),
      );
    }

    console.log(
      `Found ${pc.green(String(matched.length))} dependencies already funded on Drips ` +
        `(${unmatched.length} not matched).`,
    );

    if (matched.length === 0) {
      console.log(pc.dim("\nNo matches — nothing to write. Exiting."));
      return;
    }

    console.log(`Generating split suggestions${opts.llm ? " (with LLM refinement if available)" : ""}...`);
    const suggestions = await buildSplitSuggestions(matched, {
      apiKey: opts.llm ? process.env.ANTHROPIC_API_KEY : undefined,
    });

    const config = buildSplitConfig(tree.rootName, suggestions, unmatched);

    const outDir = path.resolve(opts.out);
    await ensureDir(outDir);
    const jsonPath = path.join(outDir, "drips-split-config.json");
    const mdPath = path.join(outDir, "SETUP_INSTRUCTIONS.md");
    await writeSplitConfigJson(config, jsonPath);
    await writeSplitInstructionsMarkdown(config, mdPath);

    console.log(pc.bold(`\nDone.`));
    console.log(`  ${pc.cyan(jsonPath)}`);
    console.log(`  ${pc.cyan(mdPath)}`);
    console.log(
      pc.dim(
        "\nNote: applying the split still requires a signed on-chain transaction from the " +
          "claimed maintainer via the Drips app — see SETUP_INSTRUCTIONS.md.\n",
      ),
    );
  });

program
  .command("doctor")
  .description("Check connectivity to the Drips public GraphQL API")
  .action(async () => {
    const client = new DripsClient();
    const ok = await client.ping();
    if (ok) {
      console.log(pc.green("✓ Drips GraphQL API is reachable."));
    } else {
      console.log(
        pc.red("✗ Could not reach the Drips GraphQL API.") +
          " Set DRIPS_GRAPHQL_URL to override the endpoint, or check SETUP.md.",
      );
      process.exitCode = 1;
    }
  });

function detectEcosystem(projectDir: string, forced?: string): Ecosystem {
  if (forced === "npm" || forced === "cargo") return forced;
  if (existsSync(path.join(projectDir, "package.json"))) return "npm";
  if (existsSync(path.join(projectDir, "Cargo.toml"))) return "cargo";
  throw new Error(
    `Could not detect ecosystem in ${projectDir}: no package.json or Cargo.toml found. ` +
      "Use --ecosystem to force one.",
  );
}

async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}

program.parseAsync(process.argv);
