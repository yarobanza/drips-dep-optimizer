export type Ecosystem = "npm" | "cargo";

/**
 * A single resolved node in the dependency tree, deduplicated by name.
 * `depth` is the shortest distance from a root direct dependency (0 = direct).
 * `dependents` are the names of packages in this tree that require it directly.
 */
export interface ResolvedDependency {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  isDirect: boolean;
  depth: number;
  dependents: Set<string>;
  /** Heuristic tag for "core infra" style packages (runtimes, frameworks, SDKs). */
  looksLikeCoreInfra: boolean;
}

export interface DependencyTree {
  ecosystem: Ecosystem;
  rootName: string;
  dependencies: Map<string, ResolvedDependency>;
}

/**
 * A Drips "Project" as returned by the public read-only GraphQL API.
 * Field names mirror the `Project` GraphQL type documented in
 * drips-network/graphql-api (see SETUP.md for verification notes).
 */
export interface DripsProject {
  /** e.g. "github.com/facebook/react" */
  url: string;
  ownerName: string;
  repoName: string;
  /** on-chain project account id, used to reference it in split metadata */
  accountId: string;
  /** whether the project has been claimed by its maintainer on Drips */
  claimed: boolean;
  /** total amount currently streamed/split to this project, if exposed by the API */
  totalReceived?: string;
}

export interface MatchedDependency {
  dependency: ResolvedDependency;
  dripsProject: DripsProject;
}

export interface SplitSuggestion {
  match: MatchedDependency;
  percentage: number;
  rationale: string;
}

export interface SplitConfig {
  generatedAt: string;
  sourceProject: string;
  totalPercentage: number;
  receivers: {
    accountId: string;
    url: string;
    percentage: number;
    rationale: string;
  }[];
  unmatched: {
    name: string;
    reason: string;
  }[];
}
