import { promises as fs } from "node:fs";
import path from "node:path";

import { buttonVariants } from "@/components/ui/button";

// Revalidate the landing route every 60 seconds. New benchmark uploads
// will eventually trigger tag-based revalidation via a webhook; until
// then, time-based revalidation keeps the run count fresh.
export const revalidate = 60;

// Public R2 bucket URL hosting the canonical benchmark index. Operators
// configure the real bucket URL via the NEXT_PUBLIC_R2_INDEX_URL env
// var; the fallback below lets the route render (with a graceful "no
// runs yet" state) before the bucket is provisioned.
const R2_INDEX_URL =
  process.env.NEXT_PUBLIC_R2_INDEX_URL ??
  "https://barista-bench.r2.dev/index.json";

type IndexSummary = { run_count: number };

type PreviewMeta = {
  run_id: string;
  timestamp: string;
  git_sha: string;
  runner_id: string;
  hardware: {
    cpu: string;
    cores_logical: number;
    memory_gb: number;
    os: string;
  };
  result_count: number;
};

async function fetchIndex(): Promise<IndexSummary | null> {
  try {
    const response = await fetch(R2_INDEX_URL, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (Array.isArray(data)) {
      return { run_count: data.length };
    }
    if (
      data &&
      typeof data === "object" &&
      "runs" in data &&
      Array.isArray((data as { runs: unknown[] }).runs)
    ) {
      return { run_count: (data as { runs: unknown[] }).runs.length };
    }
    return { run_count: 0 };
  } catch {
    return null;
  }
}

/**
 * Enumerate the developer-fixture preview datasets vendored under
 * `public/preview/`. Each subdirectory's `index.json` is the v1 index
 * document the harness writes.
 */
async function listPreviews(): Promise<{ runId: string; meta: PreviewMeta }[]> {
  const root = path.join(process.cwd(), "public", "preview");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const previews = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const indexPath = path.join(root, e.name, "index.json");
        try {
          const raw = await fs.readFile(indexPath, "utf-8");
          const parsed = JSON.parse(raw) as {
            run_id?: string;
            timestamp?: string;
            git_sha?: string;
            runner_id?: string;
            hardware?: PreviewMeta["hardware"];
            results?: string[];
          };
          if (!parsed.run_id || !parsed.hardware) return null;
          return {
            runId: e.name,
            meta: {
              run_id: parsed.run_id,
              timestamp: parsed.timestamp ?? "",
              git_sha: parsed.git_sha ?? "",
              runner_id: parsed.runner_id ?? "",
              hardware: parsed.hardware,
              result_count: parsed.results?.length ?? 0,
            },
          };
        } catch {
          return null;
        }
      }),
  );
  return previews
    .filter((p): p is { runId: string; meta: PreviewMeta } => p !== null)
    .sort((a, b) => b.meta.timestamp.localeCompare(a.meta.timestamp));
}

export default async function Home() {
  const [index, previews] = await Promise.all([fetchIndex(), listPreviews()]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16 sm:py-24">
      <header className="flex flex-col items-start gap-6">
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Pre-release · v0.1 in active development
        </span>
        <h1 className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
          Barista benchmarks
        </h1>
        <p className="text-xl leading-relaxed text-muted-foreground">
          Performance and efficiency results from the Barista benchmark
          harness, published per release tag. Interactive trend charts and
          per-runner breakdowns land here as the project matures.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground">
          {index
            ? `${index.run_count} canonical run${
                index.run_count === 1 ? "" : "s"
              } tracked.`
            : "No canonical runs published yet. Reference-hardware (R-Bench-1 / R-Bench-3) results begin landing here once the Tier-3 hardware comes online."}
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://barista.build"
            className={buttonVariants({ size: "lg" })}
          >
            About Barista
          </a>
          <a
            href="https://github.com/buildwithbarista/barista"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            View on GitHub
          </a>
        </div>
      </header>

      {previews.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight">
              Developer-fixture previews
            </h2>
            <p className="text-sm text-muted-foreground">
              Datasets produced on individual developer machines and
              committed to this repository as data-pipeline fixtures.{" "}
              <strong className="text-foreground">
                Not the canonical reference numbers.
              </strong>{" "}
              Useful for inspecting the schema and the comparison UI; not
              a substitute for the Tier-3 numbers that will land on the
              homepage above.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {previews.map(({ runId, meta }) => (
              <li
                key={runId}
                className="rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/40"
              >
                <a href={`/preview/${runId}`} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-medium">
                      {runId}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {meta.timestamp}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {meta.result_count} result
                      {meta.result_count === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span>{meta.hardware.cpu}</span>
                    <span>·</span>
                    <span>{meta.hardware.cores_logical} cores</span>
                    <span>·</span>
                    <span>{meta.hardware.os}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
