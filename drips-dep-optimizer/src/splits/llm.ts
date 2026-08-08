import type { MatchedDependency, SplitSuggestion } from "../types.js";
import { scoreCriticality, scoresToPercentages, type CriticalityScore } from "./heuristics.js";

export interface LlmOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Builds the final split suggestions.
 *
 * Always computes the deterministic heuristic scores first (see
 * heuristics.ts) so there is a reproducible baseline that doesn't depend on
 * network access or an API key. If an Anthropic API key is available (via
 * options.apiKey or ANTHROPIC_API_KEY env var), asks the model to review the
 * heuristic scores + factors and (a) write a short human-readable rationale
 * per dependency and (b) optionally nudge the percentage within a small
 * band, e.g. to account for things the heuristics can't see (a package
 * being effectively unmaintained, or unusually central despite low fan-in).
 * The model is explicitly constrained to only adjust within +/-15% of the
 * heuristic percentage, and its output is validated before use — if
 * anything is malformed, we silently fall back to the pure heuristic
 * result for that dependency.
 */
export async function buildSplitSuggestions(
  matches: MatchedDependency[],
  options: LlmOptions = {},
): Promise<SplitSuggestion[]> {
  const scores = scoreCriticality(matches);
  const percentages = scoresToPercentages(scores, 100);

  const baseline: SplitSuggestion[] = matches.map((match) => ({
    match,
    percentage: percentages.get(match.dependency.name) ?? 0,
    rationale: describeHeuristically(scores.find((s) => s.name === match.dependency.name)),
  }));

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey || matches.length === 0) {
    return baseline;
  }

  try {
    return await refineWithLlm(baseline, scores, apiKey, options);
  } catch (err) {
    console.warn(
      `[drips-dep-optimizer] LLM refinement failed (${(err as Error).message}); ` +
        "falling back to deterministic heuristic scores.",
    );
    return baseline;
  }
}

function describeHeuristically(score: CriticalityScore | undefined): string {
  if (!score) return "Scored using deterministic dependency-graph heuristics.";
  return `Heuristic score ${score.score}/100 — ${score.factors.join("; ")}.`;
}

async function refineWithLlm(
  baseline: SplitSuggestion[],
  scores: CriticalityScore[],
  apiKey: string,
  options: LlmOptions,
): Promise<SplitSuggestion[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "claude-sonnet-5";

  const payload = baseline.map((s) => ({
    name: s.match.dependency.name,
    ecosystem: s.match.dependency.ecosystem,
    isDirect: s.match.dependency.isDirect,
    dependentsInTree: [...s.match.dependency.dependents],
    heuristicScore: scores.find((sc) => sc.name === s.match.dependency.name)?.score,
    heuristicPercentage: s.percentage,
  }));

  const systemPrompt = `You review a dependency funding split for a software project that wants to \
fund its dependencies via Drips Network. You are given each dependency's deterministic \
criticality heuristics (direct vs transitive, fan-in within this tree, heuristic percentage). \
For each dependency, write one concise sentence explaining why it deserves roughly its given \
share, and OPTIONALLY adjust the percentage by at most 15% relative (e.g. 10 -> between 8.5 and 11.5) \
if you have a clear qualitative reason (e.g. it's a small, narrowly-scoped utility despite high fan-in, \
or it's genuinely foundational, like a language runtime or core web framework). \
Respond ONLY with a JSON array, no prose, no markdown fences, in this exact shape: \
[{"name": string, "percentage": number, "rationale": string}, ...] \
covering every dependency given, in the same order. Do not invent dependencies.`;

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API responded with HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    content: { type: string; text?: string }[];
  };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  const parsed = JSON.parse(cleaned) as { name: string; percentage: number; rationale: string }[];

  const byName = new Map(parsed.map((p) => [p.name, p]));

  return baseline.map((b) => {
    const llm = byName.get(b.match.dependency.name);
    if (!llm || typeof llm.percentage !== "number" || !llm.rationale) {
      return b; // validation failure -> keep heuristic baseline for this item
    }
    const bounded = clamp(llm.percentage, b.percentage * 0.85, b.percentage * 1.15);
    return { match: b.match, percentage: Math.round(bounded * 100) / 100, rationale: llm.rationale };
  });
}

function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}
