import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveNpmTree } from "../src/resolvers/npm.js";
import { matchDependenciesAgainstDrips } from "../src/drips/match.js";
import { buildSplitSuggestions } from "../src/splits/llm.js";
import { buildSplitConfig, writeSplitConfigJson, writeSplitInstructionsMarkdown } from "../src/output/writer.js";

const FIXTURE = path.resolve(__dirname, "../examples/sample-npm-project");

/** Simulates express + chalk being funded/claimed on Drips; lodash is not. */
function fakeFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("registry.npmjs.org")) {
      const pkgName = decodeURIComponent(url.split("registry.npmjs.org/")[1].split("/latest")[0]);
      return new Response(
        JSON.stringify({ repository: { url: `git+https://github.com/realorg/${pkgName}.git` } }),
        { status: 200 },
      );
    }

    if (url.includes("api.drips.network")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.query.includes("__typename")) {
        return new Response(JSON.stringify({ data: { __typename: "Query" } }), { status: 200 });
      }
      const slug = (body.variables?.url as string) ?? "";
      const pkgName = slug.split("/")[2];
      const fundedClaimed = new Set(["express", "chalk"]);
      if (!fundedClaimed.has(pkgName)) {
        return new Response(JSON.stringify({ data: { projectByUrl: null } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: {
            projectByUrl: {
              url: slug,
              account: { accountId: `acct-${pkgName}` },
              source: { ownerName: "realorg", repoName: pkgName },
              claimed: true,
              support: { totalSplit: "0" },
            },
          },
        }),
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("end-to-end analyze pipeline", () => {
  let outDir: string;

  afterEach(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it("resolves, matches, scores, and writes a valid split config against the real fixture tree", async () => {
    const tree = await resolveNpmTree(FIXTURE);
    expect(tree.dependencies.size).toBeGreaterThan(10);

    const fetchImpl = fakeFetch();
    const { matched, unmatched, apiAvailable } = await matchDependenciesAgainstDrips(tree, {
      fetchImpl,
      concurrency: 4,
    });

    expect(apiAvailable).toBe(true);
    const matchedNames = matched.map((m) => m.dependency.name).sort();
    expect(matchedNames).toEqual(["chalk", "express"]);
    expect(unmatched.length).toBe(tree.dependencies.size - 2);

    // No ANTHROPIC_API_KEY in test env -> should fall back to deterministic heuristics.
    const suggestions = await buildSplitSuggestions(matched, { apiKey: undefined });
    expect(suggestions).toHaveLength(2);
    for (const s of suggestions) {
      expect(s.percentage).toBeGreaterThan(0);
      expect(s.rationale).toContain("Heuristic score");
    }
    // express is direct + core-infra-flagged; should outscore chalk (also direct but not core-infra).
    const expressPct = suggestions.find((s) => s.match.dependency.name === "express")!.percentage;
    const chalkPct = suggestions.find((s) => s.match.dependency.name === "chalk")!.percentage;
    expect(expressPct).toBeGreaterThan(chalkPct);

    const config = buildSplitConfig(tree.rootName, suggestions, unmatched);
    expect(config.receivers).toHaveLength(2);
    expect(Math.round(config.totalPercentage)).toBe(100);

    outDir = await mkdtemp(path.join(tmpdir(), "drips-dep-optimizer-test-"));
    const jsonPath = path.join(outDir, "drips-split-config.json");
    const mdPath = path.join(outDir, "SETUP_INSTRUCTIONS.md");
    await writeSplitConfigJson(config, jsonPath);
    await writeSplitInstructionsMarkdown(config, mdPath);

    const writtenJson = JSON.parse(await readFile(jsonPath, "utf-8"));
    expect(writtenJson.receivers).toHaveLength(2);
    expect(writtenJson.receivers[0].accountId).toMatch(/^acct-/);

    const writtenMd = await readFile(mdPath, "utf-8");
    expect(writtenMd).toContain("Suggested Drips Split Configuration");
    expect(writtenMd).toContain("How to apply this in the Drips UI");
    expect(writtenMd).toContain("express");
  });
});
