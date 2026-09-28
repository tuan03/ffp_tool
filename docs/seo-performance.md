# Server SEO performance

SEO runs in `scripts/shopify-pipeline-worker.ts`, independently of Amazon crawler agents.
The worker retains the complete B1–B6 pipeline. Increasing crawler agents does not
increase the server's Gemini capacity.

## Configuration

Set server environment variables before starting `npm run dev:pipeline` (or restart
the pipeline process launched by `npm run dev` after changing them):

| Variable | Default | Scope |
| --- | --- | --- |
| `SHOPIFY_PIPELINE_WORKERS` | 8 | Concurrent product workflows |
| `GEMINI_REQUEST_CONCURRENCY` | 4 | All Gemini requests in this Node process |
| `SEO_EMBEDDING_CONCURRENCY` | 2 | Vertex embedding requests in this process |
| `SEO_SUGGEST_CONCURRENCY` | 3 | Google Suggest requests (hard cap 3); starts remain at least 250 ms apart |

An explicitly configured `GEMINI_VISION_CONCURRENCY` remains a legacy fallback
when `GEMINI_REQUEST_CONCURRENCY` is absent. Set the new variable to configure the
shared limit. These limits are per process; multiple pipeline processes multiply
the overall request rate. The Windows crawler agent does not need rebuilding.

## Reusing work safely

`runSeoContentDetailed` retains its existing call contract. The public
`createSeoContentSession(input, options)` API returns a session with `run()`:

- The first call executes B1–B6.
- Subsequent calls retain that product's B1–B3 research and fallback metadata,
  then run B4 against a fresh keyword corpus snapshot.
- B5's actual facts, allocated keywords and constraints determine whether B5/B6
  must run again. An unchanged input retains the generated content and image alts.
- A session cannot execute concurrently with itself or be reused for another input.

`SeoCorpusCommitCoordinator.prepare` accepts optional `rebaseSeo` and `corpusKey`.
Existing callers remain compatible. Only registration runs inside each corpus's
write queue. Revision checks, file locks and the bounded revision retry policy
remain in force. The default revision retry budget is 32, covering a 16-worker
cohort with room for additional commits; callers can still set a lower explicit
bound. Review becomes available only after successful registration.

Gemini and embedding retries acquire a fresh slot after backoff. Cancellation
propagates to queued work, network requests and backoff. A registration already
writing atomically finishes and returns its reservation so cancellation cleanup
can remove it. `SeoCorpusReservation` releases claims in the worker’s `finally`
block after handled errors as well as thrown errors, unless review was persisted.

Google Suggest uses a shared 15-minute, 500-entry cache and coalesces identical
requests. Cancelling one subscriber preserves work needed by other subscribers.
Probe results are reduced in their original order, preserving priority, evidence
and result limits. Errors are not cached.

Vertex vectors use a 24-hour, 10,000-entry cache scoped by project, location,
model, task type, native vector space and exact text. Only complete finite vectors
are cached. Local TF-IDF vectors continue to be recalculated for each snapshot.

## Observability

Optional `metadata.performance` / summary `performance` records cumulative B1–B6
durations, provider queue/request time, retry waits, request/retry/cache counts,
corpus commit time and revision retries. Pipeline details display these before
Shopify sync. Older records without this metadata remain supported.

Stage times include their own queue and retry waits. Provider times aggregate
across requests and can overlap; do not sum them with stage durations to infer
elapsed product time. A coalesced request's network metrics belong to the caller
that started it. Added worker performance logs contain task ID, step and numbers.

## Isolated live benchmark

Prepare an ignored JSON array of at least 20 normalized crawler products and a
copy of the target store's keyword corpus. Keep both inputs identical across runs.
This benchmark makes live Google requests and does not call Shopify. It creates a
new output directory and writes keyword registrations only to its corpus copy.

```powershell
node --import tsx scripts/benchmark-seo.mjs --inputs=.runtime/benchmark-products.json --corpus=.runtime/benchmark-seed-corpus.json --store=store-id --output=.runtime/benchmark-8-4 --workers=8 --gemini=4
```

Repeat in separate processes with `12/6` and `16/8`, using new output directories.
Use `--code-root=<archived-checkout> --baseline=true --workers=4` to measure the old
implementation with its B1 limit of one. Archive the baseline source before making
changes; keep dependencies identical. The store scope must match the copied corpus.

Each run writes samples and a report with successful products/minute, p50/p95,
request counts, errors and fallback products. SDK fetch counts include retries;
provider metadata measures application attempts. The harness uses the same `ipv4first` DNS order as the production worker.
Run configurations sequentially
to avoid competing with each other. Promote a higher setting only if throughput
improves by at least 10%, p95 does not increase, and errors/fallback do not increase.
Live model and network variability still warrant checking subsequent real batches.

## Measured acceptance results — 2026-09-27

The baseline was commit `b1e64524d1d81f020bad6c7014891ef08c7ae092`.
All four measured runs used the same 23 normalized products, a fresh copy of the
same 71-product keyword corpus with its original store scope, the same installed
dependencies, and the production worker's `ipv4first` DNS order. Each run started
in a separate process with cold in-memory caches. Models remained
`gemini-2.5-flash` for analysis/content and `text-embedding-004` for embeddings.
No Shopify writes were performed.

| Configuration | Products/min | Product p50 | Product p95 | Errors | Products using fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline: 4 workers, B1 limit 1 | 1.34 | 156.9 s | 290.7 s | 0 | 0 |
| 8 workers / 4 Gemini | 5.71 | 66.4 s | 106.2 s | 0 | 0 |
| 12 workers / 6 Gemini | 7.88 | 63.0 s | 112.4 s | 0 | 0 |
| 16 workers / 8 Gemini | 8.12 | 86.8 s | 140.7 s | 0 | 0 |

The baseline predates the shared Gemini limiter; its report's `gemini` argument
must not be interpreted as a global limit. Product latency starts when a worker
takes that product and includes keyword registration/reconciliation. Throughput
uses the entire batch's elapsed time. Percentiles use the nearest-rank method.

| Configuration | Gemini requests | Embedding requests | Suggest requests |
| --- | ---: | ---: | ---: |
| Baseline | 187 | 221 | 688 |
| 8 / 4 | 101 | 85 | 215 |
| 12 / 6 | 102 | 75 | 211 |
| 16 / 8 | 118 | 81 | 203 |

**Selected defaults: 8 workers / 4 Gemini / 2 embeddings / 3 Suggest.**
This configuration delivered 4.26 times the baseline throughput and reduced p95
by 63.5% in this sample. Both higher configurations failed the agreed p95 gate,
so neither was promoted. All runs completed 23/23 unique products. Existing
fallback rules and validation remained enabled.

Raw reports and per-product samples are kept locally under
`.runtime/seo-speed-benchmark/final-baseline`, `final-8-4`, `final-12-6`, and
`final-16-8`. Earlier diagnostic runs used an incorrect store scope or DNS setup
and are excluded from these results. Production records and generated content
are not committed. This is one live run per configuration, not a guarantee for
different products, network conditions, or provider load; generated prose was
not independently graded. Restart the server pipeline process to load the new
implementation and defaults. No crawler agent rebuild is required.

Verification passed: `npm test` (4 tooling, 648 web, 224 gateway, and 178 Python
tests with one existing skip), `npm run typecheck`, `npm run build`, and
`npm run build:mock`. Builds retained the existing chunk-size warning.
