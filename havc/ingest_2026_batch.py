# -*- coding: utf-8 -*-
"""Ingest the June 2026 HAVC funding results (34th & 35th AV Council sessions).

Source: two news posts on havc.hr announcing results for production / development
of feature, short, documentary, animated and experimental films, TV-series
development, round-2 distribution, round-2 international cooperation and round-2
minority co-productions. Per-project detail lives in result PDFs on the category
"rezultati" landing pages; jury explanations live in matching "obrazlozenje" PDFs.

This script downloads each PDF, extracts its table(s) with pdfplumber, builds
schema-correct `results_table` and `narrative` records, validates each results
table against the totals/counts announced in the news posts, backs up data.json,
appends the new records and writes data.json back.

Usage:
  python ingest_2026_batch.py            # dry run: parse + validate, no write
  python ingest_2026_batch.py --write    # parse + validate + back up + append
"""

import os
import re
import sys
import json
import time
import hashlib
import ssl
import urllib.request
import urllib.parse
from datetime import datetime, timezone

import pdfplumber

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data.json")
# PDFs are cached outside the repo (scratchpad); not committed.
PDFDIR = os.environ.get("HAVC_PDFDIR") or os.path.join(HERE, "_pdf_cache_2026")
os.makedirs(PDFDIR, exist_ok=True)

EXTRACTOR = "news-results-2026"
EXTRACTOR_VERSION = "1.0"
NOW_ISO = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
BASE = "https://havc.hr/img/newsletter/files/"
DECISION_BODY = "Hrvatsko audiovizualno vijeće"

# --- result PDFs: (program_type, rok, expected_total, expected_count, url) ---
RESULTS = [
 ("proizvodnja", "1. rok", 3720000.0, 5,  BASE + "REZULTATI%20WEB%20%20Proizvodnja%202026.%20-%201.%20rok_deb%20i%20dugi%20igrani.pdf"),
 ("proizvodnja", "1. rok", 345000.0,  4,  BASE + "rezultati%20Proizvodnja%202026.%20-%201.%20rok_kratki%20igrani.pdf"),
 ("proizvodnja", "1. rok", 549000.0,  10, BASE + "rezultati%20AV%20Proizvodnja%202026.%20-%201.%20rok_dokumentarni%20.pdf"),
 ("proizvodnja", "1. rok", 1153618.13, 4, BASE + "rezultati%20Proizvodnja%202026.%20-%201.%20rok_animirani%282%29.pdf"),
 ("proizvodnja", "1. rok", 195000.0,  6,  BASE + "rezultati%20%20Proizvodnja%202026.%20-%201.%20rok_eksperimentalni%20.pdf"),
 ("razvoj_scenarija", "1. rok", 102000.0, 17, BASE + "RSC_2026_1rok_11III2026_DUG_IGR_WEB.pdf"),
 ("razvoj_scenarija", "1. rok", 50000.0,  10, BASE + "RSC_2026_1rok_11III2026_DUG_DOK_WEB.pdf"),
 ("razvoj_scenarija", "1. rok", 10000.0,  2,  BASE + "RSC_2026_1rok_11III2026_ANIMIRANI_WEB.pdf"),
 ("razvoj_projekata", "1. rok", 120000.0, 5,  BASE + "RPR_2026_1rok_11III2026_DUG_IGR_WEB.pdf"),
 ("razvoj_projekata", "1. rok", 89000.0,  5,  BASE + "RPR_2026_1rok_11III2026_DUG_DOK_WEB.pdf"),
 ("razvoj_projekata", "1. rok", 25000.0,  5,  BASE + "RPR_2026_1rok_11III2026_ANIMIRANI_WEB.pdf"),
 ("tv_djela", "1. rok", 89000.0, 14, BASE + "RSCTV_2026_1rok_10III2026_WEB.pdf"),
 ("tv_djela", "1. rok", 91000.0,  9, BASE + "RPRTV_2026_1rok_10III2026_WEB.pdf"),
 ("distribucija", "2. rok", 43500.0, 4, BASE + "JP_distribucija_2026_2_rok_WEB.pdf"),
 ("medjunarodna_suradnja", "2. rok", 63261.61, 58, BASE + "rezultati%20%20AV%20JP%20ME%C4%90%202026.%20-%202.%20rok.pdf"),
 ("manjinske_koprodukcije", "2. rok", 399000.0, 11, BASE + "rezultati%20Manjinske%20u%202026.%20-%202.%20rok.pdf"),
]

# --- obrazlozenja (jury explanations): (program_type, rok, url) ---
NARRATIVES = [
 ("proizvodnja", "1. rok", BASE + "web%20obrazlozenje%20Animirani_Proizvodnja_01_Rok_2026%281%29.pdf"),
 ("proizvodnja", "1. rok", BASE + "web%20obrazlozenje%20eksperimentalni%20filmovi%201%20rok%202026.pdf"),
 ("proizvodnja", "1. rok", BASE + "web%20obrazlozenje%20PROD_KD_1_2026.pdf"),
 ("proizvodnja", "1. rok", BASE + "web%20obrazlozenje%20PROD_DD_1_2026.pdf"),
 ("proizvodnja", "1. rok", BASE + "WEB%20Obrazlozenje%20-%20kratkometrazni%20igrani%201.%20rok%202026.pdf"),
 ("proizvodnja", "1. rok", BASE + "WEB%20DEB%20I%20DUGI%20IGRANI%20-%20PROD_obrazloz%CC%8Cenje_1.%20rok%202026.%20.pdf"),
 ("razvoj_scenarija", "1. rok", BASE + "Obrazlozenje_RSC_ANIMIRANI_1rok_2026_11III2026.pdf"),
 ("razvoj_projekata", "1. rok", BASE + "Obrazlozenje_RPR_ANIMIRANI_1rok_2026_11III2026.pdf"),
 ("razvoj_scenarija", "1. rok", BASE + "Obrazlozenje_RSC_DOK_1rok_11III2026_WEB.pdf"),
 ("razvoj_projekata", "1. rok", BASE + "Obrazlozenje_RPR_DOK_1rok_11III2026_WEB.pdf"),
 ("razvoj_scenarija", "1. rok", BASE + "Obrazlozenje_RSC_IGR_1rok_2026_11III2026._WEB.pdf"),
 ("razvoj_projekata", "1. rok", BASE + "Obrazlozenje_RPR_IGR_1rok_2026_11III2026_WEB.pdf"),
 ("tv_djela", "1. rok", BASE + "Obrazlozenje_RPRTV_RSCTV_1rok_10III2026_WEB.pdf"),
 ("distribucija", "2. rok", BASE + "JP%202026_2%20ROK_24_04_web%20recenzija.pdf"),
 ("manjinske_koprodukcije", "2. rok", BASE + "web%20Obrazlozenje%20za%20manjinske%20koprodukcije%20Drugi%20rok%202026.%20.pdf"),
]

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def fetch(url):
    """Download `url` to PDFDIR (cached by sha1 of url) and return (path, bytes)."""
    key = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    path = os.path.join(PDFDIR, key + ".pdf")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path, open(path, "rb").read()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, context=_CTX, timeout=90) as r:
                data = r.read()
            open(path, "wb").write(data)
            return path, data
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2)


def parse_amount(text):
    """'1.153.618,13 €' -> 1153618.13 ; '875,34' -> 875.34"""
    if text is None:
        return None
    s = text
    for junk in ("€", "EUR", "eura", "kn", "\xa0", " "):
        s = s.replace(junk, "")
    s = s.strip()
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def clean(cell):
    if cell is None:
        return None
    v = " ".join(str(cell).split())
    return v or None


def map_header(cells):
    """Map column index -> logical field by header keyword (order-independent)."""
    cm = {}
    for i, c in enumerate(cells):
        t = (c or "").upper()
        if not t.strip():
            continue
        if "NOSITELJ" in t or "PODNOSITELJ" in t:
            cm.setdefault("applicant", i)
        elif "NASLOV" in t or "NAZIV" in t:
            cm.setdefault("title", i)
        elif "PROGRAM" in t:
            cm.setdefault("title", i)
        elif "AUTOR IZVORNOG" in t:
            cm.setdefault("original_author", i)
        elif "SCENARIST" in t:
            cm.setdefault("writer", i)
        elif "REDATELJ" in t:
            cm.setdefault("director", i)
        elif "PRODUCENT" in t:
            cm.setdefault("production_company", i)
        elif "KATEGORIJA" in t:
            cm.setdefault("category", i)
        elif "DISTRIBUTER" in t:
            cm.setdefault("distributer", i)
        elif "ODOBREN" in t or "SREDSTVA" in t or "POTPORA" in t:
            cm.setdefault("amount", i)
    return cm


SKIP_LABEL_RE = re.compile(r"JAVNI POZIV|SJEDNICA|HRVATSKOG AUDIOVIZUALNOG", re.I)


def parse_results_pdf(path):
    """Return dict with natjecaj_title, natjecaj_date, decision_date, sections,
    columns, totals, all_rows."""
    natjecaj_title = None
    decision_date = None
    columns = None
    colmap = None
    current_label = None
    sections = []           # list of {label, rows}
    section_by_label = {}
    sveukupno_text = None
    section_total_texts = []
    page_count = 0

    def get_section(label):
        if label not in section_by_label:
            sec = {"label": label, "rows": []}
            section_by_label[label] = sec
            sections.append(sec)
        return section_by_label[label]

    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        all_cells_rows = []
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    all_cells_rows.append(row)

    for cells in all_cells_rows:
        joined_upper = " ".join((c or "").upper() for c in cells)
        c0 = (cells[0] or "").strip() if cells else ""

        # header row
        if "ODOBREN" in joined_upper and not c0.isdigit():
            colmap = map_header(cells)
            if columns is None:
                columns = [clean(c) for c in cells if clean(c)]
            continue

        # data row (starts with an integer row-number)
        if c0.isdigit() and colmap:
            def gf(field):
                i = colmap.get(field)
                if i is None or i >= len(cells):
                    return None
                return clean(cells[i])
            prod = gf("production_company")
            applicant = gf("applicant") or prod
            amt_text = gf("amount")
            cat = gf("category") or current_label
            extras = {}
            dist = gf("distributer")
            if dist:
                extras["distributer"] = dist
            row = {
                "row_number": int(c0),
                "project_title": gf("title"),
                "applicant": applicant,
                "production_company": prod,
                "director": gf("director"),
                "writer": gf("writer"),
                "original_author": gf("original_author"),
                "category": cat,
                "approved_amount_text": amt_text,
                "approved_amount": parse_amount(amt_text),
                "currency": "EUR",
                "extras": extras,
            }
            get_section(current_label)["rows"].append(row)
            continue

        # total row
        if "UKUPNO" in joined_upper:
            amt_text = None
            for c in reversed(cells):
                cc = clean(c)
                if cc and parse_amount(cc) is not None:
                    amt_text = cc
                    break
            if "SVEUKUPNO" in joined_upper:
                sveukupno_text = amt_text
            else:
                section_total_texts.append(amt_text)
            continue

        # otherwise: title / sjednica / section-label line
        text = " ".join(clean(c) for c in cells if clean(c))
        if not text:
            continue
        if SKIP_LABEL_RE.search(text):
            if natjecaj_title is None and re.search(r"JAVNI POZIV", text, re.I):
                natjecaj_title = text
            m = re.search(r"(\d{1,2})\.\s*lipnja\s*2026", text, re.I)
            if m:
                decision_date = "2026-06-%02d" % int(m.group(1))
            continue
        # section label
        current_label = text
        get_section(current_label)

    # natjecaj deadline date from title (first d.m.2026)
    natjecaj_date = None
    if natjecaj_title:
        m = re.search(r"(\d{1,2})\.(\d{1,2})\.2026", natjecaj_title)
        if m:
            natjecaj_date = "2026-%02d-%02d" % (int(m.group(2)), int(m.group(1)))

    # grand total
    grand_text = sveukupno_text
    if grand_text is None:
        if len(section_total_texts) == 1:
            grand_text = section_total_texts[0]

    return {
        "natjecaj_title": natjecaj_title,
        "natjecaj_date": natjecaj_date,
        "decision_date": decision_date,
        "columns": columns or [],
        "sections": sections,
        "grand_text": grand_text,
        "page_count": page_count,
    }


def raw_text_of(path):
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts).strip()


def build_results_record(program, rok, exp_total, exp_count, url):
    path, data = fetch(url)
    sha = hashlib.sha256(data).hexdigest()
    decoded = urllib.parse.unquote(url[len(BASE):])
    parsed = parse_results_pdf(path)

    sections_out = []
    all_rows = []
    for sec in parsed["sections"]:
        if not sec["rows"]:
            continue
        for r in sec["rows"]:
            all_rows.append(r)
        sections_out.append({
            "section_label": sec["label"],
            "section_key": None,
            "columns": parsed["columns"],
            "rows": sec["rows"],
            "section_total_text": None,
            "section_total": None,
        })

    rows_sum = round(sum((r["approved_amount"] or 0) for r in all_rows), 2)
    grand = parse_amount(parsed["grand_text"]) if parsed["grand_text"] else rows_sum
    ukupno_text = parsed["grand_text"] or ("%.2f" % rows_sum)
    rec = {
        "schema_version": "1.0",
        "doc_type": "results_table",
        "source": {
            "filename": decoded,
            "filename_decoded": decoded,
            "sha256": sha,
            "bytes": len(data),
            "page_count": parsed["page_count"],
            "extracted_at": NOW_ISO,
            "extractor": EXTRACTOR,
            "extractor_version": EXTRACTOR_VERSION,
            "source_url": url,
        },
        "raw_text": raw_text_of(path),
        "warnings": [],
        "document": {
            "program_type": program,
            "natjecaj_title": parsed["natjecaj_title"],
            "year": 2026,
            "rok": rok,
            "natjecaj_date": parsed["natjecaj_date"],
            "decision_date": parsed["decision_date"],
            "decision_body": DECISION_BODY,
            "currency": "EUR",
            "currency_inferred": False,
        },
        "sections": sections_out,
        "totals": {
            "ukupno_text": ukupno_text,
            "ukupno": grand,
            "sveukupno_text": None,
            "sveukupno": None,
        },
        "validation": {
            "rows_sum": rows_sum,
            "ukupno_match": abs(rows_sum - (grand or 0)) < 0.01,
            "row_count": len(all_rows),
        },
    }
    ok_total = abs(rows_sum - exp_total) < 0.01
    ok_count = len(all_rows) == exp_count
    return rec, ok_total, ok_count, rows_sum, len(all_rows)


def build_narrative_record(program, rok, url):
    path, data = fetch(url)
    sha = hashlib.sha256(data).hexdigest()
    decoded = urllib.parse.unquote(url[len(BASE):])
    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
    rec = {
        "schema_version": "1.0",
        "doc_type": "narrative",
        "source": {
            "filename": decoded,
            "filename_decoded": decoded,
            "sha256": sha,
            "bytes": len(data),
            "page_count": page_count,
            "extracted_at": NOW_ISO,
            "extractor": EXTRACTOR,
            "extractor_version": EXTRACTOR_VERSION,
            "source_url": url,
        },
        "raw_text": raw_text_of(path),
        "warnings": [],
        "document": {
            "program_type": program,
            "year": 2026,
            "rok": rok,
            "referenced_projects": [],
            "summary": None,
        },
    }
    return rec


def main():
    write = "--write" in sys.argv
    new_records = []
    print("=== results_table ===")
    all_ok = True
    for (program, rok, exp_total, exp_count, url) in RESULTS:
        rec, ok_total, ok_count, rows_sum, n = build_results_record(
            program, rok, exp_total, exp_count, url)
        new_records.append(rec)
        status = "PASS" if (ok_total and ok_count) else "FAIL"
        if status == "FAIL":
            all_ok = False
        print("  [%s] %-22s %-7s rows=%d/%d  sum=%.2f / exp %.2f  %s"
              % (status, program, rok, n, exp_count, rows_sum, exp_total,
                 rec["source"]["filename"][:42]))

    print("=== narrative (obrazlozenja) ===")
    missing = []
    for (program, rok, url) in NARRATIVES:
        try:
            rec = build_narrative_record(program, rok, url)
        except Exception as e:
            missing.append((program, rok, url, str(e)))
            print("  [SKIP] %-22s %-7s %s -- %s"
                  % (program, rok, urllib.parse.unquote(url[len(BASE):])[:42], e))
            continue
        new_records.append(rec)
        print("  [OK]   %-22s %-7s text=%d chars  %s"
              % (program, rok, len(rec["raw_text"]), rec["source"]["filename"][:42]))
    if missing:
        print("  !! %d obrazlozenje PDF(s) could not be fetched (see above)." % len(missing))

    print("\nnew records: %d (%d results_table, %d narrative)"
          % (len(new_records), len(RESULTS), len(NARRATIVES)))

    if not all_ok:
        print("\n!! Some results tables FAILED validation -- not writing.")
        sys.exit(1)

    if not write:
        print("\n(dry run -- pass --write to back up and append)")
        return

    existing = json.load(open(DATA, encoding="utf-8"))
    existing_shas = {(d.get("source") or {}).get("sha256") for d in existing}
    to_add = [r for r in new_records if r["source"]["sha256"] not in existing_shas]
    skipped = len(new_records) - len(to_add)

    backup = os.path.join(HERE, "data.backup.%s.json"
                          % datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    with open(backup, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
    print("backed up -> %s" % os.path.basename(backup))

    merged = existing + to_add
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    print("appended %d records (%d skipped as duplicates). data.json now %d records."
          % (len(to_add), skipped, len(merged)))


if __name__ == "__main__":
    main()
