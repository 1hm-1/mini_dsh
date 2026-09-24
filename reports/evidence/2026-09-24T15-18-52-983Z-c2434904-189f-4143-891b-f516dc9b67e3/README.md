# M9 full ablation evidence

This evidence set is derived only from the complete 144-attempt M9 run. The original run remains under `runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/`; the full run and task workspaces are not duplicated here. A few small after-snapshot source excerpts needed to inspect constraint failures are included. `hash-index.json` records every original run file and every derived evidence artifact, plus the report hash.

The run used the committed ablation config with 12 frozen tasks, four variants, three repeats, DeepSeek Flash, temperature 0, shared limits of 16 model requests/24 tool calls/120 seconds/4096 output tokens/128000 input characters, and Context settings 8192/0.75/4. It completed with provider `http`, 144 results, and a passing independent evaluator verification.

## Reproduce the offline extraction

The extractor reads `manifest.json`, all scheduled `result.json` and `journal.jsonl` files, and the evaluator summary. It makes no provider calls and writes only to a new output directory.

```sh
mkdir -p /tmp/m9-replay
node --import tsx reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/metrics.mjs runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 /tmp/m9-replay/metrics
node reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/counter.mjs runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 /tmp/m9-replay/metrics
node reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/build-evidence.mjs runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 /tmp/m9-replay
node reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/extract-traces.mjs runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 /tmp/m9-replay
npm run eval:verify -- --run runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3
```

After the report and evidence are finalized, the source/artifact index can be rebuilt with:

```sh
node reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/hash-index.mjs runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 reports/ablation-report.md
```

The attempt extractor includes `variant` in every request, repeated-call, read-back, tool-error, failure, optimizer, and compaction row. The independent counter partitions by both variant and suite, compares raw result/journal values with all 144 derived attempt files, then checks every group against the evaluator's `summary.json`. Both comparisons passed. The M9 extractor and counter were independently rerun during review; all 157 generated metric files matched byte for byte, and repeated-call/read-back/error rows were checked for task/variant/repeat identity.

## Evidence files

- `metrics/attempts/`: one derived JSON per scheduled attempt, including failure assertions, related event sequences, model requests, tool calls, and artifact references.
- `metrics/attempt-summary.csv`, `metrics/request-growth.csv`: per-attempt and per-request cost/context data with variant included.
- `metrics/failures.csv`: every strict failure with termination seq, failed assertions, model-error response seqs, tool error seqs, and journal/test-output paths.
- `metrics/compactions.json`, `metrics/compactions.csv`: all 14 persisted compactions, summary response and event seqs, summary text, and estimated input length before/after.
- `metrics/optimizer-outputs.json`, `metrics/optimizer-outputs.csv`: all 72 dispatched optimizer outputs with response seq and returned text.
- `summary.csv`, `contrasts.csv`, `task-success.csv`: suite/overall summaries, four planned factor contrasts and full-baseline, and all task-by-variant three-repeat outcomes.
- `compaction-attempts.csv`, `compression-summary.json`: the 11 attempts that actually compacted and the aggregate count of summary text containing tool-call markup.
- `traces/selection.json`: trace-selection rules and selected attempt references. `traces/compaction-excerpts.json` and `traces/optimizer-excerpts.json` preserve the corresponding short mechanism traces.
- `traces/selected/*.json`: selected original events in sequence order, with the selection reasons and source journal hash. Failed as well as quota-denied tool results are paired with their `tool_start`. `traces/constraint-cases.json` includes the relevant after-snapshot source files and matching public acceptance assertions for m01/m02.
- `hash-index.json`: SHA-256/size index of the original run and derived evidence/report.
- `verify.json`: actual run, evaluator verify, extraction, counter, and assembly command outcomes.

Summary text is plain text even when it contains DSML-like `invoke` markup. Those strings did not become tool calls; the journal has no matching tool dispatch from the summary. The index retains the original event sequence and text so a reviewer can inspect the boundary. Raw model text and source files remain in the local original run for trace review.
