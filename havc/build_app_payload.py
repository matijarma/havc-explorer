"""Build ``data.app.json`` — the slim boot payload for the web app.

``data.json`` is the full public registry and stays published unchanged as the
source of truth. But the web app reads only a fraction of it: no ``raw_text``
(32.7% of the file), no ``curation``/``extras``/``validation`` ledgers (most of
the row bytes). This script projects each record onto exactly the fields the
app's adapter consumes, so the browser parses ~5 MB instead of ~18 MB and pulls
~1 MB over the wire instead of ~3.5 MB.

The allowlist below is derived from the raw-field accesses in ``web/main.js``
(``makeRecordId``, ``adaptExtractedRecords``, ``processResultsRecord``,
``extractEventDoc`` — the only functions that touch raw records). If the app
starts reading a new field, add it HERE too, or the app will silently lose it:
the equivalence check in web/README's verification step (headline totals) is
the safety net.

Notes that are easy to get wrong:
  - ``source.sha256`` looks droppable but feeds ``makeRecordId`` — dropping it
    would change every record id.
  - ``source_url_missing`` distinguishes "no URL recorded" from "URL unknown".

Usage:  python havc/build_app_payload.py   (reads/writes next to itself)
Also imported by clean_data.py --apply so the two files never drift.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "data.json"
APP_PATH = HERE / "data.app.json"

SOURCE_FIELDS = (
    "sha256",
    "filename",
    "filename_decoded",
    "source_url",
    "url",
    "source_url_missing",
)

DOCUMENT_FIELDS = (
    "year",
    "program_type",
    "rok",
    "currency",
    "natjecaj_title",
    "decision_date",
    "decision_body",
    "summary",
    "referenced_projects",
)

PROJECT_LINK_FIELDS = (
    "source_title",
    "family_id",
    "family_title",
    "match_status",
    "method",
    "confidence",
)

ROW_FIELDS = (
    "row_id",
    "row_number",
    "project_title",
    "project_family_id",
    "project_family_title",
    "applicant",
    "production_company",
    "entity",
    "director",
    "writer",
    "category",
    "currency",
    "approved_amount",
    "funding_status",
)


def _pick(obj: Any, fields: tuple[str, ...]) -> dict:
    if not isinstance(obj, dict):
        return {}
    return {k: obj[k] for k in fields if k in obj}


def slim_record(rec: dict) -> dict:
    out: dict = {"doc_type": rec.get("doc_type")}
    out["source"] = _pick(rec.get("source"), SOURCE_FIELDS)

    document = _pick(rec.get("document"), DOCUMENT_FIELDS)
    links = rec.get("document", {}).get("project_links") if isinstance(rec.get("document"), dict) else None
    if isinstance(links, list):
        document["project_links"] = [_pick(l, PROJECT_LINK_FIELDS) for l in links]
    out["document"] = document

    totals = rec.get("totals")
    if isinstance(totals, dict) and "ukupno" in totals:
        out["totals"] = {"ukupno": totals["ukupno"]}

    sections = rec.get("sections")
    if isinstance(sections, list):
        out["sections"] = [
            {
                "section_label": sec.get("section_label") if isinstance(sec, dict) else None,
                "rows": [_pick(r, ROW_FIELDS) for r in (sec.get("rows") or [])] if isinstance(sec, dict) else [],
            }
            for sec in sections
        ]
    return out


def _amount_sum(records: list) -> float:
    total = 0.0
    for rec in records:
        for sec in rec.get("sections") or []:
            for row in sec.get("rows") or []:
                v = row.get("approved_amount")
                if isinstance(v, (int, float)):
                    total += v
    return total


def _row_count(records: list) -> int:
    return sum(len(sec.get("rows") or []) for rec in records for sec in (rec.get("sections") or []))


def build_app_payload(records: list) -> list:
    if not isinstance(records, list):
        raise SystemExit("data.json must be an array of extraction records")
    slim = [slim_record(r) for r in records]

    # Equivalence assertions: the projection must never change what the app
    # would compute. Any failure here means the allowlist above is wrong.
    assert len(slim) == len(records), "record count changed"
    full_types = [r.get("doc_type") for r in records]
    slim_types = [r.get("doc_type") for r in slim]
    assert full_types == slim_types, "doc_type sequence changed"
    assert _row_count(slim) == _row_count(records), "row count changed"
    full_sum, slim_sum = _amount_sum(records), _amount_sum(slim)
    assert abs(full_sum - slim_sum) < 0.005, f"approved_amount sum drifted: {full_sum} vs {slim_sum}"
    return slim


def main() -> int:
    records = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    slim = build_app_payload(records)
    text = json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n"
    APP_PATH.write_text(text, encoding="utf-8", newline="\n")
    full_b = DATA_PATH.stat().st_size
    app_b = APP_PATH.stat().st_size
    print(f"wrote {APP_PATH.name}: {app_b:,} bytes ({app_b / 2**20:.2f} MiB) "
          f"from {full_b:,} ({full_b / 2**20:.2f} MiB) — {100 - 100 * app_b / full_b:.1f}% smaller")
    return 0


if __name__ == "__main__":
    sys.exit(main())
