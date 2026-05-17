import { buttonVariants } from "@/components/ui/button";

// Revalidate the landing route every 60 seconds. New benchmark uploads
// will eventually trigger tag-based revalidation via a webhook; until
// then, time-based revalidation keeps the run count fresh.
export const revalidate = 60;

// Public R2 bucket URL hosting the benchmark index. Operators configure
// the real bucket URL via the NEXT_PUBLIC_R2_INDEX_URL env var; the
// fallback below lets the route render (with a graceful "no runs yet"
// state) before the bucket is provisioned.
const R2_INDEX_URL =
  process.env.NEXT_PUBLIC_R2_INDEX_URL ??
  "https://barista-bench.r2.dev/index.json";

type IndexSummary = { run_count: number };

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

export default async function Home() {
  const index = await fetchIndex();

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-24">
      <div className="flex max-w-2xl flex-col items-start gap-8">
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
            ? `${index.run_count} run${
                index.run_count === 1 ? "" : "s"
              } tracked.`
            : "No runs published yet. Check back once the harness starts uploading results."}
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
      </div>
    </main>
  );
}
