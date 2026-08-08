import type { DripsProject } from "../types.js";

/**
 * ---------------------------------------------------------------------------
 * WHAT THIS CLIENT TALKS TO, AND WHY
 * ---------------------------------------------------------------------------
 * Drips does not publish a stable, versioned "public REST API" for
 * third-party integrations. What it *does* have, and what this client uses:
 *
 *   1. A read-only GraphQL query API (source: github.com/drips-network/graphql-api)
 *      that sits in front of the "Drips Event Processor" — an indexer that
 *      ingests on-chain Drips protocol events + IPFS metadata into Postgres.
 *      This is the same data source the drips.network web app queries to
 *      render project pages, funding totals, and split graphs. It is
 *      read-only by design: the actual state lives on-chain / on IPFS.
 *
 *   2. There is NO public write endpoint for setting splits. Splits are
 *      set by calling the Drips smart contracts directly (see the Drips SDK,
 *      github.com/drips-network/sdk), which requires a connected wallet and
 *      an on-chain transaction signed by the project's claimed maintainer
 *      (or, for a "Drip List", by whoever owns that list). There is no way
 *      to set a split on someone else's behalf via an API call — this is
 *      intentional, since splits are an on-chain authorization mechanism.
 *
 * This file therefore only ever performs READS. See SETUP.md for the exact
 * verification steps used to confirm this endpoint shape, and for the
 * degraded/offline fallback behavior.
 * ---------------------------------------------------------------------------
 */

const DEFAULT_ENDPOINT = "https://api.drips.network/graphql";

export interface DripsClientOptions {
  /** Override for the GraphQL endpoint. Defaults to DRIPS_GRAPHQL_URL env var, then DEFAULT_ENDPOINT. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class DripsApiUnavailableError extends Error {}

export class DripsClient {
  private endpoint: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(opts: DripsClientOptions = {}) {
    this.endpoint = opts.endpoint ?? process.env.DRIPS_GRAPHQL_URL ?? DEFAULT_ENDPOINT;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new DripsApiUnavailableError(
          `Drips GraphQL API responded with HTTP ${res.status} at ${this.endpoint}`,
        );
      }
      const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (json.errors?.length) {
        throw new DripsApiUnavailableError(
          `Drips GraphQL API returned errors: ${json.errors.map((e) => e.message).join("; ")}`,
        );
      }
      if (!json.data) {
        throw new DripsApiUnavailableError("Drips GraphQL API returned no data");
      }
      return json.data;
    } catch (err) {
      if (err instanceof DripsApiUnavailableError) throw err;
      throw new DripsApiUnavailableError(
        `Failed to reach Drips GraphQL API at ${this.endpoint}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Looks up a claimed Drips project by GitHub "owner/repo" slug.
   * Returns null if no matching project exists on Drips (i.e. it isn't
   * being funded there yet) rather than throwing, since "not found" is an
   * expected, common outcome for most dependencies.
   */
  async findProjectByRepo(ownerSlashRepo: string): Promise<DripsProject | null> {
    const url = `github.com/${ownerSlashRepo}`;
    const gql = `
      query ProjectByUrl($url: String!) {
        projectByUrl(url: $url) {
          url
          account { accountId }
          source { ownerName repoName }
          claimed: isClaimed
          support {
            totalSplit
          }
        }
      }
    `;
    try {
      const data = await this.query<{
        projectByUrl: {
          url: string;
          account: { accountId: string };
          source: { ownerName: string; repoName: string };
          claimed: boolean;
          support?: { totalSplit?: string };
        } | null;
      }>(gql, { url });

      const p = data.projectByUrl;
      if (!p) return null;
      return {
        url: p.url,
        ownerName: p.source.ownerName,
        repoName: p.source.repoName,
        accountId: p.account.accountId,
        claimed: p.claimed,
        totalReceived: p.support?.totalSplit,
      };
    } catch (err) {
      if (err instanceof DripsApiUnavailableError) throw err;
      return null;
    }
  }

  /** Basic reachability check used by `drips-dep-optimizer doctor`. */
  async ping(): Promise<boolean> {
    try {
      await this.query("query { __typename }", {});
      return true;
    } catch {
      return false;
    }
  }
}
