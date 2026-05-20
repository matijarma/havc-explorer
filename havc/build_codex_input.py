"""Build a compact JSON input file for Codex CLI verification of normalize-plan.json.

Reads:
  data.json (urlless results_table docs + their canonical twin docs)
  normalize-plan.json

Writes:
  codex-audit-input.json -- everything Codex needs to verify the partition

Output layout:
  {
    "plan": <normalize-plan.json>,
    "urlless_docs": { sha: { source, document, sections } },
    "twin_docs":    { sha: { source: {filename, source_url}, document, rows: [{title,amount}] } }
  }
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
plan = json.loads((HERE / "normalize-plan.json").read_text(encoding="utf-8"))
records = json.loads((HERE / "data.json").read_text(encoding="utf-8"))

urlless_shas = {p["doc_sha"] for p in plan}
twin_shas = set()
for p in plan:
    for r in p["rows"]:
        for t in r["matched_twins"]:
            twin_shas.add(t["doc_sha"])

urlless_docs = {}
twin_docs = {}

for rec in records:
    if rec.get("doc_type") != "results_table":
        continue
    sha = (rec.get("source") or {}).get("sha256")
    if sha in urlless_shas:
        urlless_docs[sha] = {
            "source": rec.get("source"),
            "document": rec.get("document"),
            "sections": rec.get("sections"),
        }
    if sha in twin_shas:
        # Compact twin: filename, url, rows of (title, amount)
        rows = []
        for sec in rec.get("sections") or []:
            for row in sec.get("rows") or []:
                rows.append({
                    "project_title": row.get("project_title"),
                    "approved_amount": row.get("approved_amount"),
                })
        twin_docs[sha] = {
            "source": {
                "filename": (rec.get("source") or {}).get("filename"),
                "source_url": (rec.get("source") or {}).get("source_url"),
            },
            "document": rec.get("document"),
            "rows": rows,
        }

out = {"plan": plan, "urlless_docs": urlless_docs, "twin_docs": twin_docs}
out_path = HERE / "codex-audit-input.json"
out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {out_path.name} ({out_path.stat().st_size // 1024} KB)")
print(f"  urlless_docs: {len(urlless_docs)}")
print(f"  twin_docs:    {len(twin_docs)}")
