# P0 API control evidence

This evidence set belongs only to run `2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac`. The raw run is preserved at `runs/<runId>/`; this folder contains derived metrics, the independent P0 audit, and hashes. It does not replace or append to the earlier M9 evidence.

- `metrics/`: 144 per-attempt derivations; raw/derived counts match the evaluator summary in `independent-counter.json`.
- `p0-audit.py`: independent raw-event auditor; accepts NEW_RUN OLD_RUN OUTPUT_JSON.
- `p0-audit.json`: independent raw-event comparison, prompt version, model fingerprint, per-group functional and strict results, and P0 indicators.
- `README.md`: this index.
- `verify.json`: actual run and offline verification/extraction commands and outcomes.
- `hash-index.json`: hashes for every raw-run file, this evidence set, and the report.

The evaluation CLI emitted a final JSON result with `attempts: 144`; stderr was empty. The wrapper then failed to capture the Node exit status because its final shell `exit` received an empty argument. The wrapper's own exit was 1. The Node exit code is unknown; do not treat the wrapper status as the CLI status. Independent `eval:verify` passed.

Offline metrics can be regenerated without provider calls using the commands recorded in `verify.json`. The metrics/counter generators are reused from the earlier evidence set and write only into a new output directory.


Representative excerpts are selected by earliest schedule order per strict failureReason, plus the first actual compaction; see traces/selection.json. Five traces retain 41 original events, original seq values, and source-journal hashes. They are excerpts, not full replay histories.

To regenerate the independent audit offline, run:
python3 reports/evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/p0-audit.py runs/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac runs/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3 /tmp/p0-audit-replay.json

After any derived-report edits, rebuild trace excerpts and the index offline:
python3 reports/evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac/build-review.py runs/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac reports/evidence/2026-11-02T15-05-36-983Z-7a50e349-25e7-4b93-bd7f-abadcc7043ac reports/p0-api-report-2026-11-02.md runs/p0-api-control-20261102-01

The index also includes the three control files (including the one-byte exit-code file); none was repaired or rewritten to imply a captured Node status.
