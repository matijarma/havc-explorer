"""Ingest HAVC's 31 August 2026 third-round results from official PDFs.

This is deliberately a one-purpose, integrity-checked ingestion recipe. It
downloads the four official PDFs, verifies their bytes, extracts their text,
and upserts the raw source records into data.json. Run clean_data.py afterwards
to assign stable row and family identifiers and build the browser payload.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen

from pypdf import PdfReader


HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "data.json"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def row(
    number: int,
    title: str,
    applicant: str,
    producer: str,
    director: str,
    category: str,
    amount: float,
    *,
    distributor: str | None = None,
) -> dict:
    extras = {"distributer": distributor} if distributor else {}
    return {
        "row_number": number,
        "project_title": title,
        "applicant": applicant,
        "production_company": producer,
        "director": director,
        "writer": None,
        "original_author": None,
        "category": category,
        "approved_amount_text": f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + " €",
        "approved_amount": amount,
        "currency": "EUR",
        "extras": extras,
    }


MINORITY_ROWS = [
    row(1, "Izgubljeno / nađeno", "Bonobostudio d.o.o.", "Bonobostudio d.o.o.", "Cheng-Hsu Chung", "animirani filmovi", 21000),
    row(2, "Balcanica", "Antitalent d.o.o.", "Antitalent d.o.o.", "Nicola Sorcinelli", "debitantski dugometražni igrani filmovi u postprodukcijskoj fazi", 62000),
    row(3, "Do kraja dana", "Dinaridi film d.o.o.", "Dinaridi film d.o.o.", "Jelena Maksimović", "debitantski dugometražni igrani filmovi u postprodukcijskoj fazi", 27000),
    row(4, "Grad", "Nukleus Film d.o.o.", "Nukleus Film d.o.o.", "Stanislav Bytiutskyi", "debitantski dugometražni igrani filmovi u postprodukcijskoj fazi", 42000),
    row(5, "Azra", "Pipser d.o.o.", "Pipser d.o.o.", "Tijana Zinajić", "dugometražni igrani filmovi", 50000),
    row(6, "Sama s Marom", "Terminal 3 Film d.o.o.", "Terminal 3 Film d.o.o.", "Sara Kern", "dugometražni igrani filmovi", 64000),
    row(7, "Bez filtera", "365 films d.o.o.", "365 films d.o.o.", "Roman Pivovarník", "kratkometražni igrani filmovi", 12000),
    row(8, "Svjetlost sunca", "Umjetnička organizacija Mitropa", "Umjetnička organizacija Mitropa", "Visar Vishka", "kratkometražni igrani filmovi", 11000),
    row(9, "Big in Gazi Baba", "Restart", "Restart", "Pauline Blanchet", "dugometražni dokumentarni filmovi", 28000),
    row(10, "U sjeni Lazike", "Petnaesta umjetnost d.o.o.", "Petnaesta umjetnost d.o.o.", "Nikolaos Kostopoulos", "dugometražni dokumentarni filmovi", 27000),
]

DISTRIBUTION_ROWS = [
    row(1, "Među nama", "Udruga Blank", "Udruga Blank", "Laura Pascu", "dugometražni igrani film", 7500, distributor="Udruga Blank"),
    row(2, "Oče naš", "PomPom Film d.o.o.", "PomPom Film d.o.o.", "Goran Stanković", "dugometražni igrani film - manjinska koprodukcija", 4000, distributor="PomPom Film d.o.o."),
    row(3, "Virus patološke dobrote", "Terminal 3 Film d.o.o.", "Terminal 3 Film d.o.o.", "Predrag Ličina", "dugometražni igrani film - manjinska koprodukcija", 8000, distributor="Editus d.o.o."),
    row(4, "Elektroničke vještice", "Kreativni sindikat", "Kreativni sindikat", "Maja Čule", "dugometražni igrano-eksperimentalni film", 5000, distributor="Kreativni sindikat"),
    row(5, "Nije na prodaju", "Factum", "Factum", "Marina Aničić Spremo", "dugometražni dokumentarni film", 3000, distributor="Factum"),
    row(6, "Male stvari", "Kinorama d.o.o.", "Kinorama d.o.o.", "Zvonimir Jurić", "dugometražni igrani film", 10000, distributor="Duplicato Media d.o.o."),
    row(7, "Planina", "Restart", "Restart", "Biljana Tutorov, Petar Glomazić", "dugometražni dokumentarni film - manjinska koprodukcija", 4000, distributor="Restart"),
    row(8, "Danas je mama živa", "Hulahop d.o.o.", "Dinaridi Film d.o.o.", "Josip Lukić", "dugometražni igrani film", 9000, distributor="Hulahop d.o.o."),
]


SOURCES = {
    "minority_results": {
        "url": "https://havc.hr/img/newsletter/files/rezultati%20manjinske%20u%202026.%20-%203.%20rok.pdf",
        "sha256": "736656ae005df8d59ee1848e3528d28fc943faa6bbb23ab3d939f9f83b42a942",
        "bytes": 44534,
        "pages": 1,
    },
    "minority_rationale": {
        "url": "https://havc.hr/img/newsletter/files/web%20Obrazlozenje%20za%20manjinske%20koprodukcije%203.%20rok%202026..pdf",
        "sha256": "7359644aba7d228715d7be98a42193ec81cd7d14e8fcc8515a9e4646ee207473",
        "bytes": 175028,
        "pages": 8,
    },
    "distribution_results": {
        "url": "https://havc.hr/img/newsletter/files/JP_distribucija_2026_3%20ROK_web.pdf",
        "sha256": "8c69e98c933516e34a76466088260ca8ac0378155e736356feaf8b01f9ddfd95",
        "bytes": 200706,
        "pages": 1,
    },
    "distribution_rationale": {
        "url": "https://havc.hr/img/newsletter/files/JP_distribucija_2026_3%20ROK_24_07_web%20recenzija.pdf",
        "sha256": "4ea2147e253679e7553e102449964a9c25c491e66e4f42ad98ae4b9b281709e6",
        "bytes": 378235,
        "pages": 3,
    },
}


def fetch_source(spec: dict) -> tuple[dict, str]:
    with urlopen(spec["url"], timeout=30) as response:
        payload = response.read()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != spec["sha256"] or len(payload) != spec["bytes"]:
        raise RuntimeError(
            f"Official PDF changed for {spec['url']}: "
            f"expected {spec['bytes']} bytes / {spec['sha256']}, "
            f"got {len(payload)} bytes / {digest}"
        )
    reader = PdfReader(BytesIO(payload))
    if len(reader.pages) != spec["pages"]:
        raise RuntimeError(
            f"Unexpected page count for {spec['url']}: {len(reader.pages)}"
        )
    filename = unquote(urlsplit(spec["url"]).path.rsplit("/", 1)[-1])
    source = {
        "filename": filename,
        "filename_decoded": filename,
        "sha256": digest,
        "bytes": len(payload),
        "page_count": len(reader.pages),
        "extracted_at": now(),
        "extractor": "news-results-2026",
        "extractor_version": "1.0",
        "source_url": spec["url"],
    }
    return source, "\n".join(page.extract_text() or "" for page in reader.pages)


def result_record(source: dict, raw_text: str, *, program: str, title: str, rows: list[dict], sections: list[dict], total: float) -> dict:
    return {
        "schema_version": "1.0",
        "doc_type": "results_table",
        "source": source,
        "raw_text": raw_text,
        "warnings": [],
        "document": {
            "program_type": program,
            "year": 2026,
            "rok": "3. rok",
            "currency": "EUR",
            "natjecaj_title": title,
            "decision_date": "2026-08-31",
            "decision_body": "Hrvatsko audiovizualno vijeće",
            "summary": None,
        },
        "sections": sections,
        "totals": {
            "ukupno_text": f"{total:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + " €",
            "ukupno": total,
            "sveukupno_text": None,
            "sveukupno": None,
        },
    }


def narrative_record(source: dict, raw_text: str, *, program: str, titles: list[str]) -> dict:
    return {
        "schema_version": "1.1",
        "doc_type": "narrative",
        "source": source,
        "raw_text": raw_text,
        "warnings": [],
        "document": {
            "program_type": program,
            "year": 2026,
            "rok": "3. rok",
            "referenced_projects": titles,
            "summary": None,
            "project_links": [],
        },
    }


def main() -> int:
    loaded = {key: fetch_source(spec) for key, spec in SOURCES.items()}
    minority_sections = [
        {"section_label": "animirani filmovi", "rows": MINORITY_ROWS[:1]},
        {"section_label": "debitantski dugometražni igrani filmovi u postprodukcijskoj fazi", "rows": MINORITY_ROWS[1:4]},
        {"section_label": "dugometražni igrani filmovi", "rows": MINORITY_ROWS[4:6]},
        {"section_label": "kratkometražni igrani filmovi", "rows": MINORITY_ROWS[6:8]},
        {"section_label": "dugometražni dokumentarni filmovi", "rows": MINORITY_ROWS[8:]},
    ]
    new_records = [
        result_record(
            *loaded["minority_results"],
            program="manjinske_koprodukcije",
            title="Javni poziv za poticanje audiovizualnih djelatnosti i stvaralaštva - kategorija: POTICANJE FILMSKIH KOPRODUKCIJA S MANJINSKIM HRVATSKIM UDJELOM u 2026. - 3. ROK - 15.7.2026. - 37. sjednica Hrvatskog audiovizualnog vijeća, 31. kolovoza 2026.",
            rows=MINORITY_ROWS,
            sections=minority_sections,
            total=344000,
        ),
        narrative_record(
            *loaded["minority_rationale"],
            program="manjinske_koprodukcije",
            titles=[item["project_title"] for item in MINORITY_ROWS],
        ),
        result_record(
            *loaded["distribution_results"],
            program="distribucija",
            title="Javni poziv za poticanje audiovizualnih djelatnosti i stvaralaštva - kategorija: POTICANJE DISTRIBUCIJE FILMOVA u 2026. - 3. ROK - 24.7.2026. - 37. sjednica Hrvatskog audiovizualnog vijeća u 5. sazivu, 31. kolovoza 2026.",
            rows=DISTRIBUTION_ROWS,
            sections=[{"section_label": None, "rows": DISTRIBUTION_ROWS}],
            total=50500,
        ),
        narrative_record(
            *loaded["distribution_rationale"],
            program="distribucija",
            titles=[item["project_title"] for item in DISTRIBUTION_ROWS],
        ),
    ]

    records = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    new_urls = {record["source"]["source_url"] for record in new_records}
    records = [
        record
        for record in records
        if (record.get("source") or {}).get("source_url") not in new_urls
    ]
    records.extend(new_records)
    DATA_PATH.write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"upserted {len(new_records)} official records into {DATA_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
