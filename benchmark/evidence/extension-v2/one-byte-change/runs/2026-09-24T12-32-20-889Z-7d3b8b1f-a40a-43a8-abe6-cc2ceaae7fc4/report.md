# Evaluation report: 2026-09-24T12-32-20-889Z-7d3b8b1f-a40a-43a8-abe6-cc2ceaae7fc4

Provider: **mock (engineering validation; no real-model performance claim)**. Phase: **smoke**.
Selected tasks: b13-extension; variants: baseline; repeats: 1; samples: 1.
Implementation commit: 3a508238825a9856c7cb16f20b82dd1dba0c67f0; dirty: true; benchmark commit: unknown; benchmark hash: unknown.
Started at: 2026-09-24T12:32:21.153Z; Node: v24.20.0.
Configured model: offline-smoke; endpoint: http://127.0.0.1:1/chat/completions; temperature: 0; budget: {"maxModelRequests":5,"maxToolCalls":5,"timeoutMs":5000,"maxOutputTokens":100,"maxInputChars":20000}; context: {"estimatedWindowTokens":8192,"triggerRatio":0.75,"keepRecentRounds":4}.

| Variant | Suite | Success | Rate | Full − baseline (pp) | Requests total / worker / optimizer / summary | Tools calls / errors |
| --- | --- | ---: | ---: | ---: | --- | --- |
| baseline | S | 1/1 | 100.0% | unknown | 3 / 3 / 0 / 0 | 2 / 0 |
| baseline | H | 0/0 | unknown | unknown | 0 / 0 / 0 / 0 | 0 / 0 |
| baseline | overall | 1/1 | 100.0% | unknown | 3 / 3 / 0 / 0 | 2 / 0 |
| all | S | 1/1 | 100.0% | unknown | 3 / 3 / 0 / 0 | 2 / 0 |
| all | H | 0/0 | unknown | unknown | 0 / 0 / 0 / 0 | 0 / 0 |
| all | overall | 1/1 | 100.0% | unknown | 3 / 3 / 0 / 0 | 2 / 0 |

All costs include failed attempts and auxiliary requests. Token totals become unknown when any dispatched request lacks that usage field; known portions and completeness remain visible. Zero dispatched requests have total 0 and completeness unknown.

## baseline / S

Tokens input: 9 (known 9; 3/3, completeness 100.0%); output: 6 (known 6; 3/3, completeness 100.0%); combined: 15 (known 15; 3/3, completeness 100.0%).
Agent latency ms mean / median / peak: 4.94 / 4.94 / 4.94 (n=1).
Public check duration ms mean / median / peak: 35.97 / 35.97 / 35.97 (n=1); known 1, unknown 0, known sum 35.97; total 35.97.
Acceptance check duration ms mean / median / peak: 50.34 / 50.34 / 50.34 (n=1); known 1, unknown 0, known sum 50.34; total 50.34.
Worker context request chars mean / median / peak: 2525 / 2534 / 2947 (n=3); estimated input tokens: 555.33 / 558 / 650 (n=3); precompression estimate: 555.33 / 558 / 650 (n=3); older rounds: 0 / 0 / 0 (n=3).
Threshold requests: 0; compaction eligible: 0; compactions: 0.
Termination: {"completed":1}; failure reasons: {}.
Actual models: ["offline-smoke"]; fingerprints: [].

## baseline / H

Tokens input: 0 (known 0; 0/0, completeness unknown); output: 0 (known 0; 0/0, completeness unknown); combined: 0 (known 0; 0/0, completeness unknown).
Agent latency ms mean / median / peak: unknown / unknown / unknown (n=0).
Public check duration ms mean / median / peak: unknown / unknown / unknown (n=0); known 0, unknown 0, known sum 0; total 0.
Acceptance check duration ms mean / median / peak: unknown / unknown / unknown (n=0); known 0, unknown 0, known sum 0; total 0.
Worker context request chars mean / median / peak: unknown / unknown / unknown (n=0); estimated input tokens: unknown / unknown / unknown (n=0); precompression estimate: unknown / unknown / unknown (n=0); older rounds: unknown / unknown / unknown (n=0).
Threshold requests: 0; compaction eligible: 0; compactions: 0.
Termination: {}; failure reasons: {}.
Actual models: []; fingerprints: [].

## baseline / overall

Tokens input: 9 (known 9; 3/3, completeness 100.0%); output: 6 (known 6; 3/3, completeness 100.0%); combined: 15 (known 15; 3/3, completeness 100.0%).
Agent latency ms mean / median / peak: 4.94 / 4.94 / 4.94 (n=1).
Public check duration ms mean / median / peak: 35.97 / 35.97 / 35.97 (n=1); known 1, unknown 0, known sum 35.97; total 35.97.
Acceptance check duration ms mean / median / peak: 50.34 / 50.34 / 50.34 (n=1); known 1, unknown 0, known sum 50.34; total 50.34.
Worker context request chars mean / median / peak: 2525 / 2534 / 2947 (n=3); estimated input tokens: 555.33 / 558 / 650 (n=3); precompression estimate: 555.33 / 558 / 650 (n=3); older rounds: 0 / 0 / 0 (n=3).
Threshold requests: 0; compaction eligible: 0; compactions: 0.
Termination: {"completed":1}; failure reasons: {}.
Actual models: ["offline-smoke"]; fingerprints: [].

## all / S

Tokens input: 9 (known 9; 3/3, completeness 100.0%); output: 6 (known 6; 3/3, completeness 100.0%); combined: 15 (known 15; 3/3, completeness 100.0%).
Agent latency ms mean / median / peak: 4.94 / 4.94 / 4.94 (n=1).
Public check duration ms mean / median / peak: 35.97 / 35.97 / 35.97 (n=1); known 1, unknown 0, known sum 35.97; total 35.97.
Acceptance check duration ms mean / median / peak: 50.34 / 50.34 / 50.34 (n=1); known 1, unknown 0, known sum 50.34; total 50.34.
Worker context request chars mean / median / peak: 2525 / 2534 / 2947 (n=3); estimated input tokens: 555.33 / 558 / 650 (n=3); precompression estimate: 555.33 / 558 / 650 (n=3); older rounds: 0 / 0 / 0 (n=3).
Threshold requests: 0; compaction eligible: 0; compactions: 0.
Termination: {"completed":1}; failure reasons: {}.
Actual models: ["offline-smoke"]; fingerprints: [].

## all / H

Tokens input: 0 (known 0; 0/0, completeness unknown); output: 0 (known 0; 0/0, completeness unknown); combined: 0 (known 0; 0/0, completeness unknown).
Agent latency ms mean / median / peak: unknown / unknown / unknown (n=0).
Public check duration ms mean / median / peak: unknown / unknown / unknown (n=0); known 0, unknown 0, known sum 0; total 0.
Acceptance check duration ms mean / median / peak: unknown / unknown / unknown (n=0); known 0, unknown 0, known sum 0; total 0.
Worker context request chars mean / median / peak: unknown / unknown / unknown (n=0); estimated input tokens: unknown / unknown / unknown (n=0); precompression estimate: unknown / unknown / unknown (n=0); older rounds: unknown / unknown / unknown (n=0).
Threshold requests: 0; compaction eligible: 0; compactions: 0.
Termination: {}; failure reasons: {}.
Actual models: []; fingerprints: [].

## all / overall

Tokens input: 9 (known 9; 3/3, completeness 100.0%); output: 6 (known 6; 3/3, completeness 100.0%); combined: 15 (known 15; 3/3, completeness 100.0%).
Agent latency ms mean / median / peak: 4.94 / 4.94 / 4.94 (n=1).
Public check duration ms mean / median / peak: 35.97 / 35.97 / 35.97 (n=1); known 1, unknown 0, known sum 35.97; total 35.97.
Acceptance check duration ms mean / median / peak: 50.34 / 50.34 / 50.34 (n=1); known 1, unknown 0, known sum 50.34; total 50.34.
Worker context request chars mean / median / peak: 2525 / 2534 / 2947 (n=3); estimated input tokens: 555.33 / 558 / 650 (n=3); precompression estimate: 555.33 / 558 / 650 (n=3); older rounds: 0 / 0 / 0 (n=3).
Threshold requests: 0; compaction eligible: 0; compactions: 0.
Termination: {"completed":1}; failure reasons: {}.
Actual models: ["offline-smoke"]; fingerprints: [].

Zero compactions: this run provides no evidence about the effect of active compression.

