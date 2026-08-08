import { describe, it, expect, vi } from "vitest";
import { matchDependenciesAgainstDrips } from "../src/drips/match.js";
import type { DependencyTree, ResolvedDependency } from "../src/types.js";

function makeTree(deps: Partial<ResolvedDependency>[]): DependencyTree {
  const dependencies = new Map<string, ResolvedDependency>();
  for (const d of deps) {
    const dep: ResolvedDependency = {
      name: "pkg",
      version: "1.0.0",
      ecosystem: "npm",
      isDirect: false,
      depth: 1,
      dependents: new Set(),
      looksLikeCoreInfra: false,
      ...d,
    };
    dependencies.set(dep.name, dep);
  }
  return { ecosystem: "npm", rootName: "root", dependencies };
}

/**
 * Builds a fake fetch that simulates:
 *  - npm registry lookups (registry.npmjs.org) -> repository url
 *  - Drips GraphQL endpoint -> projectByUrl for known/claimed repos only
 */
function fakeFetch(reposOnDrips: Record<string, { claimed: boolean }>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("registry.npmjs.org")) {
      const pkgName = decodeURIComponent(url.split("registry.npmjs.org/")[1].split("/latest")[0]);
      const repo = `example/${pkgName}`;
      return new Response(
        JSON.stringify({ repository: { url: `git+https://github.com/${repo}.git` } }),
        { status: 200 },
      );
    }

    if (url.includes("api.drips.network")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.query.includes("__typename")) {
        return new Response(JSON.stringify({ data: { __typename: "Query" } }), { status: 200 });
      }
      const slug = (body.variables?.url as string)?.replace("github.com/", "");
      const pkgName = (slug ?? "").split("/")[1];
      const info = reposOnDrips[pkgName];
      if (!info) {
        return new Response(JSON.stringify({ data: { projectByUrl: null } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: {
            projectByUrl: {
              url: `github.com/${slug}`,
              account: { accountId: "123" },
              source: { ownerName: "example", repoName: slug.split("/")[1] },
              claimed: info.claimed,
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

describe("matchDependenciesAgainstDrips", () => {
  it("matches dependencies whose repo is a claimed Drips project", async () => {
    const tree = makeTree([{ name: "funded-pkg" }, { name: "unfunded-pkg" }]);
    const fetchImpl = fakeFetch({ "funded-pkg": { claimed: true } });

    const result = await matchDependenciesAgainstDrips(tree, { fetchImpl, concurrency: 2 });

    expect(result.apiAvailable).toBe(true);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].dependency.name).toBe("funded-pkg");
    expect(result.unmatched.some((u) => u.name === "unfunded-pkg")).toBe(true);
  });

  it("excludes projects found on Drips but not yet claimed", async () => {
    const tree = makeTree([{ name: "unclaimed-pkg" }]);
    const fetchImpl = fakeFetch({ "unclaimed-pkg": { claimed: false } });

    const result = await matchDependenciesAgainstDrips(tree, { fetchImpl, concurrency: 1 });

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0].reason).toContain("not yet claimed");
  });

  it("degrades gracefully when the Drips API is unreachable", async () => {
    const tree = makeTree([{ name: "any-pkg" }]);
    const fetchImpl = vi.fn(async () => new Response("fail", { status: 500 })) as unknown as typeof fetch;

    const result = await matchDependenciesAgainstDrips(tree, { fetchImpl, concurrency: 1 });

    expect(result.apiAvailable).toBe(false);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0].reason).toContain("unreachable");
  });
});
