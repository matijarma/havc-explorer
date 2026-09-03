"""Keep third parties' personal data out of the published registry.

The registry is built from documents the Croatian Audiovisual Centre publishes
itself, and each record keeps the extracted text of its source PDF in
``raw_text`` so any figure can be checked against the document it came from.

Most of those documents are results tables, jury narratives and decisions: the
only contact details in them belong to the Centre itself, printed in the
letterhead footer. A minority of the corpus, however, are auxiliary documents
that carry no funding data at all - monthly supplier-payment reports, financial
statements, regulations, public-consultation submissions and press kits. Their
text pairs named natural persons with personal identifiers: OIB numbers, home
towns, private e-mail addresses and mobile numbers. Publishing a searchable,
machine-readable copy of that is a different act from the Centre publishing a
single PDF, it is not needed to verify a single funding figure, and it is not
something the registry should ever have carried.

Two rules follow, applied by :func:`sanitize_documents`:

1. Auxiliary documents keep their record - filename, checksum, source link and
   classification - but not the extracted text. They contribute no funding rows,
   so nothing verifiable is lost.
2. In the text that is kept, anything shaped like a personal identifier is
   masked unless it is the Centre's own published contact detail (an ``@havc.hr``
   address, its Zagreb landline or fax, or its company OIB).

:func:`scan_documents` applies the same rules as a check and is what the
regression test in ``tests/test_personal_data.py`` asserts against, so a future
ingest cannot quietly reintroduce what this module removes.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "data.json"

#: Document classes that carry no funding rows and whose text is not published.
AUXILIARY_DOC_TYPES = frozenset(
    {"admin", "regulation", "non_financing", "other", "image_only"}
)

#: Replaces the extracted text of an auxiliary document.
WITHHELD_TEXT = (
    "[tekst izvornog dokumenta nije objavljen: pomoćni dokument bez podataka o "
    "financiranju. Dokument je evidentiran nazivom datoteke, kontrolnim "
    "sažetkom i poveznicom na izvor.]"
)

MASK_EMAIL = "[e-adresa uklonjena]"
MASK_PHONE = "[telefon uklonjen]"
MASK_OIB = "[OIB uklonjen]"

#: The Centre's own company OIB, printed in the footer of its documents.
HAVC_OIB = "27103918402"
#: The Centre's own Zagreb landline and fax, printed in the same footer.
HAVC_PHONE_DIGITS = "3851"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
OIB_RE = re.compile(r"(?<![\d.,])\d{11}(?![\d.,])")
INTL_PHONE_RE = re.compile(r"\+\s?\d{1,3}[\s./-]?\d[\d\s./-]{6,}\d")
HR_MOBILE_RE = re.compile(r"(?<![\d.,])0(?:6\d|9\d)[\s./-]?\d{3}[\s./-]?\d{3,4}(?![\d.,])")
DOTTED_MOBILE_RE = re.compile(r"(?<![\d.,])0\d{2}\.\d{3}\.\d{4}(?![\d.,])")


def _is_institutional_email(value: str) -> bool:
    return value.lower().endswith("@havc.hr")


def _is_institutional_phone(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    return digits.startswith(HAVC_PHONE_DIGITS)


def redact_text(text: str) -> tuple[str, dict[str, int]]:
    """Mask personal identifiers in ``text``, keeping the Centre's own details."""
    counts: dict[str, int] = {}

    def bump(kind: str) -> None:
        counts[kind] = counts.get(kind, 0) + 1

    def email_sub(match: re.Match[str]) -> str:
        if _is_institutional_email(match.group(0)):
            return match.group(0)
        bump("email")
        return MASK_EMAIL

    def oib_sub(match: re.Match[str]) -> str:
        if match.group(0) == HAVC_OIB:
            return match.group(0)
        bump("oib")
        return MASK_OIB

    def phone_sub(match: re.Match[str]) -> str:
        if _is_institutional_phone(match.group(0)):
            return match.group(0)
        bump("phone")
        return MASK_PHONE

    text = EMAIL_RE.sub(email_sub, text)
    text = OIB_RE.sub(oib_sub, text)
    text = INTL_PHONE_RE.sub(phone_sub, text)
    text = HR_MOBILE_RE.sub(phone_sub, text)
    text = DOTTED_MOBILE_RE.sub(phone_sub, text)
    return text, counts


def find_personal_data(text: str) -> list[tuple[str, str]]:
    """Return the personal identifiers still present in ``text``."""
    found: list[tuple[str, str]] = []
    for match in EMAIL_RE.finditer(text):
        if not _is_institutional_email(match.group(0)):
            found.append(("email", match.group(0)))
    for match in OIB_RE.finditer(text):
        if match.group(0) != HAVC_OIB:
            found.append(("oib", match.group(0)))
    for regex in (INTL_PHONE_RE, HR_MOBILE_RE, DOTTED_MOBILE_RE):
        for match in regex.finditer(text):
            if not _is_institutional_phone(match.group(0)):
                found.append(("phone", match.group(0)))
    return found


def is_auxiliary(document: dict[str, Any]) -> bool:
    return str(document.get("doc_type") or "") in AUXILIARY_DOC_TYPES


def sanitize_documents(documents: Iterable[dict[str, Any]]) -> dict[str, int]:
    """Apply both rules in place and report what changed."""
    stats = {
        "documents": 0,
        "auxiliary_text_withheld": 0,
        "documents_redacted": 0,
        "email": 0,
        "oib": 0,
        "phone": 0,
    }
    for document in documents:
        stats["documents"] += 1
        raw_text = document.get("raw_text")
        if not isinstance(raw_text, str) or not raw_text:
            continue
        if is_auxiliary(document):
            if raw_text != WITHHELD_TEXT:
                document["raw_text"] = WITHHELD_TEXT
                stats["auxiliary_text_withheld"] += 1
            continue
        cleaned, counts = redact_text(raw_text)
        if counts:
            document["raw_text"] = cleaned
            stats["documents_redacted"] += 1
            for kind, number in counts.items():
                stats[kind] += number
    return stats


def scan_documents(documents: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return every rule violation, for use as an assertion in tests."""
    problems: list[dict[str, Any]] = []
    for index, document in enumerate(documents):
        raw_text = document.get("raw_text")
        if not isinstance(raw_text, str) or not raw_text:
            continue
        filename = (document.get("source") or {}).get("filename", "?")
        if is_auxiliary(document) and raw_text != WITHHELD_TEXT:
            problems.append(
                {
                    "index": index,
                    "filename": filename,
                    "doc_type": document.get("doc_type"),
                    "problem": "auxiliary document still carries extracted text",
                }
            )
            continue
        for kind, value in find_personal_data(raw_text):
            problems.append(
                {
                    "index": index,
                    "filename": filename,
                    "doc_type": document.get("doc_type"),
                    "problem": f"{kind} in raw_text",
                    "value": value,
                }
            )
    return problems


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    check_only = "--check" in argv
    argv = [item for item in argv if item != "--check"]
    path = Path(argv[0]) if argv else DATA_PATH

    documents = json.loads(path.read_text(encoding="utf-8"))

    if check_only:
        problems = scan_documents(documents)
        if problems:
            print(f"FAIL: {len(problems)} personal-data problem(s) in {path.name}")
            for problem in problems[:20]:
                print("  ", problem)
            return 1
        print(f"OK: no third-party personal data in {path.name}")
        return 0

    stats = sanitize_documents(documents)
    path.write_text(
        json.dumps(documents, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    remaining = scan_documents(documents)
    if remaining:
        print(f"WARNING: {len(remaining)} problem(s) remain")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
