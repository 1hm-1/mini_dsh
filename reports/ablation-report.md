# M9 full 2×2 ablation report

The full variant scored **21/36 (58.33%)**, 4 successes below baseline’s **25/36 (69.44%)**, a difference of **−11.11 percentage points**. This run does not show a performance gain from Context, Optimizer, or their combination. The full arm also used more model requests and tokens than baseline. These are results from one frozen 12-task benchmark with three repeats; they do not establish why individual attempts changed.

## Run and lineage

This is the final four-group run, separate from the earlier baseline diagnostic. It contains all 12 frozen benchmark tasks, variants in `specs/variants.json` order, three repeats, and 144 complete HTTP attempts. The model was DeepSeek Flash at temperature 0. Each attempt shared the same limits: 16 total model requests including auxiliary calls, 24 tool calls, 120 seconds, 4096 output tokens, and 128000 input characters. Context settings were 8192 estimated tokens, a 0.75 trigger ratio, and four retained recent rounds. The run dispatched 1,065 requests and reported 3,116,131 input+output tokens. It recorded one model fingerprint (`aeb56401ca74e127821c4f9126dcb669`) across variants.

| Lineage item | Commit/hash |
| --- | --- |
| M6 baseline analysis | `93d075b80ce15616ca019f71153935b5d3ad51cb` |
| Context implementation | `42427e9d5e6e11d37352ba19b3aa9b2dbcdc89ec` |
| Optimizer implementation | `44116325d5a4398e0077f21b9c0db0c854cb5410` |
| M9 run implementation commit recorded in manifest | `6f779ba9712d88fafac76fd6c43df8dbb38e8442` |
| Benchmark v1 commit | `9fd463f618edfe25e8a683a62b7f540f3e644f90` |
| Benchmark v1 manifest SHA-256 | `d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2` |

The run ID is `2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3`. The run command exited 0, meaning the matrix completed; it does not mean all attempts passed. Independent `eval:verify` exited 0 with `passed=true` and no errors. The source run is preserved at `runs/<runId>/`; [the evidence index](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/hash-index.json) lists SHA-256 and byte size for all 1,071 source-run files and the report/evidence artifacts.

The M6 diagnostic remains a separate 36-attempt run and is not included in any success-rate table below. It used 228 model requests and 690,440 reported tokens. Across the two real harness runs there were 180 attempts, 1,293 requests, and 3,806,571 reported tokens. These totals exclude development-agent usage; no dollar cost is estimated.

## Success rates

| Suite | Baseline | Context | Optimizer | Full |
| --- | ---: | ---: | ---: | ---: |
| S (8 tasks × 3) | 21/24 (87.50%) | 20/24 (83.33%) | 21/24 (87.50%) | 19/24 (79.17%) |
| H (4 tasks × 3) | 4/12 (33.33%) | 3/12 (25.00%) | 3/12 (25.00%) | 2/12 (16.67%) |
| Overall (12 tasks × 3) | 25/36 (69.44%) | 23/36 (63.89%) | 24/36 (66.67%) | 21/36 (58.33%) |

The four planned factor contrasts are shown directly as percentage-point differences. Negative values indicate a lower success rate in the left-hand arm.

| Suite | Context − baseline | Optimizer − baseline | Full − optimizer | Full − context | Full − baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| S | −4.17 pp | 0.00 pp | −8.33 pp | −4.17 pp | −8.33 pp |
| H | −8.33 pp | −8.33 pp | −8.33 pp | −8.33 pp | −16.67 pp |
| Overall | −5.56 pp | −2.78 pp | −8.33 pp | −5.56 pp | −11.11 pp |

Each task’s three strict pass/fail outcomes are in [task-success.csv](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/task-success.csv). The table shows every repeat, not the best repeat: m01 failed all 12 attempts; h01 and h02 failed all 12 each; h04 passed only baseline repeat 3; h03 passed baseline/context/optimizer all three times and full twice. S tasks b01, b02, f01, f02, and f03 passed all 12 attempts per task across the four arms. Full also passed b03 twice and m02 twice.

## Requests, tokens, latency, context, and tools

All **1,065 dispatched model requests had complete input/output usage**; known token counts equal totals (100% completeness). Auxiliary calls are included in both request and token totals. Worker-context length below is the evaluator’s estimated input tokens immediately before each worker request, not cumulative API tokens. Latency is attempt-level mean / median / peak in milliseconds.

| Suite | Variant | Success | Worker / optimizer / summary requests (total) | Input / output / combined tokens | Latency mean / median / peak ms | Worker context mean / peak tokens | Tool calls / errors | Compactions | Terminations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| S | Baseline | 21/24 | 136/0/0 (136) | 229,955 / 32,737 / 262,692 | 6,603 / 5,908 / 17,986 | 1,443 / 5,880 | 152 / 1 | 0 | completed 24 |
| S | Context | 20/24 | 140/0/0 (140) | 248,937 / 32,641 / 281,578 | 6,725 / 5,211 / 15,141 | 1,516 / 5,323 | 158 / 2 | 0 | completed 24 |
| S | Optimizer | 21/24 | 140/24/0 (164) | 313,048 / 40,064 / 353,112 | 7,948 / 5,405 / 24,693 | 1,941 / 7,981 | 163 / 7 | 0 | completed 24 |
| S | Full | 19/24 | 151/24/2 (177) | 351,413 / 41,393 / 392,806 | 8,310 / 5,736 / 20,488 | 1,986 / 5,921 | 172 / 10 | 2 | completed 23; request_limit 1 |
| H | Baseline | 4/12 | 102/0/0 (102) | 422,869 / 41,993 / 464,862 | 14,435 / 14,955 / 25,765 | 3,811 / 10,130 | 259 / 8 | 0 | completed 4; model_error 2; tool_limit 6 |
| H | Context | 3/12 | 93/0/5 (98) | 356,541 / 38,577 / 395,118 | 13,559 / 13,684 / 22,578 | 3,410 / 7,783 | 261 / 7 | 5 | completed 3; model_error 2; tool_limit 7 |
| H | Optimizer | 3/12 | 108/12/0 (120) | 457,315 / 46,556 / 503,871 | 16,471 / 17,956 / 24,325 | 3,893 / 9,448 | 247 / 10 | 0 | completed 3; model_error 3; tool_limit 6 |
| H | Full | 2/12 | 109/12/7 (128) | 421,710 / 40,382 / 462,092 | 15,310 / 15,282 / 30,079 | 3,351 / 6,122 | 257 / 2 | 7 | completed 2; model_error 2; tool_limit 8 |
| Overall | Baseline | 25/36 | 238/0/0 (238) | 652,824 / 74,730 / 727,554 | 9,214 / 7,746 / 25,765 | 2,458 / 10,130 | 411 / 9 | 0 | completed 28; model_error 2; tool_limit 6 |
| Overall | Context | 23/36 | 233/0/5 (238) | 605,478 / 71,218 / 676,696 | 9,003 / 7,491 / 22,578 | 2,272 / 7,783 | 419 / 9 | 5 | completed 27; model_error 2; tool_limit 7 |
| Overall | Optimizer | 24/36 | 248/36/0 (284) | 770,363 / 86,620 / 856,983 | 10,789 / 9,082 / 24,693 | 2,791 / 9,448 | 410 / 17 | 0 | completed 27; model_error 3; tool_limit 6 |
| Overall | Full | 21/36 | 260/36/9 (305) | 773,123 / 81,775 / 854,898 | 10,643 / 9,698 / 30,079 | 2,558 / 6,122 | 429 / 12 | 9 | completed 25; model_error 2; request_limit 1; tool_limit 8 |

For full versus baseline, total dispatched requests increased by 67 (28.2%) and combined tokens by 127,344 (17.5%); strict success fell by four attempts. Context had the same total request count as baseline: 233 worker and five summary calls versus 238 worker calls. The aggregate difference does not establish which calls replaced which within individual attempts. Context used 50,858 fewer combined tokens (−7.0%) and had two fewer successes. Optimizer used 46 more requests and 129,429 more tokens than baseline while matching S success and scoring one fewer overall success. Full used 21 more requests and 2,085 fewer tokens than optimizer, but had three fewer successes.

## Context compression evidence

The context mechanism compacted 14 times across 11 attempts: five compactions in context (four attempts) and nine in full (seven attempts). All 14 subsequent worker observations show a lower estimated input length than the pre-compression estimate; reductions ranged from 60 to 3,440 tokens. This confirms that the mechanism reduced the measured projection when it triggered. It does not confirm that each summary preserved all useful meaning.

| Attempt | Compacted event seqs | Summary response seqs | Worker estimate before → after |
| --- | --- | --- | --- |
| b03-config full r1 | 94 | 93 | 6,680 → 3,684 |
| b03-config full r2 | 87 | 86 | 6,667 → 3,522 |
| h01-config-pipeline context r1 | 104 | 103 | 6,182 → 2,911 |
| h01-config-pipeline context r2 | 97 | 96 | 6,340 → 3,379 |
| h01-config-pipeline context r3 | 97 | 96 | 6,206 → 3,282 |
| h01-config-pipeline full r1 | 117 | 116 | 6,437 → 2,997 |
| h01-config-pipeline full r2 | 114 | 113 | 6,493 → 3,241 |
| h01-config-pipeline full r3 | 110 | 109 | 6,985 → 3,823 |
| h02-chunk-parser context r3 | 76, 86 | 75, 85 | 7,843 → 7,783; 7,897 → 5,957 |
| h02-chunk-parser full r1 | 77, 103, 129 | 76, 102, 128 | 6,493 → 5,422; 6,237 → 5,438; 7,705 → 4,288 |
| h03-module-navigation full r1 | 109 | 108 | 6,231 → 3,570 |

The context-only arm had no S compactions; its five compactions all occurred in H. Full had two S and seven H compactions. Baseline and optimizer had no compactions because C was disabled, even though the evaluator observed threshold/eligibility signals in their journals. Across the enabled arms, 11 attempts reached compaction; the remaining enabled-arm attempts did not meet the compaction trigger. The b03-config full r1 request-limit attempt had already compacted at event 94; its request-limit occurred later, so this is an example where compaction did not remove budget exhaustion.

Summary-quality review found DSML-like tool-call markup in **12 of 14** stored summary texts (4/5 context summaries, 8/9 full summaries). Four summaries contained `edit_file` or `write_file` markup with code payload; the remaining marked summaries included read or command invocations. The summary field is plain text, and the journal records no direct tool dispatch from those summary contents. Two concrete examples are preserved with original seqs: [b03-config full r1](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selected/b03-config-full-1.json) returned an edit-file snippet at response 93, compacted at 94, then observed 6,680→3,684 tokens at observation 95; both functional checks passed, but the run ended at request_limit seq 109. [h03-module-navigation full r1](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selected/h03-module-navigation-full-1.json) returned write-file code at response 108, compacted at 109, and observed 6,231→3,570 at observation 110; a later tool call was denied by the tool quota at seq 121 and the run ended at seq 122, though both functional checks passed. These traces expose summary-quality risk; they do not establish that the summaries caused either termination or failure.

The per-event summary text and seqs are in [compactions.json](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/metrics/compactions.json), grouped attempt details are in [compaction-attempts.csv](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/compaction-attempts.csv), and selected raw-event excerpts are in [traces](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selection.json).

## Optimizer and failed constraints

Optimizer returned nonempty text for all 72 dispatched calls: 36 in optimizer and 36 in full. Each successful output and its request/response seq is preserved in [optimizer-outputs.json](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/metrics/optimizer-outputs.json). Despite that, the targeted public-boundary cases did not improve:

- m01 failed all three baseline, context, optimizer, and full repeats. Optimizer/full repeat 1 explicitly retained the row/aggregate overflow requirement in response seq 4; the acceptance assertion `overflow in row and aggregate is rejected` still failed because no `RangeError` was thrown. The [optimizer](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selected/m01-report-optimizer-1.json) and [full](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selected/m01-report-full-1.json) events, after-snapshot parser excerpts, and assertion records are linked in [constraint-cases.json](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/constraint-cases.json).
- m02 passed 3/3 in baseline and optimizer, and 2/3 in context and full. [Context repeat 1](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selected/m02-options-context-1.json) failed because the implementation produced `TypeError` where the task required `RangeError`; [full repeat 3](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selected/m02-options-full-3.json)’s optimizer output names the required `RangeError` at response seq 4, but the after-snapshot resolver still throws `TypeError` for non-integer precision. This shows that advice in the rewritten prompt did not guarantee the corresponding implementation.

## Failures and representative traces

There were 51 strict failures: 27 `tool_limit`, 14 `acceptance_test`, 9 `model_error`, and 1 `request_limit`. All nine model errors were h02 worker responses ending with `finish=length` at the 4096-token output cap, not network outages. The 14 acceptance failures had normal completed termination; they are not model errors. Tool/request limits are unchanged hard budgets, and auxiliary calls count against the same 16-request allowance. The complete [failure CSV](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/metrics/failures.csv) carries each attempt’s run-end, model-error and tool-error event seqs, failing assertion names, and journal/output references. Each failure also has a detailed JSON under `metrics/attempts/`.

Trace selection is fixed in [selection.json](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/traces/selection.json): earliest `orderIndex` per strict failure type; first realized compaction in context and full; first optimizer output in optimizer and full; earliest m01 and m02 attempt in every variant; every full request-limit attempt; every full h03 failure; and m02 full repeat 3 as a constraint/advice counterexample. Selected attempt events are retained in seq order without copying every journal. They include run start/end, auxiliary request/response, compaction, model/tool errors, first/last successful writes, and the last worker response.

h04 illustrates why task outcomes should not be attributed from C triggers alone: only baseline repeat 3 passed; C/context and full did not compact h04 at all. h03 passed all baseline/context/optimizer repeats and failed one full repeat. The context arm’s only S success gap from baseline is m02 context r1, which failed the required exception-type assertion while that arm had zero S compactions; that gap cannot be attributed to an executed summary. C/O activation and repeat-level tool trajectories vary, so these small counts cannot isolate a causal path for each outcome.

## Candidate hypotheses after M9

**HYP-001 — C lowers long-interaction input length.** The mechanical claim is supported on the 11 activated attempts: all 14 persisted compactions reduced the next worker’s estimated input length. The run does not support a downstream quality gain: context scored 23/36 versus baseline 25/36, and full scored 21/36 versus optimizer 24/36. Twelve summaries also contained DSML-like tool markup, so semantic preservation remains a concern. Length reduction is not evidence that the model had forgotten relevant information.

**HYP-002 — O’s public-constraint restatement may reduce omissions.** Not supported by this run. Optimizer scored 24/36 against baseline 25/36; full scored 21/36. m01 remained 0/3 in every arm, and O’s mention of its missed overflow constraint did not produce the required code or passing assertion. m02 optimizer tied baseline at 3/3, while full/context scored 2/3. The tool outputs establish what was suggested and what the code/tests did; they do not establish why the model made those choices.

**HYP-003 — C/O directly remove fixed-budget failures.** Remains unsupported. There were 27 tool-limit terminations and nine output-length model errors; the full arm also had one request-limit termination after using auxiliary budget. The mechanisms did not change any of those fixed limits.

These are descriptive results from 144 scheduled samples. The task set is small and self-built, each task has three repeats, and results can vary with sampling or model service state. No significance test or dollar estimate is claimed. The cost comparison includes every successful and failed attempt and all auxiliary requests; it does not hold worker-request counts equal between arms.

## Evidence and verification

The evaluator’s official [summary](../runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/summary.json) and [report](../runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/report.md) are unchanged. The new [evidence README](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/README.md) describes replay commands and artifact scope; [verify.json](evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/verify.json) records the run/extraction outcomes. The raw-to-derived independent counter matched all variants and suites against both attempt JSON and the evaluator summary.
