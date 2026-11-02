# P0 real API evaluation report — 2026-11-02

## Scope and provenance

This is a new 144-attempt real API run after the P0 shared-worker-prompt update. It uses the frozen Benchmark v1 task set and the existing baseline, context, optimizer, and full matrix: 12 tasks × 4 variants × 3 repeats. The run used `deepseek-flash`, temperature 0, existing request/tool/time/token budgets, and Context settings. Implementation commit: `e92bae1956a39d19ba63ccdaa9319646a65ad5ed`. Benchmark commit: `9fd463f618edfe25e8a683a62b7f540f3e644f90`; benchmark hash: `d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2`. All 144 attempts report `promptVersion: 2`; all 700 model requests report actual model `deepseek-flash` and fingerprint `bc19ba97cbe016479903222bb1578db6`.

All 144 scheduled attempts completed. `eval:verify` passed with no errors. The launcher captured the CLI's final JSON (`attempts: 144`) and empty stderr, but the shell wrapper failed while recording the Node exit code: its final `exit` received an empty value and returned 1. The actual Node exit code was not captured and is not inferred here.

The common budget was 16 model requests including auxiliary requests, 24 tool calls, 120000 ms, 4096 worker output tokens, and 128000 input characters. Optimizer and summary outputs remained capped at min(512, maxOutputTokens). Context settings remained 8192 estimated tokens, trigger ratio 0.75, and four recent rounds. All attempts passed the workspace-integrity check.

## Outcomes

“Functional” means public and acceptance tests both passed, regardless of termination. “Strict” includes acceptable termination. Two tasks passed both test suites but ended at a budget limit.

| Variant | Suite | Functional | Strict success | Requests W/O/S | Tools calls/errors | Tokens in+out |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | S | 18/24 (75.0%) | 18/24 (75.0%) | 87/0/0 | 91/0 | 130,572 |
| baseline | H | 9/12 (75.0%) | 9/12 (75.0%) | 75/0/0 | 186/0 | 265,556 |
| baseline | Overall | 27/36 (75.0%) | 27/36 (75.0%) | 162/0/0 | 277/0 | 396,128 |
| context | S | 19/24 (79.2%) | 19/24 (79.2%) | 86/0/0 | 90/0 | 127,550 |
| context | H | 11/12 (91.7%) | 11/12 (91.7%) | 75/0/0 | 179/1 | 247,221 |
| context | Overall | 30/36 (83.3%) | 30/36 (83.3%) | 161/0/0 | 269/1 | 374,771 |
| optimizer | S | 20/24 (83.3%) | 20/24 (83.3%) | 93/24/0 | 106/0 | 172,288 |
| optimizer | H | 9/12 (75.0%) | 8/12 (66.7%) | 67/12/0 | 153/3 | 279,679 |
| optimizer | Overall | 29/36 (80.6%) | 28/36 (77.8%) | 160/36/0 | 259/3 | 451,967 |
| full | S | 20/24 (83.3%) | 20/24 (83.3%) | 95/24/0 | 106/0 | 178,558 |
| full | H | 8/12 (66.7%) | 7/12 (58.3%) | 49/12/1 | 132/1 | 193,935 |
| full | Overall | 28/36 (77.8%) | 27/36 (75.0%) | 144/36/1 | 238/1 | 372,493 |
| All variants | S | 77/96 (80.2%) | 77/96 (80.2%) | 361/48/0 | 393/0 | 608,968 |
| All variants | H | 37/48 (77.1%) | 35/48 (72.9%) | 266/24/1 | 650/5 | 986,391 |
| All variants | Overall | 114/144 (79.2%) | 112/144 (77.8%) | 627/72/1 | 1,043/5 | 1,595,359 |

W/O/S = worker/optimizer/summary requests. Usage was complete for all 700 dispatched requests. In this run, full minus baseline strict success was +8.33 percentage points on S, −16.67 on H, and 0 overall. Mean Agent duration was 6.71s, 6.58s, 6.78s, and 6.26s for baseline, context, optimizer, and full. Peak duration was 25.15s.

There were 32 strict failures: 18 acceptance-test, 4 public-test, 8 model-error, 1 tool-limit, and 1 request-limit. Two attempts passed both test suites but failed strict success at the budget limit: `h02-chunk-parser-full-1` (tool limit) and `h02-chunk-parser-optimizer-1` (request limit).

## Factor contrasts and per-task outcomes

These are observed within-run percentage-point differences. Context had no actual compression, so the context-baseline difference does not demonstrate summary benefit.

| Suite | Context - baseline | Optimizer - baseline | Full - optimizer | Full - context | Full - baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| S | +4.17 pp | +8.33 pp | +0.00 pp | +4.17 pp | +8.33 pp |
| H | +16.67 pp | -8.33 pp | -8.33 pp | -33.33 pp | -16.67 pp |
| overall | +8.33 pp | +2.78 pp | -2.78 pp | -8.33 pp | +0.00 pp |

| Task | Baseline | Context | Optimizer | Full |
| --- | ---: | ---: | ---: | ---: |
| b01-normalize | 3/3 | 3/3 | 3/3 | 3/3 |
| b02-counter | 3/3 | 3/3 | 3/3 | 3/3 |
| b03-config | 2/3 | 3/3 | 2/3 | 2/3 |
| f01-tags | 3/3 | 3/3 | 3/3 | 3/3 |
| f02-pagination | 3/3 | 3/3 | 3/3 | 3/3 |
| f03-ranges | 3/3 | 3/3 | 3/3 | 3/3 |
| h01-config-pipeline | 1/3 | 3/3 | 3/3 | 3/3 |
| h02-chunk-parser | 2/3 | 2/3 | 2/3 | 2/3 |
| h03-module-navigation | 3/3 | 3/3 | 0/3 | 0/3 |
| h04-issue-refactor | 3/3 | 3/3 | 3/3 | 2/3 |
| m01-report | 0/3 | 0/3 | 0/3 | 0/3 |
| m02-options | 1/3 | 1/3 | 3/3 | 3/3 |

m01 remained 0/3 in every variant: the documented row/aggregate overflow assertion still reports a missing RangeError. m02 baseline/context each missed the specified exception type twice, while optimizer/full passed all three. All six h03 optimizer/full attempts ended at the optimizer output cap before a worker request; this is an auxiliary-call failure rather than failed worker navigation. The seventh optimizer truncation was h04 full repeat 3. Baseline h01 had two public-test failures involving layer precedence, and b03 baseline repeat 2 returned null-prototype objects where the tests expected ordinary objects. These are concrete correctness failures preserved in the per-attempt metrics, not quota failures.

## P0 behavior and comparison limits

The independent audit compares this run with the earlier M9 run. Requests fell from 1065 to 700 (-34.3%), reported tokens from 3116131 to 1595359 (-48.8%), and tool calls from 1669 to 1043 (-37.5%). These are descriptive cross-run counts, not isolated P0 treatment effects.

| Observation | Earlier M9 | P0 run |
| --- | ---: | ---: |
| `permission_denied` tool errors | 46 | 5 |
| `finish=length` | 9 worker | 1 worker + 7 optimizer = 8 |
| Functionally correct attempts ending unsuccessfully | 27 | 2 |
| `read_file` after last successful write | 286 | 42 |
| Functional pass count | 120/144 | 114/144 |
| Strict success count | 93/144 | 112/144 |

Strict success increased while functional passes decreased by six; this does not establish better code correctness. The new baseline has 27/36 functional passes versus 31/36 earlier. New S strict success was 77/96 versus 81/96 earlier. A read after the final successful write is only a sequence marker; the 42 cases are not all proven unnecessary.

The provider fingerprint changed from `aeb56401ca74e127821c4f9126dcb669` earlier to `bc19ba97cbe016479903222bb1578db6` in this run. Cross-run changes cannot be attributed to P0 alone. The four variants remain descriptively comparable within this run, subject to 12 tasks and three repeats per task.

The context variant made zero summary requests and zero compactions across all 36 attempts, so its 30/36 strict successes cannot be explained by observed compression. Full made one summary request and completed one compaction; that summary contains a DSML-like tool-call marker, recorded as plain text rather than a dispatched tool call. All eight `model_error` attempts followed `finish=length`: one worker and seven optimizer responses. The seven optimizer responses were 512-token outputs, matching the optimizer cap. The earlier run's nine length responses were all worker requests. The P0 guidance did not eliminate truncation in auxiliary optimizer calls.

## Interpretation limits

This run tests the P0 prompt change with a changed provider fingerprint. The frozen tasks, variants, and budgets match the earlier run. The shared worker prompt changed with P0, and the provider fingerprint also changed. The within-run full-baseline contrast is descriptive; earlier-versus-newer differences are confounded and do not establish a P0 causal effect. The 12 self-authored tasks and three repeats are not representative of general coding-agent performance.

## Evidence

[Evidence index](evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/README.md), [all failures](evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/metrics/failures.csv), [independent audit](evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/p0-audit.json), and [representative traces](evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/traces/selection.json).

Original run: `runs/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/`. Run-specific metrics, independent audit, verification notes, and the source hash index are in `reports/evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/`.
