import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DependencyTree, ResolvedDependency } from "../types.js";

const CORE_INFRA_HINTS = [
  "react",
  "vue",
  "angular",
  "next",
  "nuxt",
  "express",
  "fastify",
  "koa",
  "nestjs",
  "@nestjs/",
  "webpack",
  "vite",
  "typescript",
  "babel",
  "@babel/",
  "node",
  "electron",
  "graphql",
  "apollo",
  "prisma",
  "@aws-sdk/",
  "aws-sdk",
  "openai",
  "@anthropic-ai/",
  "sdk",
  "runtime",
  "core",
];

function looksLikeCoreInfra(name: string): boolean {
  const lower = name.toLowerCase();
  return CORE_INFRA_HINTS.some((hint) => lower.includes(hint));
}

interface PackageLockV2V3 {
  lockfileVersion?: number;
  packages?: Record<
    string,
    {
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      dev?: boolean;
    }
  >;
  // v1 shape fallback
  dependencies?: Record<
    string,
    {
      version?: string;
      requires?: Record<string, string>;
      dependencies?: Record<string, unknown>;
    }
  >;
}

/**
 * Resolves the full npm dependency tree for a project.
 *
 * Preferred path: parse package-lock.json (v2/v3 "packages" map), which
 * gives an exact, already-flattened resolution without needing
 * node_modules on disk or running `npm install`.
 *
 * Fallback: if no lockfile is present, only direct dependencies from
 * package.json are returned (with a console warning), since transitive
 * resolution without a lockfile or installed node_modules would require
 * hitting the npm registry for every package.
 */
export async function resolveNpmTree(projectDir: string): Promise<DependencyTree> {
  const pkgPath = path.join(projectDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found at ${pkgPath}`);
  }
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const rootName: string = pkg.name ?? path.basename(projectDir);
  const directDeps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };

  const dependencies = new Map<string, ResolvedDependency>();

  const lockPath = path.join(projectDir, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock: PackageLockV2V3 = JSON.parse(await readFile(lockPath, "utf-8"));

    if (lock.packages) {
      // v2/v3: keys look like "" (root), "node_modules/foo", "node_modules/foo/node_modules/bar"
      for (const [key, entry] of Object.entries(lock.packages)) {
        if (key === "" || entry.dev) continue;
        const segments = key.split("node_modules/");
        const name = segments[segments.length - 1];
        if (!name) continue;
        const existing = dependencies.get(name);
        const isDirect = name in directDeps;
        if (!existing) {
          dependencies.set(name, {
            name,
            version: entry.version ?? "unknown",
            ecosystem: "npm",
            isDirect,
            depth: isDirect ? 0 : 1,
            dependents: new Set(),
            looksLikeCoreInfra: looksLikeCoreInfra(name),
          });
        } else if (isDirect) {
          existing.isDirect = true;
          existing.depth = 0;
        }
      }
      // Second pass: wire up dependents using each package's declared deps.
      for (const [key, entry] of Object.entries(lock.packages)) {
        const segments = key.split("node_modules/");
        const parentName = key === "" ? rootName : segments[segments.length - 1];
        const deps = { ...(entry.dependencies ?? {}) };
        for (const depName of Object.keys(deps)) {
          const dep = dependencies.get(depName);
          if (dep) dep.dependents.add(parentName);
        }
      }
    } else if (lock.dependencies) {
      // v1 fallback: nested tree structure
      const walk = (
        deps: Record<string, { version?: string; requires?: Record<string, string> }>,
        depth: number,
        parent: string,
      ) => {
        for (const [name, entry] of Object.entries(deps)) {
          const isDirect = name in directDeps;
          const existing = dependencies.get(name);
          if (!existing) {
            dependencies.set(name, {
              name,
              version: entry.version ?? "unknown",
              ecosystem: "npm",
              isDirect,
              depth: isDirect ? 0 : depth,
              dependents: new Set([parent]),
              looksLikeCoreInfra: looksLikeCoreInfra(name),
            });
          } else {
            existing.dependents.add(parent);
            if (isDirect) {
              existing.isDirect = true;
              existing.depth = 0;
            }
          }
        }
      };
      walk(lock.dependencies as any, 1, rootName);
    }
  } else {
    console.warn(
      "[drips-dep-optimizer] No package-lock.json found — only direct dependencies " +
        "from package.json will be analyzed. Run `npm install` to generate a lockfile " +
        "for full transitive resolution.",
    );
    for (const name of Object.keys(directDeps)) {
      dependencies.set(name, {
        name,
        version: directDeps[name],
        ecosystem: "npm",
        isDirect: true,
        depth: 0,
        dependents: new Set(),
        looksLikeCoreInfra: looksLikeCoreInfra(name),
      });
    }
  }

  // Ensure every direct dep from package.json is represented even if the
  // lockfile parse missed it for some reason (e.g. workspace protocol quirks).
  for (const [name, version] of Object.entries(directDeps)) {
    if (!dependencies.has(name)) {
      dependencies.set(name, {
        name,
        version,
        ecosystem: "npm",
        isDirect: true,
        depth: 0,
        dependents: new Set(),
        looksLikeCoreInfra: looksLikeCoreInfra(name),
      });
    }
  }

  return { ecosystem: "npm", rootName, dependencies };
}
