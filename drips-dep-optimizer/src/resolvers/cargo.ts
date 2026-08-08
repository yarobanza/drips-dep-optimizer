import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import type { DependencyTree, ResolvedDependency } from "../types.js";

const CORE_INFRA_HINTS = [
  "tokio",
  "async-std",
  "std",
  "serde",
  "actix",
  "axum",
  "rocket",
  "hyper",
  "reqwest",
  "wasm-bindgen",
  "rustls",
  "openssl",
  "sdk",
  "runtime",
  "core",
];

function looksLikeCoreInfra(name: string): boolean {
  const lower = name.toLowerCase();
  return CORE_INFRA_HINTS.some((hint) => lower.includes(hint));
}

interface CargoLockPackage {
  name: string;
  version: string;
  dependencies?: string[];
}

interface CargoLock {
  package?: CargoLockPackage[];
}

interface CargoTomlDoc {
  package?: { name?: string };
  dependencies?: Record<string, unknown>;
  ["dev-dependencies"]?: Record<string, unknown>;
  ["build-dependencies"]?: Record<string, unknown>;
  workspace?: { members?: string[]; dependencies?: Record<string, unknown> };
}

/**
 * Resolves the full Cargo dependency tree by parsing Cargo.toml (for direct
 * deps and root crate name) and Cargo.lock (for the fully resolved,
 * deduplicated dependency graph — Cargo.lock entries are already flat, each
 * listing the exact deps it resolved to).
 */
export async function resolveCargoTree(projectDir: string): Promise<DependencyTree> {
  const tomlPath = path.join(projectDir, "Cargo.toml");
  if (!existsSync(tomlPath)) {
    throw new Error(`No Cargo.toml found at ${tomlPath}`);
  }
  const tomlDoc = TOML.parse(await readFile(tomlPath, "utf-8")) as CargoTomlDoc;
  const rootName = tomlDoc.package?.name ?? path.basename(projectDir);
  const directDeps = new Set<string>([
    ...Object.keys(tomlDoc.dependencies ?? {}),
    ...Object.keys(tomlDoc.workspace?.dependencies ?? {}),
  ]);

  const dependencies = new Map<string, ResolvedDependency>();

  const lockPath = path.join(projectDir, "Cargo.lock");
  if (existsSync(lockPath)) {
    const lock = TOML.parse(await readFile(lockPath, "utf-8")) as CargoLock;
    const packages = lock.package ?? [];

    for (const pkg of packages) {
      if (pkg.name === rootName) continue;
      const isDirect = directDeps.has(pkg.name);
      dependencies.set(pkg.name, {
        name: pkg.name,
        version: pkg.version,
        ecosystem: "cargo",
        isDirect,
        depth: isDirect ? 0 : 1,
        dependents: new Set(),
        looksLikeCoreInfra: looksLikeCoreInfra(pkg.name),
      });
    }

    // Wire up dependents. Cargo.lock dependency entries are strings like
    // "serde 1.0.203" or just "serde" depending on ambiguity; strip version.
    for (const pkg of packages) {
      for (const rawDep of pkg.dependencies ?? []) {
        const depName = rawDep.split(" ")[0];
        const dep = dependencies.get(depName);
        if (dep) dep.dependents.add(pkg.name);
      }
    }
  } else {
    console.warn(
      "[drips-dep-optimizer] No Cargo.lock found — only direct dependencies " +
        "from Cargo.toml will be analyzed. Run `cargo generate-lockfile` for " +
        "full transitive resolution.",
    );
    for (const name of directDeps) {
      dependencies.set(name, {
        name,
        version: "unknown",
        ecosystem: "cargo",
        isDirect: true,
        depth: 0,
        dependents: new Set(),
        looksLikeCoreInfra: looksLikeCoreInfra(name),
      });
    }
  }

  for (const name of directDeps) {
    if (!dependencies.has(name)) {
      dependencies.set(name, {
        name,
        version: "unknown",
        ecosystem: "cargo",
        isDirect: true,
        depth: 0,
        dependents: new Set(),
        looksLikeCoreInfra: looksLikeCoreInfra(name),
      });
    }
  }

  return { ecosystem: "cargo", rootName, dependencies };
}
