import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveCargoTree } from "../src/resolvers/cargo.js";

const FIXTURE = path.resolve(__dirname, "../examples/sample-cargo-project");

describe("resolveCargoTree", () => {
  it("resolves the full tree from Cargo.toml + Cargo.lock", async () => {
    const tree = await resolveCargoTree(FIXTURE);
    expect(tree.ecosystem).toBe("cargo");
    expect(tree.rootName).toBe("sample-cargo-project");
    // 3 direct + serde_derive, proc-macro2, quote, syn, unicode-ident, mio = 9 transitive-ish
    expect(tree.dependencies.size).toBe(9);
  });

  it("marks Cargo.toml [dependencies] entries as direct", async () => {
    const tree = await resolveCargoTree(FIXTURE);
    for (const name of ["serde", "tokio", "anyhow"]) {
      const dep = tree.dependencies.get(name);
      expect(dep!.isDirect).toBe(true);
    }
  });

  it("marks lock-only crates as transitive with correct dependents", async () => {
    const tree = await resolveCargoTree(FIXTURE);
    const synDep = tree.dependencies.get("syn");
    expect(synDep!.isDirect).toBe(false);
    expect(synDep!.dependents.has("serde_derive")).toBe(true);

    const procMacro2 = tree.dependencies.get("proc-macro2");
    expect(procMacro2!.dependents.has("syn")).toBe(true);
    expect(procMacro2!.dependents.has("serde_derive")).toBe(true);
    expect(procMacro2!.dependents.has("quote")).toBe(true);
  });

  it("flags tokio as core-infra", async () => {
    const tree = await resolveCargoTree(FIXTURE);
    expect(tree.dependencies.get("tokio")!.looksLikeCoreInfra).toBe(true);
  });
});
