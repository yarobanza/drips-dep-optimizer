import { describe, it, expect } from "vitest";
import { scoreCriticality, scoresToPercentages } from "../src/splits/heuristics.js";
import type { MatchedDependency, ResolvedDependency, DripsProject } from "../src/types.js";

function makeDep(overrides: Partial<ResolvedDependency>): ResolvedDependency {
  return {
    name: "pkg",
    version: "1.0.0",
    ecosystem: "npm",
    isDirect: false,
    depth: 1,
    dependents: new Set(),
    looksLikeCoreInfra: false,
    ...overrides,
  };
}

function makeProject(name: string): DripsProject {
  return {
    url: `github.com/example/${name}`,
    ownerName: "example",
    repoName: name,
    accountId: `acct-${name}`,
    claimed: true,
  };
}

function match(dep: ResolvedDependency): MatchedDependency {
  return { dependency: dep, dripsProject: makeProject(dep.name) };
}

describe("scoreCriticality", () => {
  it("scores a direct, high-fan-in, core-infra dependency higher than a small transitive one", () => {
    const core = makeDep({
      name: "core-runtime",
      isDirect: true,
      depth: 0,
      dependents: new Set(["a", "b", "c"]),
      looksLikeCoreInfra: true,
    });
    const small = makeDep({
      name: "tiny-util",
      isDirect: false,
      depth: 3,
      dependents: new Set(),
      looksLikeCoreInfra: false,
    });

    const scores = scoreCriticality([match(core), match(small)]);
    const coreScore = scores.find((s) => s.name === "core-runtime")!;
    const smallScore = scores.find((s) => s.name === "tiny-util")!;

    expect(coreScore.score).toBeGreaterThan(smallScore.score);
  });

  it("never exceeds 100", () => {
    const dep = makeDep({
      name: "maxed",
      isDirect: true,
      depth: 0,
      dependents: new Set(["a", "b", "c", "d", "e"]),
      looksLikeCoreInfra: true,
    });
    const scores = scoreCriticality([match(dep)]);
    expect(scores[0].score).toBeLessThanOrEqual(100);
  });
});

describe("scoresToPercentages", () => {
  it("sums to the requested total percentage", () => {
    const scores = [
      { name: "a", score: 80, factors: [] },
      { name: "b", score: 40, factors: [] },
      { name: "c", score: 10, factors: [] },
    ];
    const pct = scoresToPercentages(scores, 100);
    const sum = [...pct.values()].reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it("gives a higher percentage to a higher score", () => {
    const scores = [
      { name: "a", score: 90, factors: [] },
      { name: "b", score: 10, factors: [] },
    ];
    const pct = scoresToPercentages(scores, 100);
    expect(pct.get("a")!).toBeGreaterThan(pct.get("b")!);
  });
});
