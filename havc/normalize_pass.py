"""Partition urlless results_table records into DROP / FLAG.

Reads dash/havc/data.json. Emits:
  - normalize-plan.json  (machine-readable partition)
  - normalize-plan.md    (human-readable summary)

Logic mirrors dash/main.js normTitle (lines 225-228):
  lowercase -> NFKD -> strip combining marks -> d/D for crowat dj -> non-alnum runs collapsed.

A urlless results_table doc is classified:
  DROP -- >= 80% of its rows have an exact twin (normTitle, approved_amount, program_type)
          in some urlful results_table doc.
  FLAG -- otherwise (orphan rows / mixed). Doc kept; rows marked source_url_missing.

Subcommands:
  partition          -- read data.json, write plan + md (default)
  apply <decision>   -- read normalize-decision.json, mutate data.json in place.
"""

import json
import os
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data.json"
PLAN_JSON = HERE / "normalize-plan.json"
PLAN_MD = HERE / "normalize-plan.md"
DECISION_JSON = HERE / "normalize-decision.json"


def norm_title(s):
    if not s:
        return ""
    s = s.lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("đ", "d").replace("Đ", "d")
    out = []
    prev_space = False
    for ch in s:
        if ch.isalnum():
            out.append(ch)
            prev_space = False
        else:
            if not prev_space:
                out.append(" ")
                prev_space = True
    return "".join(out).strip()


def iter_rows(rec):
    for sec in rec.get("sections") or []:
        for row in sec.get("rows") or []:
            yield row


def doc_key(rec):
    src = rec.get("source") or {}
    return src.get("sha256") or src.get("filename") or ""


def partition():
    records = json.loads(DATA.read_text(encoding="utf-8"))

    with_url = []
    without_url = []
    for idx, rec in enumerate(records):
        if rec.get("doc_type") != "results_table":
            continue
        if (rec.get("source") or {}).get("source_url"):
            with_url.append((idx, rec))
        else:
            without_url.append((idx, rec))

    # Index urlful rows by (normTitle, amount, program)
    twin_index = defaultdict(list)  # key -> [(doc_sha, filename, row)]
    for idx, rec in with_url:
        prog = (rec.get("document") or {}).get("program_type")
        sha = (rec.get("source") or {}).get("sha256")
        fn = (rec.get("source") or {}).get("filename")
        for row in iter_rows(rec):
            title = row.get("project_title")
            amt = row.get("approved_amount")
            if not title:
                continue
            key = (norm_title(title), amt, prog)
            twin_index[key].append({"doc_sha": sha, "filename": fn, "project_title": title})

    plan = []
    for idx, rec in without_url:
        src = rec.get("source") or {}
        doc = rec.get("document") or {}
        sha = src.get("sha256")
        fn = src.get("filename")
        prog = doc.get("program_type")

        rows = list(iter_rows(rec))
        row_outcomes = []
        matched = 0
        for ri, row in enumerate(rows):
            title = row.get("project_title")
            amt = row.get("approved_amount")
            key = (norm_title(title or ""), amt, prog)
            twins = twin_index.get(key, [])
            if twins:
                matched += 1
            row_outcomes.append({
                "row_index": ri,
                "project_title": title,
                "approved_amount": amt,
                "row_decision": "drop_row" if twins else "flag_row",
                "matched_twins": [{"doc_sha": t["doc_sha"], "filename": t["filename"]} for t in twins],
            })

        total = len(rows) or 1
        ratio = matched / total
        if matched == total:
            classification = "drop_doc"
        elif matched == 0:
            classification = "flag_doc"
        else:
            classification = "partial"

        plan.append({
            "record_index": idx,
            "doc_sha": sha,
            "filename": fn,
            "extractor": src.get("extractor"),
            "extractor_version": src.get("extractor_version"),
            "program_type": prog,
            "year": doc.get("year"),
            "rok": doc.get("rok"),
            "row_count": len(rows),
            "matched_count": matched,
            "match_ratio": round(ratio, 3),
            "classification": classification,
            "rows": row_outcomes,
        })

    PLAN_JSON.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    # Markdown summary
    lines = [
        "# Normalize pass plan",
        "",
        f"- Total results_table records: {len(with_url) + len(without_url)}",
        f"- With source_url: {len(with_url)}",
        f"- Without source_url: {len(without_url)}",
        f"  - drop_doc (all rows duplicate): {sum(1 for p in plan if p['classification'] == 'drop_doc')}",
        f"  - partial (some rows duplicate): {sum(1 for p in plan if p['classification'] == 'partial')}",
        f"  - flag_doc (no rows duplicate): {sum(1 for p in plan if p['classification'] == 'flag_doc')}",
        f"  - total duplicate rows to drop: {sum(p['matched_count'] for p in plan)}",
        f"  - total orphan rows to flag: {sum(p['row_count'] - p['matched_count'] for p in plan)}",
        "",
        "## Per-doc breakdown",
        "",
        "| classification | matched/rows | extractor | filename |",
        "|---|---|---|---|",
    ]
    for p in plan:
        lines.append(
            f"| **{p['classification']}** | {p['matched_count']}/{p['row_count']} ({p['match_ratio']}) | "
            f"{p['extractor']} | `{p['filename']}` |"
        )
    PLAN_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"wrote {PLAN_JSON.name} and {PLAN_MD.name}")
    for c in ("drop_doc", "partial", "flag_doc"):
        print(f"  {c}: {sum(1 for p in plan if p['classification'] == c)}")
    print(f"  rows to drop: {sum(p['matched_count'] for p in plan)}")
    print(f"  rows to flag: {sum(p['row_count'] - p['matched_count'] for p in plan)}")


def apply():
    """Apply decisions. normalize-decision.json may be either:
      (a) a plan-shaped array (same structure as normalize-plan.json, with optional
          per-row 'row_decision' override and per-doc 'classification'), or
      (b) a dict { doc_sha: "drop_doc"|"flag_doc"|"partial" } -- in which case the
          per-row decisions from normalize-plan.json are used as-is.
    """
    decision = json.loads(DECISION_JSON.read_text(encoding="utf-8"))
    plan = json.loads(PLAN_JSON.read_text(encoding="utf-8"))

    # Build per-doc + per-row map.
    if isinstance(decision, list):
        decision_by_sha = {d["doc_sha"]: d for d in decision}
    else:
        decision_by_sha = {sha: {"classification": cls} for sha, cls in decision.items()}

    # Fold plan's row decisions into the map when decision doesn't override.
    for p in plan:
        sha = p["doc_sha"]
        d = decision_by_sha.setdefault(sha, {"classification": p["classification"]})
        d.setdefault("classification", p["classification"])
        d.setdefault("rows", p["rows"])

    records = json.loads(DATA.read_text(encoding="utf-8"))

    kept = []
    dropped_docs = 0
    flagged_docs = 0
    partial_docs = 0
    dropped_rows = 0
    flagged_rows = 0

    for rec in records:
        sha = (rec.get("source") or {}).get("sha256")
        d = decision_by_sha.get(sha)
        if not d:
            kept.append(rec)
            continue

        cls = d["classification"]
        if cls == "drop_doc":
            dropped_docs += 1
            dropped_rows += sum(len(s.get("rows") or []) for s in rec.get("sections") or [])
            continue

        # flag_doc or partial: walk rows, drop the matched ones, flag survivors.
        row_decisions_by_idx = {r["row_index"]: r["row_decision"] for r in d.get("rows") or []}
        ri = 0
        any_dropped = False
        any_kept = False
        for sec in rec.get("sections") or []:
            new_rows = []
            for row in sec.get("rows") or []:
                rd = row_decisions_by_idx.get(ri, "flag_row")
                ri += 1
                if rd == "drop_row":
                    dropped_rows += 1
                    any_dropped = True
                    continue
                row["source_url_missing"] = True
                flagged_rows += 1
                any_kept = True
                new_rows.append(row)
            sec["rows"] = new_rows

        if not any_kept:
            # All rows dropped -> drop whole doc.
            dropped_docs += 1
            continue

        rec.setdefault("source", {})["source_url_missing"] = True
        if any_dropped:
            partial_docs += 1
        else:
            flagged_docs += 1
        kept.append(rec)

    DATA.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"dropped_docs={dropped_docs}  partial_docs={partial_docs}  flagged_docs={flagged_docs}")
    print(f"dropped_rows={dropped_rows}  flagged_rows={flagged_rows}")
    print(f"records kept: {len(kept)}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "partition"
    if cmd == "partition":
        partition()
    elif cmd == "apply":
        apply()
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
