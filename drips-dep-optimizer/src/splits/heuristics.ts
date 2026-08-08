import type { MatchedDependency } from "../types.js";

export interface CriticalityScore {
  name: string;
  score: number; // 0-100, relative criticality within this project's tree
  factors: string[];
}

/**
 * Produces a deterministic 0-100 criticality score per matched dependency,
 * based on transparent, explainable heuristics:
 *
 *  - direct vs transitive (direct deps you chose deliberately score higher)
 *  - how many other in-tree packages depend on it (fan-in / "load-bearing"-ness)
 *  - whether it matches common core-infrastructure naming patterns
 *    (runtimes, frameworks, SDKs) vs looking like a small utility
 *  - depth in the tree (shallower = more architecturally central, generally)
 *
 * This runs unconditionally, even when an LLM is used, so there's always a
 * transparent, reproducible baseline. The LLM (see llm.ts) is used to turn
 * these scores into a human-readable rationale and to nudge percentages
 * based on qualitative judgment the heuristics can't capture.
 */
export function scoreCriticality(matches: MatchedDependency[]): CriticalityScore[] {
  const maxDependents = Math.max(1, ...matches.map((m) => m.dependency.dependents.size));

  return matches.map(({ dependency }) => {
    const factors: string[] = [];
    let score = 0;

    if (dependency.isDirect) {
      score += 40;
      factors.push("direct dependency (+40)");
    } else {
      score += 10;
      factors.push("transitive dependency (+10)");
    }

    const fanIn = dependency.dependents.size;
    const fanInScore = Math.round((fanIn / maxDependents) * 30);
    score += fanInScore;
    factors.push(`depended on by ${fanIn} package(s) in this tree (+${fanInScore})`);

    if (dependency.looksLikeCoreInfra) {
      score += 20;
      factors.push("matches core-infrastructure naming pattern, e.g. runtime/framework/SDK (+20)");
    }

    const depthPenalty = Math.min(10, dependency.depth * 2);
    score += Math.max(0, 10 - depthPenalty);
    factors.push(`tree depth ${dependency.depth} (+${Math.max(0, 10 - depthPenalty)})`);

    return { name: dependency.name, score: Math.min(100, score), factors };
  });
}

/**
 * Converts raw scores into normalized percentages that sum to <= 100.
 * Leaves headroom (default 100% allocated across matches; caller can scale)
 * so downstream code can decide whether to allocate 100% of the split graph
 * to dependencies or reserve a slice for the maintainer / other causes.
 */
export function scoresToPercentages(
  scores: CriticalityScore[],
  totalPercentage = 100,
): Map<string, number> {
  const sum = scores.reduce((acc, s) => acc + s.score, 0) || 1;
  const result = new Map<string, number>();
  let allocated = 0;
  scores.forEach((s, i) => {
    const isLast = i === scores.length - 1;
    const raw = (s.score / sum) * totalPercentage;
    const pct = isLast ? Math.round((totalPercentage - allocated) * 100) / 100 : Math.round(raw * 100) / 100;
    result.set(s.name, pct);
    allocated += pct;
  });
  return result;
}
