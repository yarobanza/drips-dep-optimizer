import { writeFile } from "node:fs/promises";
import type { SplitConfig, SplitSuggestion } from "../types.js";

export function buildSplitConfig(
  sourceProject: string,
  suggestions: SplitSuggestion[],
  unmatched: { name: string; reason: string }[],
): SplitConfig {
  return {
    generatedAt: new Date().toISOString(),
    sourceProject,
    totalPercentage: Math.round(suggestions.reduce((a, s) => a + s.percentage, 0) * 100) / 100,
    receivers: suggestions
      .sort((a, b) => b.percentage - a.percentage)
      .map((s) => ({
        accountId: s.match.dripsProject.accountId,
        url: s.match.dripsProject.url,
        percentage: s.percentage,
        rationale: s.rationale,
      })),
    unmatched,
  };
}

export async function writeSplitConfigJson(config: SplitConfig, outPath: string): Promise<void> {
  await writeFile(outPath, JSON.stringify(config, null, 2), "utf-8");
}

export function renderMarkdownInstructions(config: SplitConfig): string {
  const lines: string[] = [];
  lines.push(`# Suggested Drips Split Configuration`);
  lines.push("");
  lines.push(`Generated ${config.generatedAt} for **${config.sourceProject}**.`);
  lines.push("");
  lines.push(
    "Drips does not currently expose a public API for *setting* splits — splits are " +
      "authorized on-chain by the claimed maintainer of a project (or Drip List owner), " +
      "via a signed transaction through the Drips app or SDK. This file is a guided, " +
      "copy-pasteable checklist for applying the suggestion below through the Drips UI. " +
      "See SETUP.md in this repo for the full explanation.",
  );
  lines.push("");
  lines.push(`## Suggested splits (${config.receivers.length} matched dependencies)`);
  lines.push("");
  lines.push("| # | Project | Suggested % | Rationale |");
  lines.push("|---|---------|-------------|-----------|");
  config.receivers.forEach((r, i) => {
    lines.push(`| ${i + 1} | [${r.url}](https://${r.url}) | ${r.percentage}% | ${r.rationale} |`);
  });
  lines.push("");
  lines.push(`**Total allocated:** ${config.totalPercentage}%`);
  if (config.totalPercentage < 100) {
    lines.push(
      `> ${(100 - config.totalPercentage).toFixed(2)}% is left unallocated — you may want to reserve ` +
        "this for yourself, an unmatched dependency, or round out the matched list manually.",
    );
  }
  lines.push("");
  lines.push("## How to apply this in the Drips UI");
  lines.push("");
  lines.push("1. Go to https://www.drips.network and connect the wallet that has claimed your project.");
  lines.push("2. Open your project's page and choose **Edit Dependencies / Splits** " +
    "(exact label may vary by app version).");
  lines.push("3. For each row in the table above, search for the project by its GitHub URL " +
    "and set its percentage to the suggested value (adjust as you see fit — these are " +
    "starting points, not final answers).");
  lines.push("4. Review the total; Drips requires splits to be configured as whole-number " +
    "basis points summing to 100% for the recipients you select, so round as needed.");
  lines.push("5. Sign the transaction to publish the new split configuration on-chain.");
  lines.push("");
  if (config.unmatched.length > 0) {
    lines.push(`## Dependencies not matched to a Drips project (${config.unmatched.length})`);
    lines.push("");
    lines.push("| Dependency | Reason |");
    lines.push("|------------|--------|");
    config.unmatched.forEach((u) => lines.push(`| ${u.name} | ${u.reason} |`));
    lines.push("");
    lines.push(
      "> These may simply not be on Drips yet. Consider opening an issue with the maintainer, " +
        "or claiming the project yourself if you're a co-maintainer, to make future funding possible.",
    );
  }
  return lines.join("\n");
}

export async function writeSplitInstructionsMarkdown(config: SplitConfig, outPath: string): Promise<void> {
  await writeFile(outPath, renderMarkdownInstructions(config), "utf-8");
}
