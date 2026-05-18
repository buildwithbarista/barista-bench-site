import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";

/**
 * Preview-route renderer for a single benchmark run.
 *
 * Loads `public/preview/<runId>/index.json` plus the enumerated
 * `results.json` files, groups by `manifest_id`, and renders a
 * per-manifest comparison table.
 *
 * This route is deliberately NOT linked from the canonical headline
 * dashboard — its data is a developer-machine fixture, not the
 * Tier-3 reference numbers the homepage is reserved for. The banner
 * at the top of the page makes that explicit.
 *
 * Static segments are pre-generated at build time via
 * {@link generateStaticParams}; new datasets land by dropping a
 * directory under `public/preview/` and re-deploying.
 */

// ---------------------------------------------------------------------------
// Wire-format types (mirror `crates/barista-bench/src/results.rs` and
// `crates/barista-bench/src/bin/barista-bench.rs::write_index`).
// ---------------------------------------------------------------------------

type Hardware = {
  id: string;
  cpu: string;
  cores_physical: number;
  cores_logical: number;
  memory_gb: number;
  os: string;
};

type Iteration = {
  iteration: number;
  wall_ms: number;
  exit_code: number;
  network_calls?: number;
  network_bytes?: number;
};

type Summary = {
  avg_wall_ms: number;
  median_wall_ms: number;
  p95_wall_ms: number;
  stddev_wall_ms: number;
};

type ResultsDocument = {
  schema: string;
  manifest_id: string;
  baseline_id?: string;
  resolved_command?: string;
  run_id: string;
  timestamp: string;
  git_sha: string;
  barista_version: string;
  hardware_tier: number;
  runner_id: string;
  hardware: Hardware;
  iterations: Iteration[];
  summary: Summary;
  metadata?: Record<string, string>;
};

type IndexDocument = {
  schema: string;
  run_id: string;
  timestamp: string;
  git_sha: string;
  runner_id: string;
  hardware: Hardware;
  results: string[];
  produced_by: string;
};

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function previewRoot(runId: string): string {
  return path.join(process.cwd(), "public", "preview", runId);
}

async function loadIndex(runId: string): Promise<IndexDocument | null> {
  try {
    const raw = await fs.readFile(
      path.join(previewRoot(runId), "index.json"),
      "utf-8",
    );
    return JSON.parse(raw) as IndexDocument;
  } catch {
    return null;
  }
}

async function loadResults(
  runId: string,
  index: IndexDocument,
): Promise<ResultsDocument[]> {
  const root = previewRoot(runId);
  const docs = await Promise.all(
    index.results.map(async (rel) => {
      const raw = await fs.readFile(path.join(root, rel), "utf-8");
      return JSON.parse(raw) as ResultsDocument;
    }),
  );
  return docs;
}

// Discover which preview dataset directories exist on disk so the
// runId param is type-checked statically.
export async function generateStaticParams(): Promise<{ runId: string }[]> {
  try {
    const root = path.join(process.cwd(), "public", "preview");
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ runId: e.name }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

type ManifestGroup = {
  manifestId: string;
  results: ResultsDocument[];
};

function groupByManifest(results: ResultsDocument[]): ManifestGroup[] {
  const map = new Map<string, ResultsDocument[]>();
  for (const r of results) {
    const list = map.get(r.manifest_id) ?? [];
    list.push(r);
    map.set(r.manifest_id, list);
  }
  // Stable sort: alphabetical by manifest_id so the page is the same
  // shape every deploy. Inside each group, sort baselines by the
  // declared display-name length so the longest (typically the
  // baseline reference) renders last — small touch that lines up
  // speedup ratios visually.
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([manifestId, results]) => ({
      manifestId,
      results: results
        .slice()
        .sort((a, b) => (a.baseline_id ?? "").localeCompare(b.baseline_id ?? "")),
    }));
}

function baselineDisplayName(r: ResultsDocument): string {
  return r.metadata?.baseline_display_name ?? r.baseline_id ?? "(unnamed)";
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(0)} ms`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Pull the median across iterations for one of the optional integer
 * metrics. Returns `null` if any iteration has the metric missing
 * (so the dashboard can render `—` rather than implying a measured
 * zero).
 */
function medianMetric(
  iters: Iteration[],
  pick: (it: Iteration) => number | undefined,
): number | null {
  const values: number[] = [];
  for (const it of iters) {
    const v = pick(it);
    if (v === undefined) return null;
    values.push(v);
  }
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Does the group contain any iteration with `network_calls`
 * populated? Drives whether the dashboard renders the network
 * columns at all (suppressing them keeps the timing-only datasets
 * looking unchanged).
 */
function groupHasNetworkMetrics(group: ManifestGroup): boolean {
  return group.results.some((r) =>
    r.iterations.some((it) => typeof it.network_calls === "number"),
  );
}

function speedupVsSlowest(group: ManifestGroup): Map<string, number | null> {
  const slowest = Math.max(...group.results.map((r) => r.summary.median_wall_ms));
  const out = new Map<string, number | null>();
  for (const r of group.results) {
    const speedup = slowest / r.summary.median_wall_ms;
    out.set(r.baseline_id ?? "", speedup);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

type Props = { params: Promise<{ runId: string }> };

export default async function PreviewPage({ params }: Props) {
  const { runId } = await params;
  const index = await loadIndex(runId);
  if (!index) notFound();

  const docs = await loadResults(runId, index);
  const groups = groupByManifest(docs);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
      {/* Developer-fixture banner — non-removable, top of page. */}
      <aside className="rounded-md border border-amber-400/40 bg-amber-400/10 px-5 py-4 text-sm leading-relaxed">
        <p className="mb-2 font-semibold text-amber-700 dark:text-amber-300">
          Developer fixture — not a canonical reference benchmark
        </p>
        <p className="text-muted-foreground">
          This dataset was produced on a single developer machine (
          <code className="text-foreground">{index.hardware.cpu}</code>,{" "}
          {index.hardware.cores_logical} logical cores, {index.hardware.memory_gb} GB
          RAM, {index.hardware.os}) and has{" "}
          <strong className="text-foreground">not</strong> been signed, peer-reproduced,
          or run on the project&apos;s reference hardware (R-Bench-1 / R-Bench-3).
          The comparison set is limited to barista variants + Apache Maven 3.9.9 only —
          mvnd and Maven 4 baselines are not yet included. Treat the numbers below as
          a data-pipeline preview, not a substantive performance claim.
        </p>
        {runId.endsWith("-capture") && (
          <p className="mt-2 text-muted-foreground">
            <strong className="text-foreground">This is a capture-pass dataset.</strong>{" "}
            Each barista iteration ran through a per-iteration mitmproxy
            reverse-proxy session so the harness could count upstream requests.
            Wall-clock times under capture are mitmproxy-instrumented and{" "}
            <strong>not comparable</strong> to a timing-pass dataset; cross-reference{" "}
            <a
              className="underline decoration-dotted hover:text-foreground"
              href="/preview/walkthrough-2026-05-18-postfix"
            >
              the timing-pass dataset
            </a>{" "}
            for production wall-clock numbers.
          </p>
        )}
        {runId.endsWith("-cold") && (
          <p className="mt-2 text-muted-foreground">
            <strong className="text-foreground">
              This is a cold-cache dataset.
            </strong>{" "}
            Each iteration was routed at a fresh tempdir (
            <code>BARISTA_PATHS__CACHE_DIR</code>,{" "}
            <code>BARISTA_PATHS__M2_REPOSITORY</code>, and{" "}
            <code>MAVEN_OPTS=-Dmaven.repo.local=&hellip;</code>) so every
            iteration genuinely re-fetched the full dependency closure from
            Maven Central. <code>mvn</code>&apos;s capture wiring is not yet
            integrated into the harness — the <code>Upstream calls</code>{" "}
            column reads <code>—</code> for mvn baselines; see the workspace
            tracker for the follow-up.
          </p>
        )}
      </aside>

      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Preview · {runId}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">
          Walkthrough benchmark — {runId}
        </h1>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Run ID</dt>
            <dd className="font-mono text-xs">{index.run_id}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Timestamp</dt>
            <dd className="font-mono text-xs">{index.timestamp}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Git SHA</dt>
            <dd className="font-mono text-xs">{index.git_sha.slice(0, 12)}…</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Runner</dt>
            <dd className="font-mono text-xs">{index.runner_id}</dd>
          </div>
        </dl>
      </header>

      <section className="flex flex-col gap-8">
        {groups.map((group) => (
          <ManifestCard key={group.manifestId} group={group} />
        ))}
      </section>

      <footer className="text-xs text-muted-foreground">
        <p>
          Schema:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">
            barista.bench.results/v1
          </code>{" "}
          — see{" "}
          <a
            className="underline decoration-dotted hover:text-foreground"
            href="https://github.com/buildwithbarista/barista/tree/main/crates/barista-bench/schema"
          >
            crates/barista-bench/schema
          </a>{" "}
          for the JSON Schema sidecars.
        </p>
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Per-manifest comparison card
// ---------------------------------------------------------------------------

function ManifestCard({ group }: { group: ManifestGroup }) {
  const speedups = speedupVsSlowest(group);
  const showNetwork = groupHasNetworkMetrics(group);
  return (
    <article className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-1 font-mono text-lg font-semibold">{group.manifestId}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {group.results[0]?.resolved_command && (
          <>
            Default command:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {group.results[0].resolved_command}
            </code>
          </>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Baseline</th>
              <th className="py-2 pr-4 text-right font-medium">Median</th>
              <th className="py-2 pr-4 text-right font-medium">p95</th>
              <th className="py-2 pr-4 text-right font-medium">Stddev</th>
              <th
                className={`py-2 text-right font-medium ${showNetwork ? "pr-4" : ""}`}
              >
                vs slowest
              </th>
              {showNetwork && (
                <>
                  <th className="border-l border-border py-2 pl-4 pr-4 text-right font-medium">
                    Upstream calls
                  </th>
                  <th className="py-2 text-right font-medium">Bytes</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {group.results.map((r) => {
              const speedup = speedups.get(r.baseline_id ?? "");
              const isFastest =
                Math.abs(
                  Math.max(...[...speedups.values()].filter((v): v is number => v !== null)) -
                    (speedup ?? 0),
                ) < 1e-9;
              const calls = medianMetric(r.iterations, (it) => it.network_calls);
              const bytes = medianMetric(r.iterations, (it) => it.network_bytes);
              return (
                <tr
                  key={r.baseline_id}
                  className="border-b border-border/40 last:border-b-0"
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium">{baselineDisplayName(r)}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.baseline_id}
                    </div>
                  </td>
                  <td className={`py-3 pr-4 text-right font-mono tabular-nums ${
                    isFastest ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""
                  }`}>
                    {formatMs(r.summary.median_wall_ms)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums text-muted-foreground">
                    {formatMs(r.summary.p95_wall_ms)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums text-muted-foreground">
                    ± {formatMs(r.summary.stddev_wall_ms)}
                  </td>
                  <td className={`py-3 text-right font-mono tabular-nums ${showNetwork ? "pr-4" : ""} ${
                    isFastest ? "font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
                  }`}>
                    {speedup === null || speedup === undefined
                      ? "—"
                      : `${speedup.toFixed(2)}×`}
                  </td>
                  {showNetwork && (
                    <>
                      <td className={`border-l border-border py-3 pl-4 pr-4 text-right font-mono tabular-nums ${
                        calls === 0 ? "font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
                      }`}>
                        {calls === null ? "—" : calls.toFixed(0)}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {bytes === null ? "—" : formatBytes(bytes)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {group.results[0]?.iterations.length} measured iterations per baseline ·
        wall-clock milliseconds · &quot;vs slowest&quot; column is{" "}
        <code className="rounded bg-muted px-1 py-0.5">
          median_slowest / median_this_baseline
        </code>
        {showNetwork && (
          <>
            {" "}
            · &quot;Upstream calls&quot; counts distinct HTTP requests to the
            configured upstream (Maven Central by default) captured via
            mitmdump · <code className="rounded bg-muted px-1 py-0.5">—</code>
            {" "}
            for baselines the harness did not capture (mvn / mvnd / forked-mvn
            paths bypass the env hook; their captures live in
            scripts/run-baseline-captures.sh)
          </>
        )}
        .
      </p>
    </article>
  );
}
