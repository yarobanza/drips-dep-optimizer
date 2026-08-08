import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveNpmTree } from "../src/resolvers/npm.js";

const FIXTURE = path.resolve(__dirname, "../examples/sample-npm-project");

describe("resolveNpmTree", () => {
  it("resolves the full tree from a real package-lock.json", async () => {
    const tree = await resolveNpmTree(FIXTURE);
    expect(tree.ecosystem).toBe("npm");
    expect(tree.rootName).toBe("sample-npm-project");
    // Should be way more than the 3 direct deps once transitives are included.
    expect(tree.dependencies.size).toBeGreaterThan(10);
  });

  it("marks declared dependencies.* entries as direct with depth 0", async () => {
    const tree = await resolveNpmTree(FIXTURE);
    for (const name of ["express", "lodash", "chalk"]) {
      const dep = tree.dependencies.get(name);
      expect(dep, `${name} should be present`).toBeDefined();
      expect(dep!.isDirect).toBe(true);
      expect(dep!.depth).toBe(0);
    }
  });

  it("marks packages only required by other packages as transitive", async () => {
    const tree = await resolveNpmTree(FIXTURE);
    // 'debug' is a well-known transitive dep of express in this express version range.
    const transitiveCandidates = [...tree.dependencies.values()].filter((d) => !d.isDirect);
    expect(transitiveCandidates.length).toBeGreaterThan(0);
    for (const dep of transitiveCandidates) {
      expect(dep.dependents.size).toBeGreaterThan(0);
    }
  });

  it("flags well-known core-infra style packages", async () => {
    const tree = await resolveNpmTree(FIXTURE);
    expect(tree.dependencies.get("express")!.looksLikeCoreInfra).toBe(true);
  });
});
