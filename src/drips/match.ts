import type { DependencyTree, MatchedDependency, ResolvedDependency } from "../types.js";
import { DripsClient, DripsApiUnavailableError } from "./client.js";

const GITHUB_REPO_RE = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i;

function extractRepoSlug(repoUrl: string | undefined | null): string | null {
  if (!repoUrl) return null;
  const match = GITHUB_REPO_RE.exec(repoUrl);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

/** Looks up the GitHub repo slug for an npm package via the public npm registry. */
async function npmPackageToRepoSlug(name: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const encoded = name.startsWith("@") ? name.replace("/", "%2F") : name;
    const res = await fetchImpl(`https://registry.npmjs.org/${encoded}/latest`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { repository?: { url?: string } | string };
    const repoUrl = typeof data.repository === "string" ? data.repository : data.repository?.url;
    return extractRepoSlug(repoUrl);
  } catch {
    return null;
  }
}

/** Looks up the GitHub repo slug for a crate via the public crates.io API. */
async function cargoPackageToRepoSlug(name: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
      headers: { accept: "application/json", "user-agent": "drips-dep-optimizer (+github.com)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { crate?: { repository?: string } };
    return extractRepoSlug(data.crate?.repository);
  } catch {
    return null;
  }
}

export interface MatchOptions {
  concurrency?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number, name: string) => void;
}

export interface MatchResult {
  matched: MatchedDependency[];
  unmatched: { name: string; reason: string }[];
  apiAvailable: boolean;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Cross-references every resolved dependency against Drips Network:
 *   package name -> (npm registry / crates.io) -> GitHub repo slug -> Drips project
 *
 * Degrades gracefully: if the Drips API is unreachable, returns
 * apiAvailable: false and an empty match list rather than throwing, so the
 * CLI can still print the dependency tree and explain what happened.
 */
export async function matchDependenciesAgainstDrips(
  tree: DependencyTree,
  options: MatchOptions = {},
): Promise<MatchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = new DripsClient({ fetchImpl });
  const deps = [...tree.dependencies.values()];

  const apiAvailable = await client.ping();
  if (!apiAvailable) {
    return {
      matched: [],
      unmatched: deps.map((d) => ({ name: d.name, reason: "Drips API unreachable" })),
      apiAvailable: false,
    };
  }

  const matched: MatchedDependency[] = [];
  const unmatched: { name: string; reason: string }[] = [];

  let done = 0;
  await mapWithConcurrency(deps, options.concurrency ?? 6, async (dep: ResolvedDependency) => {
    try {
      const slug =
        dep.ecosystem === "npm"
          ? await npmPackageToRepoSlug(dep.name, fetchImpl)
          : await cargoPackageToRepoSlug(dep.name, fetchImpl);

      if (!slug) {
        unmatched.push({ name: dep.name, reason: "No GitHub repository found in registry metadata" });
        return;
      }

      const project = await client.findProjectByRepo(slug);
      if (!project) {
        unmatched.push({ name: dep.name, reason: `Not found on Drips (checked github.com/${slug})` });
        return;
      }
      if (!project.claimed) {
        unmatched.push({
          name: dep.name,
          reason: `Found on Drips (github.com/${slug}) but not yet claimed by a maintainer`,
        });
        return;
      }
      matched.push({ dependency: dep, dripsProject: project });
    } catch (err) {
      if (err instanceof DripsApiUnavailableError) {
        unmatched.push({ name: dep.name, reason: "Drips API error during lookup" });
      } else {
        unmatched.push({ name: dep.name, reason: `Unexpected error: ${(err as Error).message}` });
      }
    } finally {
      done++;
      options.onProgress?.(done, deps.length, dep.name);
    }
  });

  return { matched, unmatched, apiAvailable: true };
}
