# Audit task: verify normalize-pass plan

You are auditing a normalization pass on a Croatian audiovisual funding registry (HAVC). The dataset is `havc/data.json`. 18 `results_table` records have no `source.source_url` (no link to the official HAVC PDF). A deterministic Python pre-pass produced `havc/codex-audit-input.json` containing:

- `plan`: per-doc, per-row classification (deterministic match by `(normTitle(project_title), approved_amount, program_type)`)
- `urlless_docs`: full source/document/sections for the 18 urlless records (keyed by sha256)
- `twin_docs`: compact view of the urlful records that contain proposed twin rows (keyed by sha256)

Per-row decisions are either:
- `drop_row` — row has at least one exact-twin match in a urlful doc; the urlless copy is a duplicate to remove
- `flag_row` — no twin found; row is unique and should be kept (with `source_url_missing=true`)

Per-doc classifications (derived):
- `drop_doc`  — all rows drop
- `partial`   — some rows drop, some flag
- `flag_doc`  — no rows drop

## Your task

For each urlless doc, verify that the per-row decisions are correct by examining the urlless doc's `raw_text`/`sections` and the twin doc's `rows`. Specifically check:

1. **For each `drop_row`**: confirm the twin is genuine — same project, same round, same funding decision (not just a coincidental amount/title collision across different rounds).
2. **For each `flag_row`**: confirm no twin was missed due to spelling variants (e.g., diacritics encoded as `_`, abbreviated names, rounding of amounts, mojibake). If you find a missed twin, change the row to `drop_row` and add the twin sha to `matched_twins`.

## Output

Write your verified decisions to `havc/normalize-decision.json` as an array with the same shape as `plan` (each entry needs `doc_sha`, `classification`, and `rows` with `row_index` and `row_decision`). Keep entries even when you make no changes. Do not modify `data.json` or any other file.

Be conservative: when in doubt, keep `flag_row` (the row stays, just without a PDF link) rather than risk dropping a legitimate funding decision.

When done, print a one-line summary of how many decisions you changed and exit.
