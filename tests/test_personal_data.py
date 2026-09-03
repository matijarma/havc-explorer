"""The published registry must never carry third parties' personal data.

The registry is built from the Croatian Audiovisual Centre's own published
documents, and most of them contain no personal contact details beyond the
Centre's letterhead footer. A minority - supplier-payment reports, financial
statements, regulations, public-consultation submissions and press kits - do,
and they carry no funding rows at all. ``havc/redact_personal_data.py`` withholds
their extracted text and masks personal identifiers in the text that is kept.

These tests assert that the shipped dataset obeys those rules, so a future
ingest or a hand edit cannot quietly put an OIB, a private e-mail address or a
mobile number back into a file that is served publicly and in bulk.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HAVC_DIR = Path(__file__).resolve().parents[1] / "havc"
DATA_PATH = HAVC_DIR / "data.json"
APP_PATH = HAVC_DIR / "data.app.json"

sys.path.insert(0, str(HAVC_DIR))

from redact_personal_data import (  # noqa: E402
    AUXILIARY_DOC_TYPES,
    WITHHELD_TEXT,
    find_personal_data,
    redact_text,
    sanitize_documents,
    scan_documents,
)


def load_documents() -> list[dict]:
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def test_shipped_dataset_carries_no_personal_data() -> None:
    problems = scan_documents(load_documents())
    assert problems == [], (
        f"{len(problems)} personal-data problem(s) in havc/data.json; "
        f"first: {problems[:3]}"
    )


def test_auxiliary_documents_ship_without_extracted_text() -> None:
    documents = load_documents()
    auxiliary = [d for d in documents if (d.get("doc_type") or "") in AUXILIARY_DOC_TYPES]
    assert auxiliary, "expected auxiliary documents in the corpus"
    for document in auxiliary:
        assert document.get("raw_text") == WITHHELD_TEXT, (
            (document.get("source") or {}).get("filename")
        )


def test_auxiliary_documents_contribute_no_funding_rows() -> None:
    """The reason withholding their text costs the registry nothing."""
    rows = 0
    for document in load_documents():
        if (document.get("doc_type") or "") not in AUXILIARY_DOC_TYPES:
            continue
        for section in document.get("sections") or []:
            rows += len(section.get("rows") or [])
    assert rows == 0


def test_browser_payload_carries_no_extracted_text() -> None:
    for document in json.loads(APP_PATH.read_text(encoding="utf-8")):
        assert "raw_text" not in document


def test_the_centres_own_contact_details_are_kept() -> None:
    """Masking must not damage the letterhead that proves provenance."""
    footer = (
        "Nova ves 18 | 10000 Zagreb | Croatia | Tel: +385 1 6041 080 | "
        "Fax: +385 1 4667 819 | OIB: 27103918402 | havc@havc.hr"
    )
    cleaned, counts = redact_text(footer)
    assert counts == {}
    assert cleaned == footer


def test_personal_identifiers_are_masked() -> None:
    # Synthetic values only: this file must never carry a real person's data.
    sample = (
        "PRIMJER OSOBA\nZagreb\n12345678901\n 2.020,62\n"
        "Kontakt: ime.prezime@example.com\nTelefon: 091 000 0000\n"
        "druga.osoba@example.org 098.000.0000\n+ 39 000 000 0000"
    )
    cleaned, counts = redact_text(sample)
    assert counts.get("oib") == 1
    assert counts.get("email") == 2
    assert counts.get("phone") >= 3
    assert find_personal_data(cleaned) == []
    for leaked in ("12345678901", "ime.prezime@example.com", "druga.osoba@example.org",
                   "098.000.0000", "000 000 0000"):
        assert leaked not in cleaned
    # The name and the town are not identifiers we can detect, which is exactly
    # why auxiliary documents ship without their text at all.
    assert "PRIMJER OSOBA" in cleaned


def test_sanitize_is_idempotent() -> None:
    documents = [
        {"doc_type": "admin", "raw_text": "PRIMJER OSOBA\nZagreb\n12345678901"},
        {"doc_type": "results_table", "raw_text": "Kontakt osoba@example.com"},
    ]
    first = sanitize_documents(documents)
    assert first["auxiliary_text_withheld"] == 1
    assert first["email"] == 1
    second = sanitize_documents(documents)
    assert second["auxiliary_text_withheld"] == 0
    assert second["email"] == 0
    assert scan_documents(documents) == []
