from __future__ import annotations

import json
from pathlib import Path


HAVC_DIR = Path(__file__).resolve().parents[1] / "havc"
DATA_PATH = HAVC_DIR / "data.json"
APP_PATH = HAVC_DIR / "data.app.json"

EXPECTED = {
    "https://havc.hr/img/newsletter/files/rezultati%20manjinske%20u%202026.%20-%203.%20rok.pdf": {
        "doc_type": "results_table",
        "program": "manjinske_koprodukcije",
        "rows": 10,
        "total": 344000,
        "sha256": "736656ae005df8d59ee1848e3528d28fc943faa6bbb23ab3d939f9f83b42a942",
    },
    "https://havc.hr/img/newsletter/files/JP_distribucija_2026_3%20ROK_web.pdf": {
        "doc_type": "results_table",
        "program": "distribucija",
        "rows": 8,
        "total": 50500,
        "sha256": "8c69e98c933516e34a76466088260ca8ac0378155e736356feaf8b01f9ddfd95",
    },
    "https://havc.hr/img/newsletter/files/web%20Obrazlozenje%20za%20manjinske%20koprodukcije%203.%20rok%202026..pdf": {
        "doc_type": "narrative",
        "program": "manjinske_koprodukcije",
        "links": 10,
        "sha256": "7359644aba7d228715d7be98a42193ec81cd7d14e8fcc8515a9e4646ee207473",
    },
    "https://havc.hr/img/newsletter/files/JP_distribucija_2026_3%20ROK_24_07_web%20recenzija.pdf": {
        "doc_type": "narrative",
        "program": "distribucija",
        "links": 8,
        "sha256": "4ea2147e253679e7553e102449964a9c25c491e66e4f42ad98ae4b9b281709e6",
    },
}


def rows(record: dict) -> list[dict]:
    return [
        row
        for section in record.get("sections") or []
        for row in section.get("rows") or []
    ]


def by_url(records: list[dict]) -> dict[str, dict]:
    return {
        record.get("source", {}).get("source_url"): record
        for record in records
        if record.get("source", {}).get("source_url")
    }


def test_third_round_2026_official_documents_are_complete_and_curated():
    records = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    found = by_url(records)

    assert EXPECTED.keys() <= found.keys()
    for url, expected in EXPECTED.items():
        record = found[url]
        document = record["document"]
        assert record["doc_type"] == expected["doc_type"]
        assert record["source"]["sha256"] == expected["sha256"]
        assert document["year"] == 2026
        assert document["rok"] == "3. rok"
        assert document["program_type"] == expected["program"]

        if expected["doc_type"] == "results_table":
            result_rows = rows(record)
            assert len(result_rows) == expected["rows"]
            assert record["totals"]["ukupno"] == expected["total"]
            assert sum(item["approved_amount"] for item in result_rows) == expected["total"]
            assert all(item["funding_status"] == "awarded" for item in result_rows)
            assert all(item["row_id"] and item["project_family_id"] for item in result_rows)
        else:
            links = document["project_links"]
            assert len(links) == expected["links"]
            assert all(item["match_status"] == "awarded" for item in links)


def test_third_round_2026_records_are_present_in_browser_payload():
    full = by_url(json.loads(DATA_PATH.read_text(encoding="utf-8")))
    app = by_url(json.loads(APP_PATH.read_text(encoding="utf-8")))

    assert EXPECTED.keys() <= app.keys()
    for url in EXPECTED:
        assert app[url]["doc_type"] == full[url]["doc_type"]
        if full[url]["doc_type"] == "results_table":
            assert len(rows(app[url])) == len(rows(full[url]))
            assert app[url]["totals"]["ukupno"] == full[url]["totals"]["ukupno"]
