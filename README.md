# HAVC — Strukturirani podatci / Structured Data

Otvoreni prikaz javnih poticaja Hrvatskog audiovizualnog centra (HAVC). •
An open, structured view of the Croatian Audiovisual Centre's (HAVC) public funding.

**Live:** https://havc.matijar.info

---

## Why

HAVC publishes every funding decision — who got money, for what, and how much — but only
as a long trail of PDF files scattered across a dated website (`havc.hr/o-nama/javni-pozivi`).
The information is *public* but not *usable*: you can't search it, filter it, total it, or
follow a project across years.

This project fixes that in two complementary ways:

1. **Extract and curate** the source PDFs into one clean, machine-readable dataset.
2. **Surface** it through two front-ends — a full standalone web app, and a browser extension
   that improves HAVC's own pages in place.

## The two front-ends

### 🎬 Sredstva — the web app  (this folder, `web/`)
A single-page dashboard over the whole funding registry. Vanilla JS, no framework, no build step.
- Browse, search and filter every funding decision by year, programme, category and round.
- Per-project profiles (funding timeline across rounds, people, jury narratives, source PDF).
- Registry-wide analytics — totals, medians, award-size distribution, producer concentration
  (Gini, top-N share), year-over-year trends.
- HRK→EUR normalization, share-links, light/dark themes, HR/EN.
- Every figure links back to the original HAVC source PDF.

Live at **https://havc.matijar.info**.

### 🧩 HAVC Companion — the browser extension  (sibling folder, `../chromeext/`)
A Chrome MV3 extension that enhances HAVC's *own* pages in place — a light-touch, native-feeling
upgrade rather than a replacement. On `havc.hr/o-nama/javni-pozivi` it adds document-type pills, a
legend, in-page search/filter, in-place PDF previews, per-category result minitables, and a full
archive browser — all reversible, bilingual (HR/EN) and with a dark mode for havc.hr. It reuses the
same dataset (a compact index built from `web/havc/data.json`).

- Source: `../chromeext/` — see its `README.md`.
- Store submission materials: `../store/`.
- **Chrome Web Store:** https://chromewebstore.google.com/detail/havc-companion-%E2%80%94-javni-po/jjfmjbmebnljefefcgfdjljenilgmfpg

## Data provenance ⚠️

Registry data is machine-extracted from funding results published on `havc.hr`, then passed through a
hybrid deterministic and LLM-assisted curation layer. Suspect rows are checked against source text and
table context; direct PDF corrections are recorded in a versioned ledger. Every result row has an
explicit `awarded` or `not_awarded` status, and only verified awards enter dashboard totals.

Each project, decision and amount remains traceable to its source HAVC PDF. The final curation audit is
stored in `havc/data-curation-audit.json`; the separate official-total cross-check remains available in
`havc/10_sanity_check_official.json`.

## Repo layout

```
web/                     the Sredstva web app
  index.html             single entry point
  main.js                app (i18n · data loader/indexers · filters · analytics · list · profiles)
  style.css              styles (warm paper-on-ink palette, Bricolage / Albert Sans / JetBrains Mono)
  content/               About & Process page content (*.en.json / *.hr.json)
  havc/
    data.json            curated funding registry; source of truth
    clean_data.py        deterministic cleanup, structured review and family assignment
    source-corrections.json
                         corrections verified directly against source PDFs
    data-curation-decisions.json
                         cached row and recurring-family decisions
    data-curation-audit.json
                         final validation and review-call receipts
    10_sanity_check_official.json
                         independent comparison with published HAVC totals
  tests/                 curation-pipeline tests
../chromeext/            the HAVC Companion browser extension (built from web/havc/data.json)
../store/                Chrome Web Store listing, permissions, promo images, screenshots
```

## Running

Pure static files — serve the `web/` folder with any static server and open `index.html`:

```powershell
# from web/
python -m http.server 8080   # then open http://localhost:8080
```

The curated dataset is regenerated with `python havc/clean_data.py --apply`. Run
`python -m pytest -q` before publishing. The extension's compact index is regenerated with
`node ../chromeext/scripts/build-index.mjs` (reads `web/havc/data.json`).

## Notes

- No build tooling: both the web app and the extension are plain HTML/CSS/JS.
- Not affiliated with or endorsed by HAVC. Built to make public data usable; if HAVC would rather
  publish this themselves, all the better.
