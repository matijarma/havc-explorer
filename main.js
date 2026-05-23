/* Sredstva v3 - vanilla JS app
 *
 * Single-file dashboard for the Croatian audiovisual funding registry.
 * No React, no Babel, no build. Pure DOM + CSS classes from style.css.
 *
 * Sections:
 *   1. i18n table + t()
 *   2. data loader + indexers (search index, doc index, events join, project index)
 *   3. state container + observer pattern
 *   4. URL <-> filter+scope state (hash, debounced)
 *   5. atoms: el(), formatAmount(), formatCompact(), bars chart with tooltip
 *   6. topbar
 *   7. filter rail (chips + smooth year slider)
 *   8. orientation headline
 *   9. insights strip (clickable lenses: year-trend & size-distribution)
 *  10. scope-chip row
 *  11. pivot chips (group-by + unattributed toggle)
 *  12. virtualized list (Projects aggregated · Decisions per-row · Groups clickable · Project profile)
 *  13. unfunded-mentions modal (clickable rows)
 *  14. keyboard shortcuts
 *  15. boot
 */
(function () {
  'use strict';

  // ═══ 1. i18n ════════════════════════════════════════════════════════
  const T = {
    'app.subtitle': { en: 'Croatian audiovisual public funding — open registry',
                      hr: 'Hrvatski audiovizualni javni poticaji — otvoreni registar' },

    // View tabs
    'nav.dashboard': { en: 'Registry', hr: 'Registar' },
    'nav.about':     { en: 'About',    hr: 'O autoru' },
    'nav.process':   { en: 'Process',  hr: 'Proces' },

    'about.links_title': { en: 'Elsewhere', hr: 'Drugdje' },

    'years.all':   { en: 'All years', hr: 'Sve godine' },
    'years.label': { en: 'Year',      hr: 'Godina' },

    'process.input':     { en: 'Input',   hr: 'Ulaz' },
    'process.process':   { en: 'Process', hr: 'Proces' },
    'process.output':    { en: 'Output',  hr: 'Izlaz' },
    'process.why_good':  { en: 'Why it worked',         hr: 'Što je radilo' },
    'process.why_limited':{ en: 'Why it broke',         hr: 'Što je puklo' },
    'process.artifacts': { en: 'Artifacts',             hr: 'Artefakti' },
    'process.diagram':   { en: 'The three approaches at a glance', hr: 'Tri pristupa na prvi pogled' },
    'process.deep_dive.input':    { en: 'Input',    hr: 'Ulaz' },
    'process.deep_dive.output':   { en: 'Output',   hr: 'Izlaz' },
    'process.deep_dive.expected': { en: 'Expected', hr: 'Očekivano' },
    'process.deep_dive.received': { en: 'Received', hr: 'Dobiveno' },
    'process.kind.algo':          { en: 'algorithmic', hr: 'algoritamski' },
    'process.kind.llm':           { en: 'LLM',         hr: 'LLM' },
    'process.kind.hybrid':        { en: 'hybrid',      hr: 'hibrid' },
    'process.deep_dive.todo':     { en: '(translation pending — content below in English)',
                                    hr: '(prijevod u tijeku — sadržaj u nastavku je na engleskom)' },

    'search.placeholder': { en: 'Search projects, producers, directors…',
                            hr: 'Traži projekt, producenta, redatelja…' },
    'facet.year':     { en: 'Year',           hr: 'Godina' },
    'facet.program':  { en: 'Programme',      hr: 'Program' },
    'facet.cat':      { en: 'Category',       hr: 'Kategorija' },
    'facet.rok':      { en: 'Round',          hr: 'Rok' },
    'facet.currency': { en: 'Currency',       hr: 'Valuta' },
    'facet.original': { en: 'As decided',     hr: 'Izvorno' },
    'facet.normalize':{ en: 'Normalize to €', hr: 'Normaliziraj u €' },
    'facet.all':      { en: 'all',            hr: 'sve' },
    'facet.reset':    { en: 'Reset',          hr: 'Poništi' },
    'facet.copy':     { en: 'Copy share-link',hr: 'Kopiraj link' },
    'facet.unfunded.label': { en: 'Discussed, never funded', hr: 'Spominjani, ne financirani' },
    'facet.unfunded.sub':   { en: 'projects mentioned in jury narratives without a funding record',
                              hr: 'projekti spomenuti u obrazloženjima žirija bez evidencije financiranja' },

    'header.line': { en: 'Croatian audiovisual public funding · 2009–{maxYear}',
                     hr: 'Hrvatski javni poticaji za audiovizualnu djelatnost · 2009.–{maxYear}.' },
    'header.decisions': { en: '{n} decisions', hr: '{n} odluka' },
    'header.funded':    { en: '{amt} funded',  hr: '{amt} dodijeljeno' },
    'header.calls':     { en: '{n} calls',     hr: '{n} natječaja' },
    'header.unfunded':  { en: '{n} unfunded',  hr: '{n} bez sredstava' },
    'header.notice.kicker': {
      en: 'Data provenance',
      hr: 'Podrijetlo podataka',
    },
    'header.notice.body': {
      en: 'All registry data is machine-extracted from public funding results published on havc.hr. Each project, decision, and amount links directly to the source HAVC PDF. No human review has been performed yet; human review is planned if HAVC approves the project under Komplementarne.',
      hr: 'Svi podaci u registru strojno su izdvojeni iz javno objavljenih rezultata financiranja na havc.hr. Svaki projekt, odluka i iznos imaju izravnu poveznicu na izvorni HAVC PDF. Ručna provjera još nije provedena; planirana je ako HAVC odobri projekt u okviru poziva Komplementarne.',
    },

    'toggle.lang': { en: 'Language', hr: 'Jezik' },
    'toggle.theme': { en: 'Theme', hr: 'Tema' },
    'toggle.theme.light': { en: 'Light', hr: 'Svijetlo' },
    'toggle.theme.dark': { en: 'Dark', hr: 'Tamno' },
    'toggle.theme.auto': { en: 'Auto', hr: 'Auto' },

    'metric.total':       { en: 'Total funded',  hr: 'Ukupno dodijeljeno' },
    'metric.median':      { en: 'Median award',  hr: 'Medijan iznos' },
    'metric.count':       { en: 'decisions',     hr: 'odluka' },
    'metric.yearTrend':   { en: 'Year trend',    hr: 'Po godini' },
    'metric.distrib':     { en: 'Award sizes',   hr: 'Raspodjela iznosa' },
    'metric.click.hint':  { en: 'click a bar to scope', hr: 'klik na stupić za opseg' },

    'scope.label':    { en: 'scope', hr: 'opseg' },
    'scope.empty':    { en: 'nothing scoped — click any bar, group row, or value to narrow',
                        hr: 'nije sužen opseg — klikni stupić, grupu ili vrijednost' },
    'scope.clearAll': { en: 'clear all', hr: 'očisti sve' },
    'scope.kind.producer':  { en: 'producer',  hr: 'producent' },
    'scope.kind.director':  { en: 'director',  hr: 'redatelj' },
    'scope.kind.writer':    { en: 'writer',    hr: 'scenarist' },
    'scope.kind.year':      { en: 'year',      hr: 'godina' },
    'scope.kind.program':   { en: 'programme', hr: 'program' },
    'scope.kind.cat':       { en: 'category',  hr: 'kategorija' },
    'scope.kind.rok':       { en: 'round',     hr: 'rok' },
    'scope.kind.sizeBand':  { en: 'amount',    hr: 'iznos' },
    'scope.kind.project':   { en: 'project',   hr: 'projekt' },

    'pivot.label':     { en: 'Group by', hr: 'Grupiraj po' },
    'pivot.projects':  { en: 'Projects',  hr: 'Projekti' },
    'pivot.decisions': { en: 'Decisions', hr: 'Odluke' },
    'pivot.producer':  { en: 'Producer',  hr: 'Producent' },
    'pivot.director':  { en: 'Director',  hr: 'Redatelj' },
    'pivot.writer':    { en: 'Writer',    hr: 'Scenarist' },
    'pivot.year':      { en: 'Year',      hr: 'Godina' },
    'pivot.program':   { en: 'Programme', hr: 'Program' },
    'pivot.cat':       { en: 'Category',  hr: 'Kategorija' },
    'pivot.hideUnattributed': { en: 'hide unattributed', hr: 'sakrij neidentificirano' },
    'pivot.hiddenSuffix':     { en: 'rows hidden',       hr: 'redaka skriveno' },

    'col.title':     { en: 'Title',       hr: 'Naslov' },
    'col.recipient': { en: 'Recipient',   hr: 'Korisnik' },
    'col.year':      { en: 'Year',        hr: 'Godina' },
    'col.amount':    { en: 'Amount',      hr: 'Iznos' },
    'col.avg':       { en: 'Avg',         hr: 'Prosjek' },
    'col.decisions': { en: 'Decisions',   hr: 'Odluke' },
    'col.total':     { en: 'Total',       hr: 'Ukupno' },
    'col.name':      { en: 'Name',        hr: 'Naziv' },
    'col.director':  { en: 'Director',    hr: 'Redatelj/ica' },
    'col.producer':  { en: 'Producer',    hr: 'Producent' },
    'col.applicant': { en: 'Applicant',   hr: 'Nositelj' },
    'col.writer':    { en: 'Writer',      hr: 'Scenarist/ica' },
    'col.category':  { en: 'Category',    hr: 'Kategorija' },
    'col.section':   { en: 'Section',     hr: 'Sekcija' },
    'col.rok':       { en: 'Round',       hr: 'Rok' },
    'col.rounds':    { en: 'rounds',      hr: 'rundi' },
    'col.programs':  { en: 'programmes',  hr: 'programi' },
    'col.range':     { en: 'years',       hr: 'godine' },
    'col.unattributed': { en: '(unattributed)', hr: '(neidentificirano)' },
    'col.unattributed.producer': { en: '(no producer recorded)', hr: '(producent nije zabilježen)' },
    'col.unattributed.director': { en: '(no director recorded)', hr: '(redatelj nije zabilježen)' },
    'col.unattributed.writer':   { en: '(no writer recorded)',   hr: '(scenarist nije zabilježen)' },

    'status.showing': { en: 'Showing', hr: 'Prikazano' },
    'status.of':      { en: 'of',      hr: 'od' },
    'status.rows':    { en: 'records', hr: 'zapisa' },
    'status.total':   { en: 'total',   hr: 'ukupno' },
    'status.empty':   { en: 'No funding decisions match these filters — try removing a chip or widening the year range.',
                        hr: 'Nijedna odluka ne odgovara filterima — pokušaj ukloniti čip ili proširi raspon godina.' },

    'profile.scopeIn': { en: 'scope to this project', hr: 'suzi na ovaj projekt' },
    'profile.rounds':  { en: '{n} rounds', hr: '{n} rundi' },
    'profile.total':   { en: 'total',   hr: 'ukupno' },
    'profile.timeline':{ en: 'Funding timeline', hr: 'Vremenska crta financiranja' },
    'profile.people':  { en: 'People', hr: 'Ljudi' },
    'profile.rounds_section': { en: 'Rounds', hr: 'Runde' },
    'profile.mentions':{ en: 'Mentions', hr: 'Spomeni' },
    'profile.why':     { en: 'why', hr: 'zašto' },
    'profile.no_narrative': { en: 'no jury narrative on file for this round', hr: 'nema obrazloženja žirija za ovu rundu' },
    'profile.source':  { en: 'Source decision', hr: 'Izvor odluke' },
    'profile.call':    { en: 'Call', hr: 'Natječaj' },
    'profile.decisionDate':{ en: 'Decision', hr: 'Datum odluke' },
    'profile.decisionBody':{ en: 'Decision body', hr: 'Tijelo' },
    'profile.sessionTotal':{ en: 'Session total', hr: 'Sjednica – ukupno' },
    'profile.pdf':     { en: 'PDF', hr: 'PDF' },
    'profile.narratives_count':{ en: '{n} narratives', hr: '{n} obrazloženja' },
    'profile.decisions_count': { en: '{n} sanctions / clawbacks', hr: '{n} sankcija / povrata' },
    'profile.scope_short': { en: 'scope', hr: 'suzi' },
    'pdf.preview':     { en: 'preview', hr: 'pregled' },
    'pdf.missing':     { en: 'no canonical PDF on file', hr: 'nema službenog PDF-a' },
    'pdf.preview_title': { en: 'HAVC source preview', hr: 'Pregled HAVC izvora' },
    'pdf.havc_source': { en: 'HAVC source', hr: 'HAVC izvor' },
    'pdf.url_label':   { en: 'HAVC URL', hr: 'HAVC URL' },
    'pdf.source_note': { en: 'Directly loaded from havc.hr for source validation.', hr: 'Izravno učitano s havc.hr radi provjere izvora.' },
    'pdf.open_new_tab':{ en: 'open in new tab', hr: 'otvori u novoj kartici' },
    'pdf.download':    { en: 'download', hr: 'preuzmi' },

    'unfunded.title': { en: 'Discussed but never funded',
                        hr: 'Spominjani, ali nikad financirani' },
    'unfunded.note':  { en: 'Projects mentioned in jury narratives or decision documents that don\'t appear in any results table. Click one to scope the main view to that title.',
                        hr: 'Projekti spomenuti u obrazloženjima žirija ili odlukama, ali bez zapisa u rezultatima. Klikni redak da suziš pregled na taj naslov.' },
    'modal.close':    { en: 'close',  hr: 'zatvori' },

    // Programmes
    'prog.razvoj_projekata':       { en: 'Project development',    hr: 'Razvoj projekata' },
    'prog.proizvodnja':            { en: 'Production',             hr: 'Proizvodnja' },
    'prog.manjinske_koprodukcije': { en: 'Minority co-production', hr: 'Manjinske koprodukcije' },
    'prog.razvoj_scenarija':       { en: 'Script development',     hr: 'Razvoj scenarija' },
    'prog.distribucija':           { en: 'Distribution',           hr: 'Distribucija' },
    'prog.medjunarodna_suradnja':  { en: 'International cooperation', hr: 'Međunarodna suradnja' },
    'prog.covid':                  { en: 'COVID emergency',        hr: 'COVID hitne mjere' },
    'prog.festivali':              { en: 'Festivals',              hr: 'Festivali' },
    'prog.media_matching':         { en: 'MEDIA matching',         hr: 'MEDIA matching' },
    'prog.tv_djela':               { en: 'TV works',               hr: 'TV djela' },
    'prog.videoigre':              { en: 'Video games',            hr: 'Video igre' },
    'prog.komplementarne':         { en: 'Complementary',          hr: 'Komplementarne' },
    'prog.other':                  { en: 'Other',                  hr: 'Ostalo' },

    // Categories
    'cat.feature':              { en: 'Feature',               hr: 'Dugometražni igrani film' },
    'cat.feature-coprod':       { en: 'Feature · co-prod.',    hr: 'Dugometražni igrani film · koprod.' },
    'cat.short':                { en: 'Short',                 hr: 'Kratkometražni igrani film' },
    'cat.short-coprod':         { en: 'Short · co-prod.',      hr: 'Kratkometražni igrani film · koprod.' },
    'cat.doc-feature':          { en: 'Documentary',           hr: 'Dokumentarni' },
    'cat.doc-feature-coprod':   { en: 'Doc. · co-prod.',       hr: 'Dok. · koprod.' },
    'cat.doc-short':            { en: 'Doc. short',            hr: 'Kratki dok.' },
    'cat.doc-short-coprod':     { en: 'Doc. short · co-prod.', hr: 'Kratki dok. · koprod.' },
    'cat.animation':            { en: 'Animation',             hr: 'Animirani' },
    'cat.experimental':         { en: 'Experimental',          hr: 'Eksperimentalni' },
    'cat.tv':                   { en: 'TV',                    hr: 'TV' },
    'cat.series':               { en: 'Series',                hr: 'Serija' },
    'cat.videogame':            { en: 'Game',                  hr: 'Igra' },
    'cat.admin-cost':           { en: 'Admin (budget code)',   hr: 'Admin (proračun)' },
    'cat.other':                { en: 'Other',                 hr: 'Ostalo' },
  };

  function t(key, lang, vars) {
    const e = T[key];
    let s = (e && (e[lang] || e.en)) || key;
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }

  const UNATTRIBUTED_KEY = '__unattributed__';
  const SIZE_BUCKETS = [0, 1000, 5000, 20000, 50000, 100000, 250000, 500000, 1000000, Infinity];

  // ═══ 2. Data loader + indexers ══════════════════════════════════════
  let DATA = null;
  let docById = new Map();
  let narrativeById = new Map();
  let decisionById = new Map();
  let searchIndex = new Map();           // token -> Set<rowIdx>
  let rowNormTitles = [];                // rowIdx -> normalized title
  let projectIndex = new Map();          // normTitle -> aggregated project record

  function normalizeText(s) {
    if (!s) return '';
    return s.toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u0111\u0110]/g, 'd');
  }
  function normTitle(s) {
    if (!s) return '';
    return normalizeText(s).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tokens(s) {
    const out = new Set();
    normalizeText(s).split(/[^a-z0-9]+/).forEach(t => { if (t.length >= 2) out.add(t); });
    return out;
  }

  const HRK_TO_EUR = 7.5345;
  const PROGRAM_SLUGS = new Set([
    'razvoj_projekata', 'proizvodnja', 'manjinske_koprodukcije', 'razvoj_scenarija',
    'distribucija', 'medjunarodna_suradnja', 'covid', 'festivali', 'media_matching',
    'tv_djela', 'videoigre', 'komplementarne', 'other',
  ]);
  const CATEGORY_SLUGS = new Set([
    'feature', 'feature-coprod',
    'short', 'short-coprod',
    'doc-feature', 'doc-feature-coprod',
    'doc-short', 'doc-short-coprod',
    'animation', 'experimental', 'tv', 'series', 'videogame',
    'admin-cost', 'other',
  ]);
  const NON_FUNDING_FILENAME_RE = /(?:^|\/)(?:pr[-_\s]?ras|rashodi|bil[\s_-])/i;
  const LEDGER_FILENAME_RE = /web[\s_-]*objava|isplate/i;
  const MOJIBAKE_RE = /[\u00C2\u00C3\u00E2\uFFFD]/g;
  const MOJIBAKE_CRO_RE = /(?:\u00C5\u00A1|\u00C5\u00BE|\u00C5\u00BD|\u00C5\u00A0|\u00C4\u008D|\u00C4\u0087|\u00C4\u0091|\u00C4\u008C|\u00C4\u0086|\u00C4\u0090)/g;
  const MOJIBAKE_PUNCT_RE = /(?:\u00E2\u20AC\u201D|\u00E2\u20AC\u201C|\u00E2\u20AC\u00A6|\u00C2\u00B7|\u00E2\u201A\u00AC|\u00E2\u2020\u2019|\u00C3\u2014|\u00E2\u2014\u0090|\u00E2\u02DC\u20AC|\u00E2\u02DC\u00BE)/g;
  const UTF8_DECODER = typeof TextDecoder !== 'undefined'
    ? new TextDecoder('utf-8', { fatal: true })
    : null;
  const CP1252_DECODER = typeof TextDecoder !== 'undefined'
    ? new TextDecoder('windows-1252')
    : null;
  const CP1252_REVERSE = (() => {
    if (!CP1252_DECODER) return null;
    const map = new Map();
    for (let b = 0; b < 256; b++) {
      const ch = CP1252_DECODER.decode(Uint8Array.of(b));
      if (!map.has(ch)) map.set(ch, b);
    }
    return map;
  })();

  function asArray(v) { return Array.isArray(v) ? v : []; }

  function asObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function toFiniteNumber(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function toFiniteInt(v) {
    const n = toFiniteNumber(v);
    return n == null ? null : Math.trunc(n);
  }

  function amountEur(amount, currency) {
    if (amount == null) return null;
    if (currency === 'HRK') return Math.round((amount / HRK_TO_EUR) * 100) / 100;
    return amount;
  }

  function mojibakeScore(s) {
    if (!s) return 0;
    let bad = 0;
    bad += (s.match(MOJIBAKE_RE) || []).length;
    bad += (s.match(MOJIBAKE_CRO_RE) || []).length * 2;
    bad += (s.match(MOJIBAKE_PUNCT_RE) || []).length * 2;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0x80 && code <= 0x9f) bad += 2;
    }
    return bad;
  }

  function cp1252BytesFromString(s) {
    if (!CP1252_REVERSE) return null;
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const b = CP1252_REVERSE.get(ch);
      if (b == null) return null;
      bytes[i] = b;
    }
    return bytes;
  }

  function tryRepairMojibakeOnce(s) {
    if (!UTF8_DECODER) return null;
    const bytes = cp1252BytesFromString(s);
    if (!bytes) return null;
    try {
      return UTF8_DECODER.decode(bytes);
    } catch (_) {
      return null;
    }
  }

  function repairMojibakeString(s) {
    if (typeof s !== 'string' || !s) return s;
    let best = s;
    let bestScore = mojibakeScore(s);
    let cur = s;
    for (let i = 0; i < 3; i++) {
      const candidate = tryRepairMojibakeOnce(cur);
      if (!candidate) break;
      const nextScore = mojibakeScore(candidate);
      if (nextScore < bestScore && !candidate.includes('\uFFFD')) {
        best = candidate;
        bestScore = nextScore;
        cur = candidate;
      } else {
        break;
      }
    }
    return best;
  }

  function sanitizeDeep(value) {
    if (typeof value === 'string') return repairMojibakeString(value);
    if (Array.isArray(value)) return value.map(sanitizeDeep);
    if (value && typeof value === 'object') {
      const out = {};
      for (const k in value) out[k] = sanitizeDeep(value[k]);
      return out;
    }
    return value;
  }

  function normalizeProgram(p) {
    if (!p) return 'other';
    return PROGRAM_SLUGS.has(p) ? p : 'other';
  }

  function slugifyCategory(text) {
    if (!text) return 'other';
    const folded = normalizeText(text);

    if (/^\s*\d{4}\b/.test(folded)) return 'admin-cost';

    const hasCoprod = folded.includes('koprodukcij') || folded.includes('manjinsk') || folded.includes('koprod');
    let kind = null;

    if (folded.includes('videoigr') || folded.includes('video igr')) kind = 'videogame';
    else if (folded.includes('animir') || folded.includes('animacij')) kind = 'animation';
    else if (folded.includes('eksperimentaln')) kind = 'experimental';
    else if (folded.includes('serij')) kind = 'series';
    else if (folded.includes('televizijsk') || /\btv\b/.test(folded)) kind = 'tv';
    else if (folded.includes('dokumentarn') || /\bdok\b/.test(folded)) kind = 'doc';
    else if (
      folded.includes('igran') ||
      folded.includes('dugometr') ||
      folded.includes('kratkometr') ||
      /\bdugi\b/.test(folded) ||
      /\bkratki\b/.test(folded)
    ) kind = 'fiction';
    else return 'other';

    if (kind === 'videogame' || kind === 'animation' || kind === 'experimental' || kind === 'series' || kind === 'tv') {
      return kind;
    }

    const isShort =
      folded.includes('kratkometr') ||
      folded.includes('kratki ') ||
      folded.includes('kratka ') ||
      folded.includes('kratko ');
    const length = isShort ? 'short' : 'feature';
    const base = kind === 'doc' ? ('doc-' + length) : length;
    const slug = hasCoprod ? (base + '-coprod') : base;
    return CATEGORY_SLUGS.has(slug) ? slug : 'other';
  }

  function hash8(text) {
    const str = String(text || '');
    let h = 2166136261 >>> 0; // FNV-1a 32-bit
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
  }

  function makeRecordId(rec, idx, used) {
    const src = asObject(rec && rec.source);
    const baseRaw = src.sha256 || src.filename_decoded || src.filename || ('record-' + idx);
    const base = String(baseRaw).slice(0, 8) || hash8(baseRaw);
    let out = base;
    let i = 1;
    while (used.has(out)) out = base + '_' + (i++);
    used.add(out);
    return out;
  }

  function isNonFundingDoc(filename) {
    if (!filename) return false;
    return NON_FUNDING_FILENAME_RE.test(filename) || LEDGER_FILENAME_RE.test(filename);
  }

  function calcMedian(nums) {
    if (!nums.length) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function flagOutliers(rows) {
    const buckets = new Map();
    rows.forEach((r) => {
      if (r.amount_eur == null || r.year == null || !r.program) return;
      const key = r.year + '|' + r.program;
      const list = buckets.get(key) || [];
      list.push(r.amount_eur);
      buckets.set(key, list);
    });

    const medians = new Map();
    for (const [k, list] of buckets) {
      if (list.length < 5) continue;
      const med = calcMedian(list);
      if (med != null) medians.set(k, med);
    }

    let flagged = 0;
    rows.forEach((r) => {
      if (r.amount_eur == null || r.year == null || !r.program) return;
      if (r.cat_type == null || r.cat_type === 'other' || r.cat_type === 'admin-cost') return;
      const med = medians.get(r.year + '|' + r.program);
      if (med == null) return;
      if (r.amount_eur > Math.max(4 * med, 100000)) {
        r.flag = 'outlier';
        flagged += 1;
      }
    });

    return flagged;
  }

  function extractEventDoc(rec, id) {
    const src = asObject(rec.source);
    const doc = asObject(rec.document);
    const filename = src.filename || src.filename_decoded || null;
    const sourceUrl = src.source_url || src.url || null;
    return {
      id,
      filename,
      source_url: sourceUrl,
      year: toFiniteInt(doc.year),
      program: normalizeProgram(doc.program_type),
      rok: doc.rok || null,
      summary: doc.summary || null,
      referenced_projects: asArray(doc.referenced_projects).map(String),
    };
  }

  function processResultsRecord(rec, id) {
    const src = asObject(rec.source);
    const doc = asObject(rec.document);
    const totals = asObject(rec.totals);
    const filename = src.filename || src.filename_decoded || null;
    const sourceUrl = src.source_url || src.url || null;

    if (isNonFundingDoc(filename)) return { doc: null, rows: [] };

    const docCurrency = doc.currency || 'EUR';
    const docUkupnoRaw = toFiniteNumber(totals.ukupno);
    const docUkupnoEur = amountEur(docUkupnoRaw, docCurrency);
    const program = normalizeProgram(doc.program_type);
    const docYear = toFiniteInt(doc.year);
    const docRok = doc.rok || null;

    const docEntry = {
      id,
      filename,
      source_url: sourceUrl,
      source_url_missing: !sourceUrl && src.source_url_missing === true,
      natjecaj_title: doc.natjecaj_title || null,
      decision_date: doc.decision_date || null,
      decision_body: doc.decision_body || null,
      rok: docRok,
      year: docYear,
      program,
      currency: docCurrency,
      ukupno: docUkupnoEur,
      row_count: 0,
    };

    const outRows = [];
    let nCounter = 0;
    asArray(rec.sections).forEach((section) => {
      const sec = asObject(section);
      const sectionLabel = sec.section_label || null;
      asArray(sec.rows).forEach((rowAny) => {
        const row = asObject(rowAny);
        nCounter += 1;

        const titleRaw = row.project_title;
        let title = null;
        if (typeof titleRaw === 'string') {
          title = titleRaw.trim() || null;
        } else if (titleRaw != null) {
          title = String(titleRaw);
        }

        const approved = toFiniteNumber(row.approved_amount);
        const rawCat = row.category || null;
        const rowCurrency = row.currency || docCurrency;

        outRows.push({
          doc: id,
          n: row.row_number != null ? row.row_number : nCounter,
          title,
          applicant: row.applicant || null,
          producer: row.production_company || null,
          director: row.director || null,
          writer: row.writer || null,
          category: rawCat,
          cat_type: slugifyCategory(rawCat),
          section: sectionLabel,
          rok: docRok,
          amount: approved,
          currency: rowCurrency,
          amount_eur: amountEur(approved, rowCurrency),
          year: docYear,
          program,
          flag: null,
        });
      });
    });

    docEntry.row_count = nCounter;
    return { doc: docEntry, rows: outRows };
  }

  function buildProjectEvents(narratives, decisions) {
    const events = {};
    const seenByKey = new Map();

    function add(kind, doc, projectTitle) {
      const key = normTitle(projectTitle);
      if (!key) return;
      const evt = {
        type: kind,
        id: doc.id,
        year: doc.year,
        program: doc.program,
        summary: doc.summary,
        project: projectTitle,
      };

      let seen = seenByKey.get(key);
      if (!seen) { seen = new Set(); seenByKey.set(key, seen); }
      const sig = kind + '|' + doc.id + '|' + projectTitle;
      if (seen.has(sig)) return;
      seen.add(sig);

      if (!events[key]) events[key] = [];
      events[key].push(evt);
    }

    narratives.forEach((d) => asArray(d.referenced_projects).forEach((p) => add('narrative', d, p)));
    decisions.forEach((d) => asArray(d.referenced_projects).forEach((p) => add('decision', d, p)));
    return events;
  }

  function buildUnfundedMentions(rows, narratives) {
    const fundedTitles = new Set();
    rows.forEach((r) => {
      const k = normTitle(r.title);
      if (k) fundedTitles.add(k);
    });

    const bucket = new Map();
    narratives.forEach((n) => {
      asArray(n.referenced_projects).forEach((proj) => {
        const key = normTitle(proj);
        if (!key || fundedTitles.has(key)) return;
        let entry = bucket.get(key);
        if (!entry) {
          entry = { title: proj, narratives: [], first_year: null };
          bucket.set(key, entry);
        }
        if (!entry.narratives.includes(n.id)) entry.narratives.push(n.id);
        if (Number.isInteger(n.year)) {
          if (entry.first_year == null || n.year < entry.first_year) entry.first_year = n.year;
        }
      });
    });

    return [...bucket.values()].sort((a, b) => {
      const aNone = a.first_year == null;
      const bNone = b.first_year == null;
      if (aNone !== bNone) return aNone ? 1 : -1;
      if ((a.first_year || 0) !== (b.first_year || 0)) return (a.first_year || 0) - (b.first_year || 0);
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }

  function deriveFacets(rows) {
    const years = [...new Set(rows.map((r) => r.year).filter((v) => v != null))].sort((a, b) => a - b);
    return {
      years,
      programs: [...new Set(rows.map((r) => r.program).filter(Boolean))].sort(),
      cat_types: [...new Set(rows.map((r) => r.cat_type).filter(Boolean))].sort(),
      currencies: [...new Set(rows.map((r) => r.currency).filter(Boolean))].sort(),
      roks: [...new Set(rows.map((r) => r.rok).filter(Boolean))].sort(),
    };
  }

  function deriveCounts(shape) {
    return {
      rows: shape.rows.length,
      docs_results_tables: shape.docs.length,
      decisions: shape.decisions.length,
      narratives: shape.narratives.length,
      total_amount_eur: Math.round(shape.rows.reduce((s, r) => s + (r.amount_eur || 0), 0) * 100) / 100,
      flagged: shape.rows.reduce((n, r) => n + (r.flag === 'outlier' ? 1 : 0), 0),
      unfunded_mention_count: shape.unfunded_mentions.length,
      project_events_count: Object.keys(shape.project_events).length,
    };
  }

  function adaptExtractedRecords(records) {
    const docs = [];
    const rows = [];
    const narratives = [];
    const decisions = [];
    const usedIds = new Set();

    asArray(records).forEach((rec, idx) => {
      const r = asObject(rec);
      const docType = r.doc_type;
      const id = makeRecordId(r, idx, usedIds);

      if (docType === 'results_table') {
        const out = processResultsRecord(r, id);
        if (out.doc) docs.push(out.doc);
        rows.push(...out.rows);
      } else if (docType === 'narrative') {
        narratives.push(extractEventDoc(r, id));
      } else if (docType === 'decision') {
        decisions.push(extractEventDoc(r, id));
      }
    });

    const flagged = flagOutliers(rows);
    const projectEvents = buildProjectEvents(narratives, decisions);
    const unfundedMentions = buildUnfundedMentions(rows, narratives);
    const facets = deriveFacets(rows);

    return {
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      hrk_to_eur: HRK_TO_EUR,
      facets,
      rows,
      docs,
      narratives,
      decisions,
      project_events: projectEvents,
      unfunded_mentions: unfundedMentions,
      counts: {
        ...deriveCounts({
          rows, docs, narratives, decisions,
          project_events: projectEvents,
          unfunded_mentions: unfundedMentions,
        }),
        flagged,
      },
    };
  }

  function normalizeDashboardShape(raw) {
    const base = asObject(raw);
    const rows = asArray(base.rows);
    const docs = asArray(base.docs);
    const narratives = asArray(base.narratives);
    const decisions = asArray(base.decisions);
    const projectEvents = asObject(base.project_events);
    const unfundedMentions = asArray(base.unfunded_mentions);

    const derivedFacets = deriveFacets(rows);
    const srcFacets = asObject(base.facets);
    const srcYears = asArray(srcFacets.years)
      .map((v) => toFiniteInt(v))
      .filter((v) => v != null)
      .sort((a, b) => a - b);
    const facets = {
      years: srcYears.length ? srcYears : derivedFacets.years,
      programs: asArray(srcFacets.programs).length ? asArray(srcFacets.programs) : derivedFacets.programs,
      cat_types: asArray(srcFacets.cat_types).length ? asArray(srcFacets.cat_types) : derivedFacets.cat_types,
      currencies: asArray(srcFacets.currencies).length ? asArray(srcFacets.currencies) : derivedFacets.currencies,
      roks: asArray(srcFacets.roks).length ? asArray(srcFacets.roks) : derivedFacets.roks,
    };

    if (!facets.years.length) facets.years = [new Date().getFullYear()];

    const normalized = {
      generated_at: base.generated_at || null,
      hrk_to_eur: toFiniteNumber(base.hrk_to_eur) || HRK_TO_EUR,
      facets,
      rows,
      docs,
      narratives,
      decisions,
      project_events: projectEvents,
      unfunded_mentions: unfundedMentions,
      counts: asObject(base.counts),
    };

    normalized.counts = {
      ...deriveCounts(normalized),
      ...normalized.counts,
    };
    return normalized;
  }

  function coerceDashboardData(raw) {
    if (Array.isArray(raw)) {
      if (raw.length && asObject(raw[0]).doc_type) return adaptExtractedRecords(raw);
      throw new Error('Unsupported data.json format: array without doc_type records.');
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) {
      return normalizeDashboardShape(raw);
    }
    throw new Error('Unsupported data.json format.');
  }

  async function loadData() {
    const res = await fetch('havc/data.json');
    const raw = sanitizeDeep(await res.json());
    DATA = coerceDashboardData(raw);
    docById = new Map(DATA.docs.map(d => [d.id, d]));
    narrativeById = new Map(DATA.narratives.map(n => [n.id, n]));
    decisionById = new Map(DATA.decisions.map(d => [d.id, d]));

    searchIndex = new Map();
    rowNormTitles = new Array(DATA.rows.length);
    DATA.rows.forEach((r, i) => {
      rowNormTitles[i] = normTitle(r.title);
      const fields = [r.title, r.director, r.producer, r.applicant, r.writer];
      for (const f of fields) {
        for (const tok of tokens(f || '')) {
          let bucket = searchIndex.get(tok);
          if (!bucket) { bucket = new Set(); searchIndex.set(tok, bucket); }
          bucket.add(i);
        }
      }
    });

    buildProjectIndex();
  }

  function buildProjectIndex() {
    projectIndex = new Map();
    DATA.rows.forEach((r, i) => {
      const key = rowNormTitles[i] || UNATTRIBUTED_KEY;
      let p = projectIndex.get(key);
      if (!p) {
        p = {
          title: r.title || '(no title)',
          normTitle: key,
          rows: [],
          total_eur: 0,
          yearMin: null, yearMax: null,
          people: {
            directors: new Set(), producers: new Set(),
            applicants: new Set(), writers: new Set(),
          },
          programs: new Set(),
          cats: new Set(),
        };
        projectIndex.set(key, p);
      }
      p.rows.push(i);
      if (r.amount_eur) p.total_eur += r.amount_eur;
      if (r.year != null) {
        if (p.yearMin == null || r.year < p.yearMin) p.yearMin = r.year;
        if (p.yearMax == null || r.year > p.yearMax) p.yearMax = r.year;
      }
      if (r.director)  p.people.directors.add(r.director);
      if (r.producer)  p.people.producers.add(r.producer);
      if (r.applicant) p.people.applicants.add(r.applicant);
      if (r.writer)    p.people.writers.add(r.writer);
      if (r.program)   p.programs.add(r.program);
      if (r.cat_type)  p.cats.add(r.cat_type);
    });
  }

  function projectEventsFor(key) {
    return (key && DATA.project_events && DATA.project_events[key]) || [];
  }

  function searchRowIds(query) {
    const qToks = [...tokens(query)];
    if (qToks.length === 0) return null;
    let acc = null;
    for (const qt of qToks) {
      let matched = null;
      for (const [k, set] of searchIndex) {
        if (k.startsWith(qt)) {
          if (!matched) matched = new Set(set);
          else set.forEach(v => matched.add(v));
        }
      }
      if (!matched) return new Set();
      acc = acc ? new Set([...acc].filter(x => matched.has(x))) : matched;
    }
    return acc;
  }

  // ═══ 3. State + observer ════════════════════════════════════════════
  const state = {
    filters: {
      yearRange: null,
      programs: new Set(),
      cats: new Set(),
      roks: new Set(),
      normalize: true,
      q: '',
      selectedYear: null,
    },
    scopes: [],            // {kind, value, label?}
    groupBy: 'projects',
    sort: { key: 'title', dir: 'asc' },
    expandedKey: null,     // normTitle of the expanded project (works in projects/decisions)
    expandedRoundIds: new Set(), // `${doc}:${n}` per expanded "why" inside a profile
    expandedMentions: false,
    theme: localStorage.getItem('sredstva-theme') || 'light',
    lang: localStorage.getItem('sredstva-lang') || 'hr',
    hideUnattributed: true,
    showUnfunded: false,
    pdfPreview: null, // { title, source_url }
    view: 'dashboard', // 'dashboard' | 'about' | 'process'
  };

  const DEFAULT_SORT_BY_PIVOT = {
    projects:  { key: 'title', dir: 'asc' },
    decisions: { key: 'title', dir: 'asc' },
    producer:  { key: 'name',  dir: 'asc' },
    director:  { key: 'name',  dir: 'asc' },
    writer:    { key: 'name',  dir: 'asc' },
    program:   { key: 'name',  dir: 'asc' },
    cat:       { key: 'name',  dir: 'asc' },
  };
  function defaultSortFor(groupBy) {
    return DEFAULT_SORT_BY_PIVOT[groupBy] || { key: 'title', dir: 'asc' };
  }

  const subs = new Map();
  function on(keys, fn) {
    const arr = Array.isArray(keys) ? keys : [keys];
    arr.forEach(k => {
      if (!subs.has(k)) subs.set(k, new Set());
      subs.get(k).add(fn);
    });
  }
  function fire(keys) {
    const fired = new Set();
    const arr = Array.isArray(keys) ? keys : [keys];
    arr.forEach(k => {
      const set = subs.get(k);
      if (set) set.forEach(fn => { if (!fired.has(fn)) { fired.add(fn); fn(); } });
    });
  }

  function setFilters(patch) {
    state.filters = { ...state.filters, ...patch };
    const sy = state.filters.selectedYear;
    const yr = state.filters.yearRange;
    if (sy != null && yr && (sy < yr[0] || sy > yr[1])) {
      state.filters.selectedYear = null;
    }
    schedulePersist();
    fire('filters');
  }
  function setGroupBy(g) {
    state.groupBy = g;
    state.sort = defaultSortFor(g);
    state.expandedKey = null;
    state.expandedRoundIds = new Set();
    state.expandedMentions = false;
    schedulePersist();
    fire(['groupBy', 'expanded', 'sort']);
  }
  function setSort(patch) {
    const next = { ...state.sort, ...patch };
    if (state.sort.key === next.key && state.sort.dir === next.dir) return;
    state.sort = next;
    schedulePersist();
    fire('sort');
  }
  function toggleSort(key) {
    if (state.sort.key === key) {
      setSort({ dir: state.sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSort({ key, dir: 'asc' });
    }
  }
  function setSelectedYear(year) {
    const next = year == null ? null : Number(year);
    if (state.filters.selectedYear === next) return;
    state.filters.selectedYear = next;
    schedulePersist();
    fire('filters');
  }
  function setExpandedKey(key) {
    state.expandedKey = state.expandedKey === key ? null : key;
    state.expandedRoundIds = new Set();
    state.expandedMentions = false;
    fire('expanded');
  }
  function toggleRoundExpanded(id) {
    if (state.expandedRoundIds.has(id)) state.expandedRoundIds.delete(id);
    else state.expandedRoundIds.add(id);
    fire('expanded');
  }
  function toggleMentionsExpanded() {
    state.expandedMentions = !state.expandedMentions;
    fire('expanded');
  }
  function setTheme(theme) {
    state.theme = theme;
    localStorage.setItem('sredstva-theme', theme);
    document.body.classList.remove('theme-auto', 'theme-light', 'theme-dark');
    document.body.classList.add('theme-' + theme);
    fire('theme');
  }
  function setLang(lang) {
    state.lang = lang;
    localStorage.setItem('sredstva-lang', lang);
    document.documentElement.lang = lang;
    fire('lang');
  }

  function cycleLang() {
    setLang(state.lang === 'hr' ? 'en' : 'hr');
  }

  function nextTheme(theme) {
    if (theme === 'light') return 'dark';
    if (theme === 'dark') return 'auto';
    return 'light';
  }

  function cycleTheme() {
    setTheme(nextTheme(state.theme));
  }
  function setHideUnattributed(v) {
    state.hideUnattributed = v;
    fire(['hideUnattributed', 'filters']);
  }
  function setShowUnfunded(v) {
    state.showUnfunded = v;
    fire('showUnfunded');
  }
  function setPdfPreview(v) {
    state.pdfPreview = v || null;
    fire('pdfPreview');
  }
  function setView(view) {
    const next = (view === 'about' || view === 'process') ? view : 'dashboard';
    if (state.view === next) return;
    state.view = next;
    document.body.classList.remove('view-dashboard', 'view-about', 'view-process');
    document.body.classList.add('view-' + next);
    fire('view');
  }
  function readViewFromHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    if (h === 'about') return 'about';
    if (h === 'process') return 'process';
    return 'dashboard';
  }
  function syncViewFromHash() {
    setView(readViewFromHash());
  }
  function navigateView(view) {
    const path = view === 'dashboard' ? '#/' : ('#/' + view);
    if (location.hash !== path) {
      location.hash = path;        // fires hashchange → syncViewFromHash → setView
    } else {
      setView(view);                // already there; still toggle in case of programmatic call
    }
  }

  function scopesEqual(a, b) {
    if (a.kind !== b.kind) return false;
    if (Array.isArray(a.value) && Array.isArray(b.value)) {
      return a.value.length === b.value.length && a.value.every((v, i) => v === b.value[i]);
    }
    return a.value === b.value;
  }
  function addScope(scope, opts) {
    const exists = state.scopes.find(s => scopesEqual(s, scope));
    if (exists) return;
    state.scopes = [...state.scopes, scope];
    if (opts && opts.switchToProjects) {
      state.groupBy = 'projects';
      state.expandedKey = null;
    }
    schedulePersist();
    fire(['scopes', 'groupBy']);
  }
  function removeScope(idx) {
    state.scopes = state.scopes.filter((_, i) => i !== idx);
    schedulePersist();
    fire('scopes');
  }
  function clearScopes() {
    if (state.scopes.length === 0) return;
    state.scopes = [];
    schedulePersist();
    fire('scopes');
  }
  function popDeepestScope() {
    if (state.scopes.length === 0) return false;
    state.scopes = state.scopes.slice(0, -1);
    schedulePersist();
    fire('scopes');
    return true;
  }

  // ═══ 4. URL ↔ state ════════════════════════════════════════════════
  let persistTimer = null;
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistToHash, 500);
  }
  function persistToHash() {
    try {
      const f = state.filters;
      const payload = {
        y: f.yearRange,
        p: [...f.programs],
        c: [...f.cats],
        r: [...f.roks],
        n: f.normalize ? 1 : 0,
        q: f.q || '',
        g: state.groupBy,
        s: state.scopes,
        hu: state.hideUnattributed ? 1 : 0,
        sy: f.selectedYear,
        so: state.sort,
      };
      const enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const u = new URL(location.href);
      u.searchParams.set('f', enc);
      history.replaceState(null, '', u);
    } catch (_) {}
  }
  function readFromHash() {
    try {
      const u = new URL(location.href);
      const f = u.searchParams.get('f');
      if (!f) return;
      const payload = JSON.parse(decodeURIComponent(escape(atob(f))));
      if (payload.y) state.filters.yearRange = payload.y;
      if (Array.isArray(payload.p)) state.filters.programs = new Set(payload.p);
      if (Array.isArray(payload.c)) state.filters.cats = new Set(payload.c);
      if (Array.isArray(payload.r)) state.filters.roks = new Set(payload.r);
      if (typeof payload.n === 'number') state.filters.normalize = !!payload.n;
      if (typeof payload.q === 'string') state.filters.q = payload.q;
      if (typeof payload.g === 'string') {
        // backward compat: 'project' → 'decisions'; 'year' → 'projects' (year is now a filter, not a pivot)
        // Phase 6: 'applicant' → 'producer' (applicant is now an alias of producer after entity unification)
        let g = payload.g === 'project' ? 'decisions' : payload.g;
        if (g === 'year') g = 'projects';
        if (g === 'applicant') g = 'producer';
        if (PIVOTS.includes(g)) state.groupBy = g;
      }
      if (Array.isArray(payload.s)) {
        // Migrate stale applicant scopes to producer (Phase 6).
        state.scopes = payload.s.map(s =>
          (s && s.kind === 'applicant') ? Object.assign({}, s, { kind: 'producer' }) : s
        );
      }
      if (typeof payload.hu === 'number') state.hideUnattributed = !!payload.hu;
      if (typeof payload.sy === 'number') state.filters.selectedYear = payload.sy;
      if (payload.so && typeof payload.so === 'object' && typeof payload.so.key === 'string') {
        state.sort = {
          key: payload.so.key,
          dir: payload.so.dir === 'desc' ? 'desc' : 'asc',
        };
      } else {
        state.sort = defaultSortFor(state.groupBy);
      }
    } catch (_) {}
  }

  // ═══ 5. Atoms ═══════════════════════════════════════════════════════
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style') node.setAttribute('style', v);
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          for (const dk in v) node.dataset[dk] = v[dk];
        } else {
          node.setAttribute(k, v);
        }
      }
    }
    if (children) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function fa(iconClass, extraClass) {
    return el('i', {
      class: (iconClass || '') + (extraClass ? (' ' + extraClass) : ''),
      'aria-hidden': 'true',
    });
  }

  function formatAmount(n, currency, lang) {
    if (n == null) return '—';
    const locale = lang === 'hr' ? 'hr-HR' : 'en-US';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0,
      }).format(n);
    } catch (_) {
      return Math.round(n).toLocaleString(locale) + ' ' + (currency || 'EUR');
    }
  }

  function formatCompact(n, lang) {
    if (n == null) return '—';
    const locale = lang === 'hr' ? 'hr-HR' : 'en-US';
    if (Math.abs(n) >= 1_000_000) return '€' + (n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 }) + 'M';
    if (Math.abs(n) >= 1000) return '€' + Math.round(n / 1000) + 'k';
    return '€' + Math.round(n);
  }

  function bandLabel(lo, hi) {
    const f = (v) => v >= 1_000_000 ? (v / 1_000_000) + 'M' : v >= 1000 ? (v / 1000) + 'k' : String(v);
    if (lo === 0) return '<' + f(hi);
    if (!isFinite(hi)) return f(lo) + '+';
    return f(lo) + '–' + f(hi);
  }

  function barsChart(values, labels, opts) {
    opts = opts || {};
    const max = Math.max(1, ...values);
    const tooltip = el('div', { class: 'bar-tooltip' });
    const bars = values.map((v, i) => {
      const bar = el('div', {
        class: 'bar',
        style: `height: ${Math.max(1, (v / max) * 100)}%`,
      });
      if (labels && labels[i] != null) bar.dataset.label = labels[i];
      bar.addEventListener('mouseenter', () => {
        tooltip.textContent = labels && labels[i] != null ? labels[i] : String(v);
        tooltip.classList.add('on');
        bar.classList.add('hot');
      });
      bar.addEventListener('mouseleave', () => {
        tooltip.classList.remove('on');
        bar.classList.remove('hot');
      });
      if (opts.onclick) bar.addEventListener('click', () => opts.onclick(i, v));
      return bar;
    });
    return el('div', { class: 'chart-wrap' }, [
      el('div', { class: 'bars' }, bars),
      tooltip,
    ]);
  }

  // ═══ 6. Topbar ═════════════════════════════════════════════════════
  function mountTopbar(root) {
    const VIEW_TABS = ['dashboard', 'about', 'process'];

    function viewTabBtn(view, lang) {
      const isActive = state.view === view;
      const attrs = {
        class: 'view-tab' + (isActive ? ' is-active' : ''),
        type: 'button',
        text: t('nav.' + view, lang),
        onclick: () => navigateView(view),
      };
      if (isActive) attrs['aria-current'] = 'page';
      return el('button', attrs);
    }

    function render() {
      const lang = state.lang;
      const isDash = state.view === 'dashboard';
      const nextLang = lang === 'hr' ? 'en' : 'hr';
      const themeIcon = state.theme === 'light'
        ? 'fa-solid fa-sun'
        : state.theme === 'dark'
          ? 'fa-solid fa-moon'
          : 'fa-solid fa-circle-half-stroke';
      root.replaceChildren(
        el('div', { class: 'topbar-row' }, [
          el('div', { class: 'wordmark' }, [
            'Sredstva',
            el('span', { class: 'dot', text: '·' }),
          ]),
          el('nav', {
            class: 'view-tabs',
            role: 'tablist',
            'aria-label': 'sections',
          }, VIEW_TABS.map(v => viewTabBtn(v, lang))),
          isDash ? el('div', { class: 'search' }, [
            fa('fa-solid fa-magnifying-glass', 'search-icon'),
            el('input', {
              type: 'text',
              placeholder: t('search.placeholder', lang),
              value: state.filters.q,
              oninput: (e) => {
                clearTimeout(render._searchDebounce);
                const val = e.target.value;
                render._searchDebounce = setTimeout(() => {
                  setFilters({ q: val });
                }, 220);
              },
            }),
          ]) : el('div', { class: 'search-spacer' }),
          el('div', { class: 'toolbar' }, [
            el('button', {
              class: 'mode-toggle mode-toggle-lang',
              type: 'button',
              title: t('toggle.lang', lang),
              'aria-label': `${t('toggle.lang', lang)}: ${lang.toUpperCase()}`,
              onclick: cycleLang,
            }, [
              el('span', { class: 'mode-toggle-k', text: t('toggle.lang', lang) }),
              el('span', { class: 'mode-toggle-v mono', text: lang.toUpperCase() }),
              el('span', { class: 'mode-toggle-next mono', text: nextLang.toUpperCase() }),
            ]),
            el('button', {
              class: 'mode-toggle mode-toggle-theme',
              type: 'button',
              title: t('toggle.theme', lang),
              'aria-label': `${t('toggle.theme', lang)}: ${t('toggle.theme.' + state.theme, lang)}`,
              onclick: cycleTheme,
            }, [
              fa(themeIcon),
              el('span', { class: 'mode-toggle-k', text: t('toggle.theme', lang) }),
              el('span', { class: 'mode-toggle-v mono', text: t('toggle.theme.' + state.theme, lang) }),
            ]),
          ]),
        ]),
      );
    }
    on(['lang', 'theme', 'filters', 'view'], render);
    render();
  }

  // ═══ 7. Filter rail ═════════════════════════════════════════════════
  const PROGRAM_ORDER = [
    'proizvodnja', 'manjinske_koprodukcije', 'razvoj_projekata', 'razvoj_scenarija',
    'distribucija', 'medjunarodna_suradnja', 'festivali', 'media_matching',
    'tv_djela', 'videoigre', 'covid', 'komplementarne', 'other',
  ];
  const CAT_ORDER = [
    'feature', 'feature-coprod', 'short', 'short-coprod',
    'doc-feature', 'doc-feature-coprod', 'doc-short', 'doc-short-coprod',
    'animation', 'experimental', 'tv', 'series', 'videogame',
    'admin-cost', 'other',
  ];

  function buildYearSlider(minYear, maxYear) {
    const range = Math.max(1, maxYear - minYear);
    const [yrFrom, yrTo] = state.filters.yearRange;

    let dragFrom = null, dragTo = null;
    let rafPending = false;

    const trackEl = el('div', { class: 'track' });
    const rangeEl = el('div', { class: 'range' });
    const knobFromEl = el('div', { class: 'knob from' });
    const knobToEl = el('div', { class: 'knob to' });
    const tipFromEl = el('div', { class: 'knob-tooltip from', text: String(yrFrom) });
    const tipToEl = el('div', { class: 'knob-tooltip to', text: String(yrTo) });

    function applyVisual(from, to) {
      const pctFrom = ((from - minYear) / range) * 100;
      const pctTo   = ((to   - minYear) / range) * 100;
      rangeEl.style.left = pctFrom + '%';
      rangeEl.style.right = (100 - pctTo) + '%';
      knobFromEl.style.left = pctFrom + '%';
      knobToEl.style.left = pctTo + '%';
      tipFromEl.style.left = pctFrom + '%';
      tipToEl.style.left = pctTo + '%';
      tipFromEl.textContent = String(from);
      tipToEl.textContent = String(to);
    }

    function scheduleVisual() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        applyVisual(
          dragFrom != null ? dragFrom : state.filters.yearRange[0],
          dragTo   != null ? dragTo   : state.filters.yearRange[1],
        );
      });
    }

    const inputFromEl = el('input', {
      type: 'range', min: String(minYear), max: String(maxYear), value: String(yrFrom),
      class: 'from',
    });
    const inputToEl = el('input', {
      type: 'range', min: String(minYear), max: String(maxYear), value: String(yrTo),
      class: 'to',
    });

    function onFromInput() {
      const cur = state.filters.yearRange;
      const ceiling = dragTo != null ? dragTo : cur[1];
      const v = Math.min(+inputFromEl.value, ceiling);
      dragFrom = v;
      if (dragTo == null) dragTo = cur[1];
      sliderEl.classList.add('dragging');
      scheduleVisual();
    }
    function onToInput() {
      const cur = state.filters.yearRange;
      const floor = dragFrom != null ? dragFrom : cur[0];
      const v = Math.max(+inputToEl.value, floor);
      dragTo = v;
      if (dragFrom == null) dragFrom = cur[0];
      sliderEl.classList.add('dragging');
      scheduleVisual();
    }
    function commit() {
      sliderEl.classList.remove('dragging');
      if (dragFrom == null && dragTo == null) return;
      const cur = state.filters.yearRange;
      const newRange = [
        dragFrom != null ? dragFrom : cur[0],
        dragTo   != null ? dragTo   : cur[1],
      ];
      dragFrom = null; dragTo = null;
      if (newRange[0] !== cur[0] || newRange[1] !== cur[1]) {
        setFilters({ yearRange: newRange });
      }
    }

    inputFromEl.addEventListener('input', onFromInput);
    inputToEl.addEventListener('input', onToInput);
    inputFromEl.addEventListener('change', commit);
    inputToEl.addEventListener('change', commit);
    // Pointerup safety net: some browsers don't reliably fire change for sliders
    inputFromEl.addEventListener('pointerup', commit);
    inputToEl.addEventListener('pointerup', commit);
    // Keyboard: nudge on focused thumb commits immediately
    inputFromEl.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) requestAnimationFrame(commit);
    });
    inputToEl.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) requestAnimationFrame(commit);
    });

    const sliderEl = el('div', { class: 'year-slider' }, [
      trackEl, rangeEl, inputFromEl, inputToEl,
      knobFromEl, knobToEl, tipFromEl, tipToEl,
    ]);

    applyVisual(yrFrom, yrTo);
    return sliderEl;
  }

  function mountFilterRail(root) {
    const counts = { programs: {}, cats: {}, roks: {} };
    DATA.rows.forEach(r => {
      if (r.program) counts.programs[r.program] = (counts.programs[r.program] || 0) + 1;
      if (r.cat_type) counts.cats[r.cat_type] = (counts.cats[r.cat_type] || 0) + 1;
      if (r.rok) counts.roks[r.rok] = (counts.roks[r.rok] || 0) + 1;
    });

    const minYear = DATA.facets.years[0];
    const maxYear = DATA.facets.years[DATA.facets.years.length - 1];
    if (!state.filters.yearRange) state.filters.yearRange = [minYear, maxYear];

    function chipList(items, kind, labelKey) {
      return items.map(k => el('button', {
        class: 'chip' + (state.filters[kind].has(k) ? ' active' : ''),
        onclick: () => {
          const cur = new Set(state.filters[kind]);
          cur.has(k) ? cur.delete(k) : cur.add(k);
          setFilters({ [kind]: cur });
        },
      }, [
        el('span', { text: labelKey ? t(labelKey + '.' + k, state.lang) : k }),
        el('span', { class: 'count', text: String(counts[kind][k] || 0) }),
      ]));
    }

    function render() {
      const lang = state.lang;
      const [yrFrom, yrTo] = state.filters.yearRange;

      const yearSlider = buildYearSlider(minYear, maxYear);

      const unfundedBlock = el('button', { class: 'unfunded-link', onclick: () => setShowUnfunded(true) }, [
        el('span', { class: 'label' }, [
          fa('fa-solid fa-circle-exclamation', 'icon-left'),
          t('facet.unfunded.label', lang),
        ]),
        el('span', { class: 'sub' }, [
          DATA.counts.unfunded_mention_count + ' · ',
          el('span', { text: t('facet.unfunded.sub', lang) }),
        ]),
      ]);

      root.replaceChildren(
        // Year
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.year', lang) }),
          ]),
          el('div', { class: 'endpoints' }, [
            el('span', { class: 'mono', text: String(yrFrom) }),
            el('span', { class: 'mono', text: String(yrTo) }),
          ]),
          yearSlider,
        ]),
        // Programme
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.program', lang) }),
            el('span', { class: 'count', text: state.filters.programs.size || t('facet.all', lang) }),
          ]),
          el('div', { class: 'facet-list' },
            chipList(PROGRAM_ORDER.filter(p => counts.programs[p]), 'programs', 'prog')),
        ]),
        // Category
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.cat', lang) }),
            el('span', { class: 'count', text: state.filters.cats.size || t('facet.all', lang) }),
          ]),
          el('div', { class: 'facet-list' },
            chipList(CAT_ORDER.filter(c => counts.cats[c]), 'cats', 'cat')),
        ]),
        // Round
        DATA.facets.roks.length > 0 && el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.rok', lang) }),
            el('span', { class: 'count', text: state.filters.roks.size || t('facet.all', lang) }),
          ]),
          el('div', { class: 'facet-list' },
            chipList(DATA.facets.roks.slice().sort(), 'roks', null)),
        ]),
        // Currency
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.currency', lang) }),
          ]),
          el('div', { class: 'normalize-toggle' }, [
            el('button', {
              class: 'btn mono' + (!state.filters.normalize ? ' active' : ''),
              text: t('facet.original', lang),
              onclick: () => setFilters({ normalize: false }),
            }),
            el('button', {
              class: 'btn mono' + (state.filters.normalize ? ' active' : ''),
              text: t('facet.normalize', lang),
              onclick: () => setFilters({ normalize: true }),
            }),
          ]),
          el('span', { class: 'note', text: `1 € = ${DATA.hrk_to_eur} kn (fixed, ECB)` }),
        ]),
        // Footer
        el('div', { class: 'rail-footer' }, [
          el('div', { class: 'btn-row' }, [
            el('button', {
              class: 'btn mono',
              onclick: () => {
                clearScopes();
                setFilters({
                  yearRange: [minYear, maxYear],
                  programs: new Set(), cats: new Set(), roks: new Set(),
                  q: '',
                });
              },
            }, [
              fa('fa-solid fa-rotate-left', 'icon-left'),
              t('facet.reset', lang),
            ]),
            el('button', {
              class: 'btn mono',
              onclick: () => {
                persistToHash();
                navigator.clipboard.writeText(location.href);
              },
            }, [
              fa('fa-solid fa-link', 'icon-left'),
              t('facet.copy', lang),
            ]),
          ]),
          unfundedBlock,
        ]),
      );
    }
    on(['filters', 'lang'], render);
    render();
  }

  // ═══ Filter / derive helpers ════════════════════════════════════════
  function rowInScope(i, scopes) {
    const r = DATA.rows[i];
    for (const s of scopes) {
      switch (s.kind) {
        case 'producer':  if (r.producer  !== s.value) return false; break;
        case 'director':  if (r.director  !== s.value) return false; break;
        case 'writer':    if (r.writer    !== s.value) return false; break;
        case 'year':      if (r.year      !== s.value) return false; break;
        case 'program':   if (r.program   !== s.value) return false; break;
        case 'cat':       if (r.cat_type  !== s.value) return false; break;
        case 'rok':       if (r.rok       !== s.value) return false; break;
        case 'sizeBand': {
          const a = r.amount_eur || 0;
          if (a < s.value[0] || a >= s.value[1]) return false;
          break;
        }
        case 'project':   if (rowNormTitles[i] !== s.value) return false; break;
      }
    }
    return true;
  }

  function applyFilters() {
    const f = state.filters;
    const yr = f.yearRange;
    const sy = f.selectedYear;
    const programs = f.programs, cats = f.cats, roks = f.roks;
    const searched = f.q.trim() ? searchRowIds(f.q.trim()) : null;
    const scopes = state.scopes;

    const out = [];
    for (let i = 0; i < DATA.rows.length; i++) {
      const r = DATA.rows[i];
      if (yr && r.year && (r.year < yr[0] || r.year > yr[1])) continue;
      if (sy != null && r.year !== sy) continue;
      if (programs.size && !programs.has(r.program)) continue;
      if (cats.size && !cats.has(r.cat_type)) continue;
      if (roks.size && !roks.has(r.rok)) continue;
      if (searched && !searched.has(i)) continue;
      if (scopes.length && !rowInScope(i, scopes)) continue;
      out.push(i);
    }
    return out;
  }

  // Filter as `applyFilters` would, but also exclude rows that would land in the
  // unattributed bucket of the active people-pivot, when the hide-unattributed
  // toggle is on. Keeps the insights metrics in sync with what the table shows.
  function applyFiltersAndPivotView() {
    const ids = applyFilters();
    if (!state.hideUnattributed) return ids;
    if (!PIVOTS_WITH_UNATTRIBUTED.has(state.groupBy)) return ids;
    const field = state.groupBy; // 'producer' | 'director' | 'writer'
    const out = [];
    for (const i of ids) {
      const v = DATA.rows[i][field];
      if (v != null && String(v).trim() !== '') out.push(i);
    }
    return out;
  }

  function aggregateBy(rowIds, dim) {
    const map = new Map();
    for (const i of rowIds) {
      const r = DATA.rows[i];
      let key, value, isUnattributed;
      if (dim === 'producer')      { value = r.producer  || null; key = value || UNATTRIBUTED_KEY; isUnattributed = !value; }
      else if (dim === 'director') { value = r.director  || null; key = value || UNATTRIBUTED_KEY; isUnattributed = !value; }
      else if (dim === 'writer')   { value = r.writer    || null; key = value || UNATTRIBUTED_KEY; isUnattributed = !value; }
      else if (dim === 'program')  { value = r.program  || 'other'; key = value; isUnattributed = false; }
      else if (dim === 'cat')      { value = r.cat_type || 'other'; key = value; isUnattributed = false; }
      else { value = null; key = UNATTRIBUTED_KEY; isUnattributed = true; }

      let g = map.get(key);
      if (!g) {
        g = { key, value, label: value == null ? null : String(value),
              isUnattributed, ids: [], total: 0, n: 0, avg: 0, years: new Set() };
        map.set(key, g);
      }
      g.ids.push(i);
      if (r.amount_eur) g.total += r.amount_eur;
      g.n++;
      if (r.year) g.years.add(r.year);
    }
    const groups = [...map.values()];
    for (const g of groups) {
      g.avg = g.n > 0 ? g.total / g.n : 0;
    }
    return groups;
  }

  function aggregateProjects(rowIds) {
    // Returns sorted-by-total list of project rollups across the filtered rowIds.
    const map = new Map();
    for (const i of rowIds) {
      const key = rowNormTitles[i] || UNATTRIBUTED_KEY;
      let p = map.get(key);
      if (!p) p = { key, rows: [], total: 0, yearMin: null, yearMax: null,
                    title: DATA.rows[i].title || '(no title)',
                    programs: new Set(), cats: new Set(),
                    producers: new Set(), directors: new Set() };
      p.rows.push(i);
      const r = DATA.rows[i];
      if (r.amount_eur) p.total += r.amount_eur;
      if (r.year != null) {
        if (p.yearMin == null || r.year < p.yearMin) p.yearMin = r.year;
        if (p.yearMax == null || r.year > p.yearMax) p.yearMax = r.year;
      }
      if (r.program) p.programs.add(r.program);
      if (r.cat_type) p.cats.add(r.cat_type);
      if (r.producer) p.producers.add(r.producer);
      if (r.director) p.directors.add(r.director);
      map.set(key, p);
    }
    const out = [...map.values()];
    return out;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // ═══ 8. Orientation headline ════════════════════════════════════════
  function mountHeadline(root) {
    function render() {
      const lang = state.lang;
      const maxYear = DATA.facets.years[DATA.facets.years.length - 1];
      root.replaceChildren(
        el('div', { class: 'head-line' }, [
          el('span', { class: 'head-main', text: t('header.line', lang, { maxYear }) }),
        ]),
        el('aside', { class: 'head-infopill', role: 'note' }, [
          fa('fa-solid fa-circle-info', 'icon-left'),
          el('span', { class: 'head-infopill-kicker kicker', text: t('header.notice.kicker', lang) }),
          el('span', { class: 'head-infopill-body', text: t('header.notice.body', lang) }),
        ]),
        el('div', { class: 'head-stats mono' }, [
          el('span', {}, [
            fa('fa-solid fa-list-check', 'icon-left'),
            t('header.decisions', lang, { n: DATA.counts.rows.toLocaleString() }),
          ]),
          el('span', { class: 'sep', text: '·' }),
          el('span', {}, [
            fa('fa-solid fa-coins', 'icon-left'),
            t('header.funded', lang, { amt: formatAmount(DATA.counts.total_amount_eur, 'EUR', lang) }),
          ]),
          el('span', { class: 'sep', text: '·' }),
          el('span', {}, [
            fa('fa-regular fa-folder-open', 'icon-left'),
            t('header.calls', lang, { n: DATA.counts.docs_results_tables }),
          ]),
          el('span', { class: 'sep', text: '·' }),
          el('span', {}, [
            fa('fa-solid fa-triangle-exclamation', 'icon-left'),
            t('header.unfunded', lang, { n: DATA.counts.unfunded_mention_count }),
          ]),
        ]),
      );
    }
    on(['lang'], render);
    render();
  }

  // ═══ 9. Insights strip ══════════════════════════════════════════════
  function mountInsights(root) {
    function render() {
      const lang = state.lang;
      const ids = applyFiltersAndPivotView();
      const amounts = ids.map(i => DATA.rows[i].amount_eur || 0).filter(a => a > 0);
      const total = amounts.reduce((s, x) => s + x, 0);
      const med = median(amounts);

      // Year trend
      const byYear = new Map();
      const countsByYear = new Map();
      for (const i of ids) {
        const r = DATA.rows[i];
        if (!r.year) continue;
        byYear.set(r.year, (byYear.get(r.year) || 0) + (r.amount_eur || 0));
        countsByYear.set(r.year, (countsByYear.get(r.year) || 0) + 1);
      }
      const years = [...byYear.keys()].sort((a, b) => a - b);
      const yearVals = years.map(y => byYear.get(y));
      const yearTooltips = years.map(y =>
        `${y} · ${formatCompact(byYear.get(y), lang)} · ${countsByYear.get(y)} ${t('metric.count', lang)}`);

      // Histogram
      const buckets = SIZE_BUCKETS;
      const histVals = new Array(buckets.length - 1).fill(0);
      for (const a of amounts) {
        for (let i = 0; i < buckets.length - 1; i++) {
          if (a >= buckets[i] && a < buckets[i + 1]) { histVals[i]++; break; }
        }
      }
      const histTooltips = buckets.slice(0, -1).map((b, i) =>
        `${bandLabel(buckets[i], buckets[i + 1])} · ${histVals[i]} ${t('metric.count', lang)}`);

      root.replaceChildren(
        el('div', { class: 'metric' }, [
          el('span', { class: 'label', text: t('metric.total', lang) }),
          el('span', { class: 'value', text: formatAmount(total, 'EUR', lang) }),
          el('span', { class: 'sub', text: `${ids.length.toLocaleString()} ${t('status.rows', lang)}` }),
        ]),
        el('div', { class: 'metric' }, [
          el('span', { class: 'label', text: t('metric.median', lang) }),
          el('span', { class: 'value', text: formatAmount(med, 'EUR', lang) }),
          el('span', { class: 'sub', text: `${amounts.length.toLocaleString()} ${t('metric.count', lang)}` }),
        ]),
        el('div', { class: 'metric chart clickable' }, [
          el('span', { class: 'label', text: t('metric.yearTrend', lang) }),
          barsChart(yearVals, yearTooltips, {
            onclick: (i) => {
              const y = years[i];
              addScope({ kind: 'year', value: y, label: String(y) });
            },
          }),
          el('div', { class: 'bars-labels' }, [
            el('span', { text: years[0] != null ? String(years[0]) : '' }),
            el('span', { text: years.length ? String(years[years.length - 1]) : '' }),
          ]),
        ]),
        el('div', { class: 'metric chart clickable' }, [
          el('span', { class: 'label', text: t('metric.distrib', lang) }),
          barsChart(histVals, histTooltips, {
            onclick: (i) => {
              const lo = buckets[i], hi = buckets[i + 1];
              addScope({ kind: 'sizeBand', value: [lo, hi], label: bandLabel(lo, hi) });
            },
          }),
          el('div', { class: 'bars-labels' }, [
            el('span', { text: '€0' }),
            el('span', { text: '€1M+' }),
          ]),
        ]),
      );
    }
    on(['filters', 'scopes', 'lang', 'hideUnattributed', 'groupBy'], render);
    render();
  }

  // ═══ 10. Scope-chip row ═════════════════════════════════════════════
  function mountScopeRow(root) {
    function chipLabel(s, lang) {
      const kindLabel = t('scope.kind.' + s.kind, lang);
      let val;
      if (s.kind === 'program') val = t('prog.' + s.value, lang);
      else if (s.kind === 'cat') val = t('cat.' + s.value, lang);
      else if (s.kind === 'project') val = s.label || s.value;
      else if (s.kind === 'sizeBand') val = s.label || bandLabel(s.value[0], s.value[1]);
      else val = s.label != null ? s.label : String(s.value);
      return [kindLabel, val];
    }

    function render() {
      const lang = state.lang;
      if (state.scopes.length === 0) {
        root.replaceChildren(
          el('span', { class: 'scope-kicker kicker', text: t('scope.label', lang) }),
          el('span', { class: 'scope-empty', text: t('scope.empty', lang) }),
        );
        root.classList.add('empty');
        return;
      }
      root.classList.remove('empty');
      const chips = state.scopes.map((s, idx) => {
        const [k, v] = chipLabel(s, lang);
        return el('button', {
          class: 'scope-chip',
          title: t('scope.label', lang),
          onclick: () => removeScope(idx),
        }, [
          el('span', { class: 'k mono', text: k }),
          el('span', { class: 'eq', text: '=' }),
          el('span', { class: 'v', text: v }),
          el('span', { class: 'x' }, [fa('fa-solid fa-xmark')]),
        ]);
      });
      root.replaceChildren(
        el('span', { class: 'scope-kicker kicker', text: t('scope.label', lang) }),
        ...chips,
        el('button', {
          class: 'btn mono scope-clear',
          text: t('scope.clearAll', lang),
          onclick: clearScopes,
        }),
      );
    }
    on(['scopes', 'lang'], render);
    render();
  }

  // ═══ 11. Pivot chips ════════════════════════════════════════════════
  const PIVOTS = ['projects', 'decisions', 'producer', 'director', 'writer', 'program', 'cat'];
  const PIVOTS_WITH_UNATTRIBUTED = new Set(['producer', 'director', 'writer']);

  function mountPivot(root) {
    function render() {
      const lang = state.lang;
      const showUnattributedToggle = PIVOTS_WITH_UNATTRIBUTED.has(state.groupBy);

      const left = el('div', { class: 'pivot-left' }, [
        el('span', { class: 'kicker', text: t('pivot.label', lang) }),
        ...PIVOTS.map(p => el('button', {
          class: 'btn mono' + (state.groupBy === p ? ' active' : ''),
          text: t('pivot.' + p, lang),
          onclick: () => setGroupBy(p),
        })),
      ]);

      const right = el('div', { class: 'pivot-right' });
      if (showUnattributedToggle) {
        right.appendChild(el('button', {
          class: 'btn mono unattributed-toggle' + (state.hideUnattributed ? ' active' : ''),
          text: t('pivot.hideUnattributed', lang),
          onclick: () => setHideUnattributed(!state.hideUnattributed),
        }));
        if (state.hideUnattributed) {
          const field = state.groupBy; // 'producer' | 'director' | 'writer'
          const baseIds = applyFilters();
          let hiddenCount = 0;
          for (const i of baseIds) {
            const v = DATA.rows[i][field];
            if (v == null || String(v).trim() === '') hiddenCount++;
          }
          if (hiddenCount > 0) {
            right.appendChild(el('span', {
              class: 'kicker unattributed-caption',
              text: hiddenCount.toLocaleString() + ' ' + t('pivot.hiddenSuffix', lang),
            }));
          }
        }
      }

      root.replaceChildren(left, right);
    }
    on(['groupBy', 'lang', 'hideUnattributed', 'filters', 'scopes'], render);
    render();
  }

  // ─── Sort comparators ───────────────────────────────────────────────
  function localeStr(a, b, lang) {
    return String(a || '').localeCompare(String(b || ''), lang, { sensitivity: 'base', numeric: true });
  }
  function withDir(cmp, dir) { return dir === 'desc' ? (a, b) => -cmp(a, b) : cmp; }

  function decisionsComparator(sort, lang) {
    const dir = sort.dir;
    switch (sort.key) {
      case 'year':   return withDir((a, b) => (DATA.rows[a].year || 0) - (DATA.rows[b].year || 0), dir);
      case 'amount': return withDir((a, b) => (DATA.rows[a].amount_eur || 0) - (DATA.rows[b].amount_eur || 0), dir);
      case 'title':
      default:       return withDir((a, b) => localeStr(DATA.rows[a].title, DATA.rows[b].title, lang), dir);
    }
  }
  function projectsComparator(sort, lang) {
    const dir = sort.dir;
    switch (sort.key) {
      case 'years':  return withDir((a, b) => (a.yearMin || 0) - (b.yearMin || 0), dir);
      case 'amount': return withDir((a, b) => (a.total || 0) - (b.total || 0), dir);
      case 'title':
      default:       return withDir((a, b) => localeStr(a.title, b.title, lang), dir);
    }
  }
  function groupComparator(sort, lang, dim) {
    const dir = sort.dir;
    const labelOf = (g) => {
      if (g.isUnattributed) return '';
      if (dim === 'program') return t('prog.' + g.key, lang);
      if (dim === 'cat')     return t('cat.' + g.key, lang);
      return g.label || '';
    };
    const minYearOf = (g) => {
      if (!g.years || g.years.size === 0) return Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      g.years.forEach(y => { if (y < minY) minY = y; });
      return minY;
    };
    switch (sort.key) {
      case 'total': return withDir((a, b) => (a.total || 0) - (b.total || 0), dir);
      case 'avg':   return withDir((a, b) => (a.avg || 0) - (b.avg || 0), dir);
      case 'count': return withDir((a, b) => a.n - b.n, dir);
      case 'range': return withDir((a, b) => minYearOf(a) - minYearOf(b), dir);
      case 'name':
      default:      return withDir((a, b) => localeStr(labelOf(a), labelOf(b), lang), dir);
    }
  }
  // Unattributed always sinks to the bottom regardless of sort key/dir.
  function withUnattributedLast(cmp) {
    return (a, b) => {
      if (a.isUnattributed !== b.isUnattributed) return a.isUnattributed ? 1 : -1;
      return cmp(a, b);
    };
  }

  // ═══ 12. Virtualized list ═══════════════════════════════════════════
  function mountList(root) {
    const DECISION_ROW_H = 44;
    const PROJECT_ROW_H = 48;
    const GROUP_ROW_H   = 56;
    const BUFFER = 6;

    let filteredIds = [];
    let projectsAgg = null;    // when groupBy === 'projects'
    let groups = null;         // when groupBy is a non-project group
    let totalHeight = 0;
    let expandedHeight = 0;
    let expandedIdxInList = -1;
    let baseRowH = DECISION_ROW_H;

    const scrollEl = el('div', { class: 'list' });
    const spacer   = el('div', { class: 'list-spacer' });
    scrollEl.appendChild(spacer);

    const headerEl = el('div', { class: 'list-header-wrap' });
    let statusbar;

    function headerCell(label, key, extraClass) {
      const isActive = state.sort.key === key;
      const arrow = isActive ? (state.sort.dir === 'asc' ? '↑' : '↓') : '';
      return el('button', {
        class: 'col header-cell' + (extraClass ? ' ' + extraClass : '') + (isActive ? ' is-active' : ''),
        type: 'button',
        onclick: () => toggleSort(key),
      }, [
        el('span', { class: 'header-label', text: label }),
        el('span', { class: 'sort-arrow', text: arrow }),
      ]);
    }
    function renderHeaderRow(lang) {
      const gb = state.groupBy;
      if (gb === 'projects') {
        return el('div', { class: 'list-header row-grid' }, [
          el('div', { class: 'col n' }),
          headerCell(t('col.title', lang),    'title',  'title'),
          el('div', { class: 'col recipient header-static', text: t('col.producer', lang) }),
          headerCell(t('col.range', lang),    'years',  'year'),
          headerCell(t('col.amount', lang),   'amount', 'amount'),
        ]);
      }
      if (gb === 'decisions') {
        return el('div', { class: 'list-header row-grid' }, [
          el('div', { class: 'col n' }),
          headerCell(t('col.title', lang),     'title',  'title'),
          el('div', { class: 'col recipient header-static', text: t('col.recipient', lang) }),
          headerCell(t('col.year', lang),      'year',   'year'),
          headerCell(t('col.amount', lang),    'amount', 'amount'),
        ]);
      }
      return el('div', { class: 'list-header group-grid' }, [
        el('div', { class: 'col n' }),
        headerCell(t('col.name', lang),       'name',  'title'),
        headerCell(t('col.total', lang),      'total', 'subtotal'),
        headerCell(t('col.avg', lang),        'avg',   'avg'),
        headerCell(t('col.decisions', lang),  'count', 'count'),
        headerCell(t('col.range', lang),      'range', 'count'),
      ]);
    }
    function paintHeader() {
      headerEl.replaceChildren(renderHeaderRow(state.lang));
    }

    function openPdfPreview(doc, fallbackTitle) {
      if (!doc || !doc.source_url) return;
      setPdfPreview({
        title: doc.natjecaj_title || fallbackTitle || doc.filename || 'PDF',
        source_url: doc.source_url,
      });
    }

    function recomputeData() {
      filteredIds = applyFilters();
      projectsAgg = null;
      groups = null;
      expandedIdxInList = -1;

      if (state.groupBy === 'projects') {
        projectsAgg = aggregateProjects(filteredIds);
        if (state.hideUnattributed) {
          projectsAgg = projectsAgg.filter(p => p.key !== UNATTRIBUTED_KEY);
        }
        projectsAgg.sort(projectsComparator(state.sort, state.lang));
        baseRowH = PROJECT_ROW_H;
        totalHeight = projectsAgg.length * baseRowH;

        if (state.expandedKey) {
          expandedIdxInList = projectsAgg.findIndex(p => p.key === state.expandedKey);
          if (expandedIdxInList < 0) state.expandedKey = null;
        }
      } else if (state.groupBy === 'decisions') {
        filteredIds.sort(decisionsComparator(state.sort, state.lang));
        baseRowH = DECISION_ROW_H;
        totalHeight = filteredIds.length * baseRowH;

        if (state.expandedKey) {
          // Find first row in the filtered list whose normTitle matches
          expandedIdxInList = filteredIds.findIndex(i => rowNormTitles[i] === state.expandedKey);
          if (expandedIdxInList < 0) state.expandedKey = null;
        }
      } else {
        groups = aggregateBy(filteredIds, state.groupBy);
        if (state.hideUnattributed && PIVOTS_WITH_UNATTRIBUTED.has(state.groupBy)) {
          groups = groups.filter(g => !g.isUnattributed);
        }
        groups.sort(withUnattributedLast(groupComparator(state.sort, state.lang, state.groupBy)));
        baseRowH = GROUP_ROW_H;
        totalHeight = groups.length * baseRowH;
        // Group rows can't expand here; clear any leftover expansion state
        if (state.expandedKey) state.expandedKey = null;
      }

      if (expandedIdxInList < 0) expandedHeight = 0;
      paintHeader();
      paint();
    }

    function paint() {
      const lang = state.lang;
      const normalize = state.filters.normalize;

      if (filteredIds.length === 0) {
        spacer.replaceChildren(el('div', { class: 'list-empty', text: t('status.empty', lang) }));
        spacer.style.height = '200px';
        updateStatus();
        return;
      }

      const visibleH = scrollEl.clientHeight || 600;
      const scrollTop = scrollEl.scrollTop;

      let virtualHeight = totalHeight;
      if (expandedIdxInList >= 0) {
        if (expandedHeight === 0) expandedHeight = 420;  // estimate
        virtualHeight = totalHeight + expandedHeight;
      }

      spacer.style.height = virtualHeight + 'px';
      spacer.replaceChildren();

      const itemCount = projectsAgg ? projectsAgg.length
                      : groups      ? groups.length
                                    : filteredIds.length;
      const startIdx = Math.max(0, Math.floor(scrollTop / baseRowH) - BUFFER);
      const endIdx = Math.min(itemCount, Math.ceil((scrollTop + visibleH) / baseRowH) + BUFFER);

      for (let idx = startIdx; idx < endIdx; idx++) {
        let top = idx * baseRowH;
        if (expandedIdxInList >= 0 && idx > expandedIdxInList) top += expandedHeight;

        let node;
        if (projectsAgg)      node = renderProjectAggRow(projectsAgg[idx], top, lang, normalize);
        else if (groups)      node = renderGroupRow(groups[idx], top, lang);
        else                  node = renderDecisionRow(filteredIds[idx], top, lang, normalize);
        spacer.appendChild(node);
      }

      // Project profile expansion
      if (expandedIdxInList >= 0 && state.expandedKey) {
        const project = projectIndex.get(state.expandedKey);
        if (project) {
          const detailTop = (expandedIdxInList + 1) * baseRowH;
          const detailNode = renderProjectProfile(project, lang, normalize);
          detailNode.style.top = detailTop + 'px';
          detailNode.style.position = 'absolute';
          spacer.appendChild(detailNode);
          requestAnimationFrame(() => {
            const h = detailNode.offsetHeight;
            if (h && Math.abs(h - expandedHeight) > 4) {
              expandedHeight = h;
              paint();
            }
          });
        }
      }

      updateStatus();
    }

    function renderDecisionRow(rowI, top, lang, normalize) {
      const r = DATA.rows[rowI];
      const key = rowNormTitles[rowI];
      const events = projectEventsFor(key);
      const hasEvents = events && events.length > 0;
      const expanded = state.expandedKey === key;

      const doc = docById.get(r.doc);

      return el('div', {
        class: 'row' + (expanded ? ' expanded' : ''),
        style: `top:${top}px; height:${DECISION_ROW_H}px`,
        onclick: () => setExpandedKey(key),
      }, [
        el('div', { class: 'col n', text: doc ? (r.n + ' · ' + doc.id) : String(r.n) }),
        el('div', { class: 'col title' }, [
          el('span', { text: r.title || '—' }),
          hasEvents && el('span', { class: 'events-pip', title: `${events.length} event(s)` }),
          el('span', { class: 'meta', text:
            (r.program ? t('prog.' + r.program, lang) : '') +
            (r.cat_type && r.cat_type !== 'other' ? ' · ' + t('cat.' + r.cat_type, lang) : '') +
            (r.section ? ' · ' + r.section : '')
          }),
        ]),
        el('div', { class: 'col recipient', text: r.producer || r.applicant || '—' }),
        el('div', { class: 'col year', text: r.year != null ? String(r.year) : '—' }),
        el('div', { class: 'col amount' }, [
          el('span', { text: formatAmount(
            normalize ? r.amount_eur : r.amount,
            normalize ? 'EUR' : (r.currency || 'EUR'),
            lang
          ) }),
          r.currency === 'HRK' && normalize && el('span', { class: 'alt', text:
            formatAmount(r.amount, 'HRK', lang) + ' (orig.)' }),
        ]),
      ]);
    }

    function renderProjectAggRow(p, top, lang, normalize) {
      const expanded = state.expandedKey === p.key;
      const yearRange = p.yearMin == null ? '—'
        : p.yearMin === p.yearMax ? String(p.yearMin)
        : `${p.yearMin}–${p.yearMax}`;
      const progLabels = [...p.programs].slice(0, 3).map(k => t('prog.' + k, lang)).join(' · ');
      const moreCount = p.programs.size > 3 ? ' +' + (p.programs.size - 3) : '';
      const titleText = p.key === UNATTRIBUTED_KEY ? t('col.unattributed', lang) : p.title;
      return el('div', {
        class: 'row project-row' + (expanded ? ' expanded' : ''),
        style: `top:${top}px; height:${PROJECT_ROW_H}px`,
        onclick: () => setExpandedKey(p.key),
      }, [
        el('div', { class: 'col n mono', text: p.rows.length + '×' }),
        el('div', { class: 'col title' }, [
          el('span', { text: titleText }),
          el('span', { class: 'meta', text: progLabels + moreCount }),
        ]),
        el('div', { class: 'col recipient', text: [...p.producers].slice(0, 2).join(' · ') || '—' }),
        el('div', { class: 'col year mono', text: yearRange }),
        el('div', { class: 'col amount mono', text: formatAmount(p.total, 'EUR', lang) }),
      ]);
    }

    function renderGroupRow(g, top, lang) {
      let label;
      if (g.isUnattributed) {
        // Use pivot-specific label when the active pivot is one of producer/director/writer.
        const specific = 'col.unattributed.' + state.groupBy;
        label = T[specific] ? t(specific, lang) : t('col.unattributed', lang);
      }
      else if (state.groupBy === 'program') label = t('prog.' + g.key, lang);
      else if (state.groupBy === 'cat') label = t('cat.' + g.key, lang);
      else label = g.label;

      const yearList = [...g.years].sort();
      const yearRange = yearList.length === 0 ? '—'
        : yearList.length === 1 ? String(yearList[0])
        : `${yearList[0]}–${yearList[yearList.length - 1]}`;

      const dim = state.groupBy;
      const value = g.isUnattributed ? null : g.value;

      const clickHandler = () => {
        if (g.isUnattributed || value == null) return;
        addScope({
          kind: dim, value,
          label: dim === 'program' ? t('prog.' + value, lang)
               : dim === 'cat'     ? t('cat.' + value, lang)
                                   : String(value),
        }, { switchToProjects: true });
      };

      return el('div', {
        class: 'group' + (g.isUnattributed ? ' unattributed' : ' clickable'),
        style: `top:${top}px; height:${GROUP_ROW_H}px`,
        onclick: clickHandler,
        title: g.isUnattributed ? '' : t('profile.scope_short', lang),
      }, [
        el('div', { class: 'col n', text: '' }),
        el('div', { class: 'col title', text: label || '—' }),
        el('div', { class: 'col subtotal mono', text: formatAmount(g.total, 'EUR', lang) }),
        el('div', { class: 'col avg mono', text: g.n > 0 ? formatAmount(Math.round(g.avg), 'EUR', lang) : '—' }),
        el('div', { class: 'col count mono', text: `${g.n}` }),
        el('div', { class: 'col count mono', text: yearRange }),
      ]);
    }

    // ─── Project profile ────────────────────────────────────────────────
    function renderFundingTimeline(roundsByYear, minY, maxY, lang) {
      const span = Math.max(1, maxY - minY);
      const dots = [];
      // Find max amount per round so dot radius scales nicely
      let maxAmt = 1;
      for (const list of roundsByYear.values()) {
        for (const r of list) maxAmt = Math.max(maxAmt, r.amount_eur || 0);
      }
      for (const [y, list] of roundsByYear) {
        list.forEach((r, k) => {
          const pct = ((y - minY) / span) * 100;
          const radius = 4 + Math.sqrt(((r.amount_eur || 0) / maxAmt)) * 10;
          const offset = (k - (list.length - 1) / 2) * (radius * 1.8 + 2);
          dots.push(el('div', {
            class: 'timeline-dot',
            style: `left:${pct}%; width:${radius * 2}px; height:${radius * 2}px; transform:translate(calc(-50% + ${offset}px), -50%);`,
            title: `${y} · ${t('prog.' + (r.program || 'other'), lang)} · ${formatAmount(r.amount_eur, 'EUR', lang)}`,
          }));
        });
      }
      // Year tick labels (just start / midpoint / end)
      const ticks = [];
      if (maxY - minY <= 8) {
        for (let y = minY; y <= maxY; y++) {
          const pct = ((y - minY) / span) * 100;
          ticks.push(el('div', { class: 'timeline-tick', style: `left:${pct}%;`, text: String(y) }));
        }
      } else {
        const mid = Math.round((minY + maxY) / 2);
        for (const y of [minY, mid, maxY]) {
          const pct = ((y - minY) / span) * 100;
          ticks.push(el('div', { class: 'timeline-tick', style: `left:${pct}%;`, text: String(y) }));
        }
      }
      return el('div', { class: 'funding-timeline' }, [
        el('div', { class: 'timeline-track' }),
        ...dots,
        el('div', { class: 'timeline-ticks' }, ticks),
      ]);
    }

    function renderProjectProfile(project, lang, normalize) {
      const rowsSorted = project.rows
        .map(i => ({ idx: i, ...DATA.rows[i] }))
        .sort((a, b) => (a.year || 0) - (b.year || 0) || (a.n || 0) - (b.n || 0));

      // Group by year for timeline
      const roundsByYear = new Map();
      for (const r of rowsSorted) {
        if (r.year == null) continue;
        const list = roundsByYear.get(r.year) || [];
        list.push(r);
        roundsByYear.set(r.year, list);
      }
      const minY = project.yearMin ?? rowsSorted[0]?.year ?? null;
      const maxY = project.yearMax ?? rowsSorted[rowsSorted.length - 1]?.year ?? null;

      // People deduped
      const peopleRows = [];
      const peopleConfig = [
        ['col.director',  project.people.directors],
        ['col.producer',  project.people.producers],
        ['col.writer',    project.people.writers],
        ['col.applicant', project.people.applicants],
      ];
      for (const [labelKey, set] of peopleConfig) {
        if (set.size === 0) continue;
        peopleRows.push(el('span', { class: 'k', text: t(labelKey, lang) }));
        peopleRows.push(el('span', { class: 'v', text: [...set].join(' · ') }));
      }

      const titleText = project.key === UNATTRIBUTED_KEY ? t('col.unattributed', lang) : (project.title || '—');

      const hero = el('div', { class: 'pf-hero' }, [
        el('h3', { class: 'pf-title', text: titleText }),
        el('div', { class: 'pf-meta mono' }, [
          el('span', { class: 'big', text: formatAmount(project.total_eur, 'EUR', lang) }),
          el('span', { class: 'sub', text: t('profile.total', lang) }),
          el('span', { class: 'sep', text: '·' }),
          el('span', { text: t('profile.rounds', lang, { n: rowsSorted.length }) }),
          minY != null && el('span', { class: 'sep', text: '·' }),
          minY != null && el('span', { text: minY === maxY ? String(minY) : `${minY}–${maxY}` }),
        ]),
        project.key !== UNATTRIBUTED_KEY && el('div', { class: 'pf-actions' }, [
          el('button', {
            class: 'btn mono',
            onclick: (e) => {
              e.stopPropagation();
              addScope({ kind: 'project', value: project.normTitle, label: project.title });
              setExpandedKey(null);
            },
          }, [
            fa('fa-solid fa-crosshairs', 'icon-left'),
            t('profile.scopeIn', lang),
          ]),
        ]),
      ]);

      const timeline = minY != null ? el('div', { class: 'pf-section pf-timeline-section' }, [
        el('span', { class: 'kicker', text: t('profile.timeline', lang) }),
        renderFundingTimeline(roundsByYear, minY, maxY, lang),
      ]) : null;

      const people = peopleRows.length > 0 ? el('div', { class: 'pf-section pf-people' }, [
        el('span', { class: 'kicker', text: t('profile.people', lang) }),
        el('div', { class: 'pf-people-grid' }, peopleRows),
      ]) : null;

      const roundsSection = el('div', { class: 'pf-section pf-rounds' }, [
        el('span', { class: 'kicker', text: t('profile.rounds_section', lang) }),
        ...rowsSorted.map(r => renderRoundCard(r, lang, normalize)),
      ]);

      // Mentions / events
      const evs = projectEventsFor(project.normTitle);
      const narratives = evs.filter(e => e.type === 'narrative');
      const decisions = evs.filter(e => e.type === 'decision');

      const mentionsSection = (narratives.length > 0 || decisions.length > 0)
        ? renderMentionsSection(narratives, decisions, lang)
        : null;

      return el('div', { class: 'project-profile' }, [
        hero,
        timeline,
        people,
        roundsSection,
        mentionsSection,
      ]);
    }

    function renderRoundCard(r, lang, normalize) {
      const id = `${r.doc}:${r.n}`;
      const whyOpen = state.expandedRoundIds.has(id);
      const doc = docById.get(r.doc);
      const events = projectEventsFor(rowNormTitles[r.idx]);
      const roundNarrative = events.find(e => e.type === 'narrative' && e.year === r.year);
      const docActions = [];
      if (doc && doc.source_url) {
        docActions.push(el('button', {
          class: 'rc-compare mono',
          onclick: (e) => {
            e.stopPropagation();
            openPdfPreview(doc, r.title);
          },
          title: t('pdf.preview_title', lang),
        }, [
          fa('fa-solid fa-eye', 'icon-left'),
          t('pdf.preview', lang),
        ]));
      } else if (doc && doc.source_url_missing) {
        docActions.push(el('span', {
          class: 'rc-compare mono pdf-missing',
          title: t('pdf.missing', lang),
        }, [
          fa('fa-regular fa-file-excel', 'icon-left'),
          t('pdf.missing', lang),
        ]));
      }

      const card = el('div', { class: 'round-card' + (whyOpen ? ' open' : '') }, [
        el('div', { class: 'rc-main' }, [
          el('span', { class: 'rc-year mono', text: r.year != null ? String(r.year) : '—' }),
          el('span', {
            class: 'rc-prog clickable',
            text: r.program ? t('prog.' + r.program, lang) : '—',
            onclick: (e) => {
              e.stopPropagation();
              if (!r.program) return;
              addScope({ kind: 'program', value: r.program, label: t('prog.' + r.program, lang) });
            },
            title: t('profile.scope_short', lang),
          }),
          el('span', {
            class: 'rc-cat clickable',
            text: r.cat_type && r.cat_type !== 'other' ? t('cat.' + r.cat_type, lang) : '',
            onclick: (e) => {
              e.stopPropagation();
              if (!r.cat_type || r.cat_type === 'other') return;
              addScope({ kind: 'cat', value: r.cat_type, label: t('cat.' + r.cat_type, lang) });
            },
            title: t('profile.scope_short', lang),
          }),
          el('span', { class: 'rc-amount mono', text: formatAmount(
            normalize ? r.amount_eur : r.amount,
            normalize ? 'EUR' : (r.currency || 'EUR'),
            lang
          ) }),
          el('div', { class: 'rc-doc-actions' }, docActions),
          el('button', {
            class: 'rc-why mono' + (whyOpen ? ' on' : ''),
            onclick: (e) => { e.stopPropagation(); toggleRoundExpanded(id); },
          }, [
            fa(whyOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down', 'icon-left'),
            t('profile.why', lang),
          ]),
        ]),
      ]);

      if (whyOpen) {
        const body = el('div', { class: 'rc-why-body' });
        if (doc) {
          const fields = [];
          if (doc.natjecaj_title) { fields.push(el('span', { class: 'k', text: t('profile.call', lang) }));
                                    fields.push(el('span', { class: 'v', text: doc.natjecaj_title })); }
          if (doc.decision_date)  { fields.push(el('span', { class: 'k', text: t('profile.decisionDate', lang) }));
                                    fields.push(el('span', { class: 'v', text: doc.decision_date })); }
          if (doc.decision_body)  { fields.push(el('span', { class: 'k', text: t('profile.decisionBody', lang) }));
                                    fields.push(el('span', { class: 'v', text: doc.decision_body })); }
          if (doc.ukupno)         { fields.push(el('span', { class: 'k', text: t('profile.sessionTotal', lang) }));
                                    fields.push(el('span', { class: 'v', text: formatAmount(doc.ukupno, 'EUR', lang) })); }
          if (fields.length) body.appendChild(el('div', { class: 'rc-fields' }, fields));
        }
        if (roundNarrative && roundNarrative.summary) {
          body.appendChild(el('div', { class: 'rc-narrative', text: roundNarrative.summary }));
        } else {
          body.appendChild(el('div', { class: 'rc-narrative empty', text: t('profile.no_narrative', lang) }));
        }
        card.appendChild(body);
      }

      return card;
    }

    function renderMentionsSection(narratives, decisions, lang) {
      const open = state.expandedMentions;
      const head = el('button', {
        class: 'pf-mentions-head' + (open ? ' open' : ''),
        onclick: (e) => { e.stopPropagation(); toggleMentionsExpanded(); },
      }, [
        el('span', { class: 'kicker', text: t('profile.mentions', lang) }),
        el('span', { class: 'mono pf-mentions-count', text:
          (narratives.length ? t('profile.narratives_count', lang, { n: narratives.length }) : '') +
          (narratives.length && decisions.length ? '  ·  ' : '') +
          (decisions.length ? t('profile.decisions_count', lang, { n: decisions.length }) : '')
        }),
        el('span', { class: 'mono pf-mentions-toggle' }, [
          fa(open ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'),
        ]),
      ]);
      const wrap = el('div', { class: 'pf-section pf-mentions' }, [head]);
      if (open) {
        const body = el('div', { class: 'pf-mentions-body' }, [
          ...narratives.map(e => {
            const narrDoc = narrativeById.get(e.id);
            const actions = [];
            if (narrDoc && narrDoc.source_url) {
              actions.push(el('button', {
                class: 'e-compare mono',
                onclick: (ev) => {
                  ev.stopPropagation();
                  openPdfPreview(narrDoc, e.summary || e.id);
                },
                title: t('pdf.preview_title', lang),
              }, [
                fa('fa-solid fa-eye', 'icon-left'),
                t('pdf.preview', lang),
              ]));
            }
            return el('div', { class: 'event' }, [
              el('span', { class: 'e-year', text: e.year != null ? String(e.year) : '—' }),
              el('div', { class: 'e-body' }, [
                el('span', { class: 'tag', text: t('profile.mentions', lang) }),
                e.summary || '—',
              ]),
              actions.length ? el('div', { class: 'e-actions' }, actions) : null,
            ]);
          }),
          ...decisions.map(e => {
            const decDoc = decisionById.get(e.id);
            const actions = [];
            if (decDoc && decDoc.source_url) {
              actions.push(el('button', {
                class: 'e-compare mono',
                onclick: (ev) => {
                  ev.stopPropagation();
                  openPdfPreview(decDoc, e.summary || e.id);
                },
                title: t('pdf.preview_title', lang),
              }, [
                fa('fa-solid fa-eye', 'icon-left'),
                t('pdf.preview', lang),
              ]));
            }
            return el('div', { class: 'event' }, [
              el('span', { class: 'e-year', text: e.year != null ? String(e.year) : '—' }),
              el('div', { class: 'e-body' }, [
                el('span', { class: 'tag decision', text: 'decision' }),
                e.summary || '—',
              ]),
              actions.length ? el('div', { class: 'e-actions' }, actions) : null,
            ]);
          }),
        ]);
        wrap.appendChild(body);
      }
      return wrap;
    }

    function updateStatus() {
      if (!statusbar) return;
      const lang = state.lang;
      const total = DATA.rows.length;
      const shown = filteredIds.length;
      const sum = filteredIds.reduce((s, i) => s + (DATA.rows[i].amount_eur || 0), 0);
      statusbar.replaceChildren(
        el('span', {}, [
          t('status.showing', lang) + ' ',
          el('b', { text: shown.toLocaleString() }),
          ' ' + t('status.of', lang) + ' ' + total.toLocaleString() + ' ' + t('status.rows', lang) + ' · ',
          formatAmount(sum, 'EUR', lang) + ' ' + t('status.total', lang),
        ]),
        el('span', { text: 'HAVC 2009–' + DATA.facets.years[DATA.facets.years.length - 1] }),
      );
    }

    let rafQueued = false;
    scrollEl.addEventListener('scroll', () => {
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(() => { rafQueued = false; paint(); });
    });
    window.addEventListener('resize', paint);

    on(['filters', 'scopes', 'groupBy', 'sort', 'expanded', 'hideUnattributed', 'lang'], () => {
      recomputeData();
    });

    root.replaceChildren(headerEl, scrollEl);

    statusbar = el('div', { class: 'statusbar' });
    root.parentElement.appendChild(statusbar);

    recomputeData();
  }

  // ═══ 13. Unfunded mentions modal ════════════════════════════════════
  function mountUnfundedModal() {
    let host = null;
    function close() { setShowUnfunded(false); }
    function render() {
      if (!state.showUnfunded) {
        if (host) { host.remove(); host = null; }
        return;
      }
      if (host) return;

      const lang = state.lang;
      const list = DATA.unfunded_mentions || [];
      host = el('div', { class: 'modal-backdrop', onclick: close }, [
        el('div', { class: 'modal', onclick: (e) => e.stopPropagation() }, [
          el('div', { class: 'modal-head' }, [
            el('h2', { text: t('unfunded.title', lang) }),
            el('button', { class: 'btn mono', onclick: close }, [
              fa('fa-solid fa-xmark', 'icon-left'),
              t('modal.close', lang),
            ]),
          ]),
          el('div', { class: 'modal-body' }, [
            el('p', { style: 'font-size:12px;color:var(--paper-dim);margin:0 0 14px;', text: t('unfunded.note', lang) }),
            ...list.map(u => el('button', {
              class: 'unfunded-row clickable',
              onclick: () => {
                addScope({ kind: 'project', value: normTitle(u.title), label: u.title });
                close();
              },
            }, [
              el('span', { class: 'y mono', text: u.first_year != null ? String(u.first_year) : '—' }),
              el('span', { class: 't', text: u.title }),
              el('span', { class: 'n mono', text: u.narratives.length + ' src' }),
            ])),
          ]),
        ]),
      ]);
      document.body.appendChild(host);

      function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } }
      document.addEventListener('keydown', onKey);
    }
    on(['showUnfunded', 'lang'], render);
    render();
  }

  // ═══ 14. Keyboard shortcuts ═════════════════════════════════════════
  function mountPdfPreviewModal() {
    let host = null;
    let keyHandler = null;

    function close() { setPdfPreview(null); }

    function render() {
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      if (host) {
        host.remove();
        host = null;
      }

      const preview = state.pdfPreview;
      if (!preview) return;

      const lang = state.lang;
      const paneTitle = preview.title || 'PDF';

      const remotePane = preview.source_url ? el('div', { class: 'pdf-pane' }, [
        el('div', { class: 'pdf-pane-head' }, [
          el('span', { class: 'kicker', text: t('pdf.havc_source', lang) }),
          el('span', { class: 'mono', text: paneTitle }),
        ]),
        el('iframe', {
          class: 'pdf-frame',
          src: preview.source_url,
          loading: 'lazy',
          title: `${t('pdf.havc_source', lang)} - ${paneTitle}`,
          referrerpolicy: 'no-referrer',
        }),
      ]) : el('div', { class: 'pdf-pane pdf-pane-empty' }, [
        el('span', { class: 'kicker', text: t('pdf.havc_source', lang) }),
      ]);

      host = el('div', { class: 'modal-backdrop', onclick: close }, [
        el('div', { class: 'modal modal-wide pdf-preview-modal', onclick: (e) => e.stopPropagation() }, [
          el('div', { class: 'modal-head' }, [
            el('h2', { text: t('pdf.preview_title', lang) }),
            el('div', { class: 'pdf-preview-actions' }, [
              el('button', { class: 'btn mono', onclick: close }, [
                fa('fa-solid fa-xmark', 'icon-left'),
                t('modal.close', lang),
              ]),
            ]),
          ]),
          el('div', { class: 'modal-body pdf-preview-body' }, [
            el('p', { class: 'pdf-source-note mono', text: t('pdf.source_note', lang) }),
            preview.source_url && el('div', { class: 'pdf-source-row' }, [
              el('span', { class: 'kicker', text: t('pdf.url_label', lang) }),
              el('a', {
                class: 'pdf-source-link mono',
                href: preview.source_url,
                target: '_blank',
                rel: 'noopener',
                text: preview.source_url,
              }),
              el('div', { class: 'pdf-preview-actions' }, [
                el('a', {
                  class: 'btn mono',
                  href: preview.source_url,
                  target: '_blank',
                  rel: 'noopener',
                }, [
                  fa('fa-solid fa-arrow-up-right-from-square', 'icon-left'),
                  t('pdf.open_new_tab', lang),
                ]),
                el('a', {
                  class: 'btn mono',
                  href: preview.source_url,
                  target: '_blank',
                  rel: 'noopener',
                  download: '',
                }, [
                  fa('fa-solid fa-download', 'icon-left'),
                  t('pdf.download', lang),
                ]),
              ]),
            ]),
            remotePane,
          ]),
        ]),
      ]);
      document.body.appendChild(host);

      keyHandler = (e) => {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', keyHandler);
    }

    on(['pdfPreview', 'lang'], render);
    render();
  }

  function mountKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      if (e.key === '/' && !inField) {
        e.preventDefault();
        const inp = document.querySelector('.search input');
        if (inp) inp.focus();
        return;
      }
      if (e.key === 'Escape' && !inField) {
        if (state.pdfPreview) {
          setPdfPreview(null);
        } else if (state.expandedKey) {
          state.expandedKey = null;
          state.expandedRoundIds = new Set();
          state.expandedMentions = false;
          fire('expanded');
        } else if (state.scopes.length > 0) {
          popDeepestScope();
        }
      }
    });
  }

  // ═══ 15. Static content loader ══════════════════════════════════════
  const contentCache = new Map();
  async function loadContent(name, lang) {
    const key = name + '.' + lang;
    if (contentCache.has(key)) return contentCache.get(key);
    const url = './content/' + name + '.' + lang + '.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed: ' + url + ' (' + res.status + ')');
    const data = await res.json();
    contentCache.set(key, data);
    return data;
  }

  // ═══ 16. About view ═════════════════════════════════════════════════
  function mountAbout(root) {
    let token = 0;

    function renderLoading() {
      root.replaceChildren(el('div', { class: 'about-view' }, [
        el('div', { class: 'kicker', text: t('nav.about', state.lang) }),
        el('p', { class: 'view-loading', text: '…' }),
      ]));
    }

    function renderError(err) {
      root.replaceChildren(el('div', { class: 'about-view' }, [
        el('div', { class: 'kicker', text: t('nav.about', state.lang) }),
        el('p', { class: 'view-error', text: 'failed to load about content — see console' }),
      ]));
      console.error(err);
    }

    function paragraphsToNodes(arr) {
      return (arr || []).map(p => el('p', { text: p }));
    }

    function renderContent(c) {
      const sigText = c.signature || '';
      root.replaceChildren(el('article', { class: 'about-view' }, [
        el('header', { class: 'about-hero' }, [
          el('div', { class: 'kicker', text: c.hero && c.hero.kicker }),
          el('h1', { class: 'display about-headline', text: c.hero && c.hero.headline }),
          el('div', { class: 'about-subhead mono', text: c.hero && c.hero.subhead }),
        ]),

        c.why_this && el('section', { class: 'about-section' }, [
          el('h2', { class: 'about-section-title', text: c.why_this.title }),
          el('div', { class: 'about-prose' }, paragraphsToNodes(c.why_this.paragraphs)),
        ]),

        c.who_i_am && el('section', { class: 'about-section' }, [
          el('h2', { class: 'about-section-title', text: c.who_i_am.title }),
          el('div', { class: 'about-prose' }, paragraphsToNodes(c.who_i_am.paragraphs)),
        ]),

        c.what_aning_is && el('section', { class: 'about-section' }, [
          el('h2', { class: 'about-section-title', text: c.what_aning_is.title }),
          el('div', { class: 'about-prose' }, paragraphsToNodes(c.what_aning_is.paragraphs)),
        ]),

        Array.isArray(c.links) && c.links.length > 0 && el('section', { class: 'about-section about-section--full' }, [
          el('h2', { class: 'about-section-title', text: t('about.links_title', state.lang) }),
          el('div', { class: 'about-links' }, c.links.map(link => el('a', {
            class: 'about-link-card',
            href: link.href,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, [
            el('span', { class: 'about-link-label mono', text: link.label }),
            link.note ? el('span', { class: 'about-link-note', text: link.note }) : null,
            fa('fa-solid fa-arrow-up-right-from-square', 'about-link-icon'),
          ]))),
        ]),

        sigText ? el('div', { class: 'about-signature', text: sigText }) : null,
      ]));
    }

    async function render() {
      const my = ++token;
      renderLoading();
      try {
        const c = await loadContent('about', state.lang);
        if (my !== token) return; // a newer render started; abandon
        renderContent(c);
      } catch (err) {
        if (my !== token) return;
        renderError(err);
      }
    }

    on('lang', render);
    render();
  }

  // ═══ 17. Process view ═══════════════════════════════════════════════
  function mountProcess(root) {
    let token = 0;

    function renderLoading() {
      root.replaceChildren(el('div', { class: 'process-view' }, [
        el('div', { class: 'kicker', text: t('nav.process', state.lang) }),
        el('p', { class: 'view-loading', text: '…' }),
      ]));
    }

    function renderError(err) {
      root.replaceChildren(el('div', { class: 'process-view' }, [
        el('div', { class: 'kicker', text: t('nav.process', state.lang) }),
        el('p', { class: 'view-error', text: 'failed to load process content — see console' }),
      ]));
      console.error(err);
    }

    function renderEraColumn(era, lang) {
      const sys = era.system || {};
      return el('div', { class: 'era-column', dataset: { era: era.id } }, [
        el('div', { class: 'era-column-head' }, [
          el('span', { class: 'era-label mono', text: era.label }),
          el('span', { class: 'era-dates mono', text: era.dates }),
        ]),
        el('h3', { class: 'era-column-title', text: era.title }),
        el('div', { class: 'era-system' }, [
          el('div', { class: 'era-system-row' }, [
            el('div', { class: 'era-system-axis kicker', text: t('process.input', lang) }),
            el('div', { class: 'era-system-input', text: sys.input || '' }),
          ]),
          el('div', { class: 'era-system-arrow' }, [el('span', { text: '↓' })]),
          el('div', { class: 'era-system-row' }, [
            el('div', { class: 'era-system-axis kicker', text: t('process.process', lang) }),
            el('ul', { class: 'era-system-process' },
              (sys.process || []).map(step => el('li', { text: step }))),
          ]),
          el('div', { class: 'era-system-arrow' }, [el('span', { text: '↓' })]),
          el('div', { class: 'era-system-row' }, [
            el('div', { class: 'era-system-axis kicker', text: t('process.output', lang) }),
            el('div', { class: 'era-system-output', text: sys.output || '' }),
          ]),
        ]),
      ]);
    }

    function renderArtifact(a, lang) {
      if (!a || !a.kind) return null;
      if (a.kind === 'note') {
        return el('div', { class: 'artifact artifact-note', text: a.text });
      }
      if (a.kind === 'file') {
        const head = el('div', { class: 'artifact-pill-head' }, [
          el('span', { class: 'artifact-path mono', text: a.path }),
          a.size ? el('span', { class: 'artifact-size mono', text: a.size }) : null,
        ]);
        return el('div', { class: 'artifact artifact-file' }, [
          head,
          a.note ? el('div', { class: 'artifact-note-line', text: a.note }) : null,
        ]);
      }
      if (a.kind === 'metric') {
        return el('div', { class: 'artifact artifact-metric' }, [
          el('div', { class: 'artifact-metric-value display', text: a.value }),
          el('div', { class: 'artifact-metric-label kicker', text: a.label }),
          a.note ? el('div', { class: 'artifact-metric-note mono', text: a.note }) : null,
        ]);
      }
      if (a.kind === 'code' || a.kind === 'quote') {
        const cls = 'artifact artifact-code' + (a.kind === 'quote' ? ' is-quote' : '');
        return el('div', { class: cls }, [
          a.caption ? el('div', { class: 'artifact-caption kicker', text: a.caption }) : null,
          el('pre', { class: 'artifact-code-body' }, [
            el('code', { class: 'mono', text: a.body || '' }),
          ]),
        ]);
      }
      return null;
    }

    function partitionArtifacts(artifacts) {
      const metrics = [];
      const others = [];
      (artifacts || []).forEach(a => {
        if (a && a.kind === 'metric') metrics.push(a);
        else others.push(a);
      });
      return { metrics, others };
    }

    // ── Deep-dive renderers (Era 3 only) ────────────────────────────────
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs, children) {
      const node = document.createElementNS(SVG_NS, tag);
      if (attrs) {
        for (const k in attrs) {
          const v = attrs[k];
          if (v == null || v === false) continue;
          if (k === 'text') node.textContent = v;
          else node.setAttribute(k, v);
        }
      }
      if (children) {
        const list = Array.isArray(children) ? children : [children];
        for (const c of list) {
          if (c == null || c === false) continue;
          node.appendChild(c);
        }
      }
      return node;
    }

    function renderKindBadge(kind, lang) {
      const k = (kind || '').toLowerCase();
      const labelKey = (k === 'algo' || k === 'llm' || k === 'hybrid') ? ('process.kind.' + k) : null;
      const text = labelKey ? t(labelKey, lang) : (kind || '');
      return el('span', { class: 'pass-badge pass-badge--' + k, text });
    }

    function trimToBoxEdge(ax, ay, bx, by, w, h) {
      const dx = bx - ax, dy = by - ay;
      if (dx === 0 && dy === 0) return { x: ax, y: ay };
      const tx = Math.abs(dx) > 0 ? (w / 2) / Math.abs(dx) : Infinity;
      const ty = Math.abs(dy) > 0 ? (h / 2) / Math.abs(dy) : Infinity;
      const tval = Math.min(tx, ty);
      return { x: ax + dx * tval, y: ay + dy * tval };
    }

    function renderFlowDiagram(d) {
      if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) return null;
      const byId = new Map(d.nodes.map(n => [n.id, n]));

      function arrowMarker(id, cls) {
        return svgEl('marker', {
          id,
          viewBox: '0 0 10 10',
          refX: '9',
          refY: '5',
          markerWidth: '7',
          markerHeight: '7',
          orient: 'auto-start-reverse',
        }, [svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: cls })]);
      }
      const defs = svgEl('defs', null, [
        arrowMarker('flow-arrow-forward',  'flow-arrow-head flow-arrow-head--forward'),
        arrowMarker('flow-arrow-loop',     'flow-arrow-head flow-arrow-head--loop'),
        arrowMarker('flow-arrow-feedback', 'flow-arrow-head flow-arrow-head--feedback'),
      ]);

      const edgeNodes = d.edges.map(e => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const start = trimToBoxEdge(acx, acy, bcx, bcy, a.w, a.h);
        const end   = trimToBoxEdge(bcx, bcy, acx, acy, b.w, b.h);
        const kind = e.kind || 'forward';
        const dx = end.x - start.x, dy = end.y - start.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len; // unit perpendicular
        let dStr;
        let markerId = 'flow-arrow-forward';
        if (kind === 'loop')     markerId = 'flow-arrow-loop';
        if (kind === 'feedback') markerId = 'flow-arrow-feedback';

        if (kind === 'forward') {
          dStr = 'M ' + start.x + ' ' + start.y + ' L ' + end.x + ' ' + end.y;
        } else if (kind === 'loop') {
          const bow = 22;
          const mx = (start.x + end.x) / 2 + nx * bow;
          const my = (start.y + end.y) / 2 + ny * bow;
          dStr = 'M ' + start.x + ' ' + start.y +
                 ' Q ' + mx + ' ' + my + ' ' + end.x + ' ' + end.y;
        } else { // feedback — big curve back
          const bow = 110;
          const c1x = start.x + nx * bow;
          const c1y = start.y + ny * bow;
          const c2x = end.x   + nx * bow;
          const c2y = end.y   + ny * bow;
          dStr = 'M ' + start.x + ' ' + start.y +
                 ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + end.x + ' ' + end.y;
        }
        return svgEl('path', {
          d: dStr,
          'data-kind': kind,
          'marker-end': 'url(#' + markerId + ')',
        });
      }).filter(Boolean);

      function wrapText(textNode, label, w) {
        // Soft-wrap into <tspan> lines, ~ 22 chars/line for the standard font size.
        const maxChars = Math.max(10, Math.floor(w / 7.2));
        const words = String(label || '').split(/\s+/);
        const lines = [];
        let cur = '';
        for (const word of words) {
          if (!cur.length) { cur = word; continue; }
          if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
          else { lines.push(cur); cur = word; }
        }
        if (cur.length) lines.push(cur);
        return lines;
      }

      const nodeGroups = d.nodes.map(n => {
        const cx = n.x + n.w / 2;
        const cy = n.y + n.h / 2;
        if (n.kind === 'label') {
          return svgEl('text', {
            x: String(cx),
            y: String(cy + 4),
            'text-anchor': 'middle',
            class: 'flow-loop-label mono',
          }, [document.createTextNode(n.label || '')]);
        }
        const lines = wrapText(null, n.label || '', n.w - 16);
        const lineHeight = 13;
        const startY = cy - ((lines.length - 1) * lineHeight) / 2 + 4;
        const tspans = lines.map((ln, i) => svgEl('tspan', {
          x: String(cx),
          y: String(startY + i * lineHeight),
        }, [document.createTextNode(ln)]));
        return svgEl('g', { class: 'flow-node', 'data-kind': n.kind }, [
          svgEl('rect', {
            x: String(n.x), y: String(n.y),
            width: String(n.w), height: String(n.h),
            rx: '4', ry: '4',
            'data-kind': n.kind,
          }),
          svgEl('text', {
            'text-anchor': 'middle',
            'data-kind': n.kind,
            class: 'flow-node-label',
          }, tspans),
        ]);
      });

      const svg = svgEl('svg', {
        viewBox: d.viewBox || '0 0 1060 600',
        class: 'flow-diagram-svg',
        role: 'img',
        'aria-label': 'pipeline iteration loop',
      }, [defs, ...edgeNodes, ...nodeGroups]);

      return el('div', { class: 'flow-diagram' }, [svg]);
    }

    function renderPassCard(p, lang) {
      if (!p) return null;
      return el('article', { class: 'pass-card', id: p.id || null }, [
        el('header', { class: 'pass-card-head' }, [
          el('span', { class: 'pass-ordinal mono', text: p.ordinal || '' }),
          renderKindBadge(p.kind, lang),
          el('h3', { class: 'pass-card-title display', text: p.title || '' }),
        ]),
        p.engine ? el('div', { class: 'pass-engine mono', text: p.engine }) : null,
        p.what ? el('p', { class: 'pass-what', text: p.what }) : null,
        (p.input || p.output) ? el('div', { class: 'pass-io' }, [
          el('div', { class: 'pass-io-box' }, [
            el('div', { class: 'pass-io-axis kicker', text: t('process.deep_dive.input', lang) }),
            el('div', { class: 'pass-io-value', text: p.input || '—' }),
          ]),
          el('div', { class: 'pass-io-box' }, [
            el('div', { class: 'pass-io-axis kicker', text: t('process.deep_dive.output', lang) }),
            el('div', { class: 'pass-io-value', text: p.output || '—' }),
          ]),
        ]) : null,
        p.prompt_excerpt ? el('div', { class: 'pass-prompt artifact-code' }, [
          p.prompt_excerpt.caption ? el('div', { class: 'artifact-caption kicker', text: p.prompt_excerpt.caption }) : null,
          el('pre', { class: 'artifact-code-body' }, [
            el('code', { class: 'mono', text: p.prompt_excerpt.body || '' }),
          ]),
        ]) : null,
        p.io_example ? el('div', { class: 'pass-io-example' }, [
          p.io_example.caption ? el('div', { class: 'artifact-caption kicker', text: p.io_example.caption }) : null,
          el('div', { class: 'pass-io-grid' }, [
            el('div', { class: 'pass-io-cell pass-io-cell--expected' }, [
              el('div', { class: 'pass-io-axis kicker', text: t('process.deep_dive.expected', lang) }),
              el('pre', { class: 'artifact-code-body' }, [el('code', { class: 'mono', text: p.io_example.expected || '' })]),
            ]),
            el('div', { class: 'pass-io-cell pass-io-cell--received' }, [
              el('div', { class: 'pass-io-axis kicker', text: t('process.deep_dive.received', lang) }),
              el('pre', { class: 'artifact-code-body' }, [el('code', { class: 'mono', text: p.io_example.received || '' })]),
            ]),
          ]),
        ]) : null,
        (Array.isArray(p.metrics) && p.metrics.length) ? el('div', { class: 'pass-metric-row' },
          p.metrics.map(m => el('div', { class: 'artifact artifact-metric pass-metric' }, [
            el('div', { class: 'artifact-metric-value display', text: m.value }),
            el('div', { class: 'artifact-metric-label kicker', text: m.label }),
            m.note ? el('div', { class: 'artifact-metric-note mono', text: m.note }) : null,
          ]))) : null,
        (Array.isArray(p.artifacts) && p.artifacts.length) ? el('div', { class: 'pass-artifacts' },
          p.artifacts.map(a => renderArtifact(a, lang))) : null,
      ]);
    }

    function renderTally(tally) {
      if (!tally || !Array.isArray(tally.items)) return null;
      return el('section', { class: 'deepdive-tally' }, [
        tally.title ? el('h3', { class: 'process-section-title', text: tally.title }) : null,
        el('div', { class: 'tally-strip' }, tally.items.map(it => el('div', { class: 'tally-tile' }, [
          el('div', { class: 'display tally-tile-value', text: it.value }),
          el('div', { class: 'kicker tally-tile-label', text: it.label }),
          it.note ? el('div', { class: 'mono tally-tile-note', text: it.note }) : null,
        ]))),
        tally.tokens_footnote ? el('p', { class: 'tokens-footnote mono', text: tally.tokens_footnote }) : null,
      ]);
    }

    function renderDeepDive(dd, lang) {
      if (!dd) return null;
      return el('section', { class: 'process-deepdive' }, [
        el('header', { class: 'deepdive-head' }, [
          dd.kicker ? el('div', { class: 'kicker', text: dd.kicker }) : null,
          dd.headline ? el('h2', { class: 'display deepdive-headline', text: dd.headline }) : null,
          dd.subhead ? el('p', { class: 'deepdive-subhead', text: dd.subhead }) : null,
          dd._todo_translate ? el('p', { class: 'deepdive-todo mono', text: t('process.deep_dive.todo', lang) }) : null,
        ]),
        dd.loop_diagram ? el('section', { class: 'deepdive-loop' }, [renderFlowDiagram(dd.loop_diagram)]) : null,
        (Array.isArray(dd.passes) && dd.passes.length) ? el('section', { class: 'deepdive-passes' },
          dd.passes.map(p => renderPassCard(p, lang))) : null,
        renderTally(dd.tally),
      ]);
    }

    function renderEraCard(era, lang) {
      const { metrics, others } = partitionArtifacts(era.artifacts);
      return el('article', { class: 'era-card', id: 'era-' + era.id }, [
        el('header', { class: 'era-card-head' }, [
          el('span', { class: 'era-label mono', text: era.label }),
          el('span', { class: 'era-dates mono', text: era.dates }),
        ]),
        el('h2', { class: 'era-card-title display', text: era.title }),
        el('p', { class: 'era-what', text: era.what }),

        el('div', { class: 'era-pros-cons' }, [
          el('div', { class: 'era-prosbox era-prosbox--pros' }, [
            el('h4', { class: 'era-prosbox-title kicker', text: t('process.why_good', lang) }),
            el('ul', { class: 'era-prosbox-list' },
              (era.why_good || []).map(line => el('li', { text: line }))),
          ]),
          el('div', { class: 'era-prosbox era-prosbox--cons' }, [
            el('h4', { class: 'era-prosbox-title kicker', text: t('process.why_limited', lang) }),
            el('ul', { class: 'era-prosbox-list' },
              (era.why_limited || []).map(line => el('li', { text: line }))),
          ]),
        ]),

        (metrics.length > 0 || others.length > 0) && el('section', { class: 'era-artifacts' }, [
          el('h4', { class: 'era-artifacts-title kicker', text: t('process.artifacts', lang) }),
          metrics.length > 0 ? el('div', { class: 'era-metric-row' },
            metrics.map(m => renderArtifact(m, lang))) : null,
          others.length > 0 ? el('div', { class: 'era-artifact-stack' },
            others.map(a => renderArtifact(a, lang))) : null,
        ]),
      ]);
    }

    function renderComparison(cmp, eras, lang) {
      if (!cmp || !Array.isArray(cmp.rows) || cmp.rows.length === 0) return null;
      const headers = el('div', { class: 'cmp-row cmp-header' }, [
        el('div', { class: 'cmp-cell cmp-cell-metric kicker', text: cmp.metric_label || '' }),
        ...eras.map(e => el('div', { class: 'cmp-cell kicker', text: e.label })),
      ]);
      const body = cmp.rows.map(row => el('div', { class: 'cmp-row' }, [
        el('div', { class: 'cmp-cell cmp-cell-metric', text: row.metric }),
        el('div', { class: 'cmp-cell', text: row.era1 || '—' }),
        el('div', { class: 'cmp-cell', text: row.era2 || '—' }),
        el('div', { class: 'cmp-cell', text: row.era3 || '—' }),
      ]));
      return el('section', { class: 'process-comparison' }, [
        cmp.title ? el('h2', { class: 'process-section-title', text: cmp.title }) : null,
        el('div', { class: 'cmp-table' }, [headers, ...body]),
      ]);
    }

    function renderContent(c) {
      const lang = state.lang;
      const eras = Array.isArray(c.eras) ? c.eras : [];
      const era3 = eras.find(e => e && e.id === 'era3');
      const deepDive = era3 && era3.deep_dive ? era3.deep_dive : null;
      root.replaceChildren(el('article', { class: 'process-view' }, [
        el('header', { class: 'process-hero' }, [
          el('div', { class: 'kicker', text: c.hero && c.hero.kicker }),
          el('h1', { class: 'display process-headline', text: c.hero && c.hero.headline }),
          c.hero && c.hero.subhead ? el('p', { class: 'process-subhead', text: c.hero.subhead }) : null,
        ]),

        eras.length > 0 && el('section', { class: 'process-diagram-section' }, [
          el('h2', { class: 'process-section-title', text: t('process.diagram', lang) }),
          el('div', { class: 'process-diagram' }, eras.map(e => renderEraColumn(e, lang))),
        ]),

        eras.length > 0 && el('section', { class: 'process-eras' },
          eras.map(e => renderEraCard(e, lang))),

        deepDive ? renderDeepDive(deepDive, lang) : null,

        renderComparison(c.comparison, eras, lang),

        c.footnote ? el('p', { class: 'process-footnote', text: c.footnote }) : null,
      ]));
    }

    async function render() {
      const my = ++token;
      renderLoading();
      try {
        const c = await loadContent('process', state.lang);
        if (my !== token) return;
        renderContent(c);
      } catch (err) {
        if (my !== token) return;
        renderError(err);
      }
    }

    on('lang', render);
    render();
  }

  function applyViewVisibility() {
    const dash = document.getElementById('view-dashboard');
    const about = document.getElementById('view-about');
    const proc = document.getElementById('view-process');
    if (!dash || !about || !proc) return;
    dash.classList.toggle('is-hidden', state.view !== 'dashboard');
    about.classList.toggle('is-hidden', state.view !== 'about');
    proc.classList.toggle('is-hidden', state.view !== 'process');
  }

  // ═══ Year pills (single-select year filter row) ═════════════════════
  function mountYearPills(root) {
    function render() {
      const lang = state.lang;
      const f = state.filters;
      const allYears = DATA && DATA.facets && Array.isArray(DATA.facets.years) ? DATA.facets.years : [];
      if (allYears.length === 0) {
        root.replaceChildren();
        return;
      }
      const [lo, hi] = f.yearRange || [allYears[0], allYears[allYears.length - 1]];
      const yearsInRange = allYears.filter(y => y >= lo && y <= hi);

      const allBtn = el('button', {
        class: 'btn mono year-pill year-pill-all' + (f.selectedYear == null ? ' active' : ''),
        type: 'button',
        text: t('years.all', lang),
        onclick: () => setSelectedYear(null),
      });

      const yearBtns = yearsInRange.map(y => el('button', {
        class: 'btn mono year-pill' + (f.selectedYear === y ? ' active' : ''),
        type: 'button',
        text: String(y),
        onclick: () => setSelectedYear(f.selectedYear === y ? null : y),
      }));

      root.replaceChildren(
        el('span', { class: 'kicker year-pills-kicker', text: t('years.label', lang) }),
        el('div', { class: 'year-pills-list' }, [allBtn, ...yearBtns]),
      );
    }
    on(['filters', 'lang'], render);
    render();
  }

  // ═══ 18. Boot ═══════════════════════════════════════════════════════
  async function boot() {
    document.documentElement.lang = state.lang;
    document.body.classList.add('theme-' + state.theme);
    state.view = readViewFromHash();
    document.body.classList.add('view-' + state.view);

    const app = document.getElementById('app');
    app.replaceChildren(el('div', { class: 'boot' }, [
      el('div', { class: 'wordmark' }, ['Sredstva', el('span', { class: 'dot', text: '·' })]),
      el('div', { class: 'label', text: 'loading registry…' }),
    ]));

    try {
      await loadData();
    } catch (err) {
      app.replaceChildren(el('div', { class: 'boot' }, [
        el('div', { class: 'label', text: 'failed to load data.json — see console' }),
      ]));
      console.error(err);
      return;
    }

    readFromHash();

    if (!state.filters.yearRange) {
      state.filters.yearRange = [DATA.facets.years[0], DATA.facets.years[DATA.facets.years.length - 1]];
    }

    app.className = 'app';
    app.replaceChildren(
      el('header', { class: 'topbar', id: 'topbar' }),
      el('div', { class: 'view-root', id: 'view-root' }, [
        el('div', { class: 'workspace', id: 'view-dashboard' }, [
          el('aside', { class: 'filter-rail', id: 'rail' }),
          el('main', { class: 'main' }, [
            el('section', { class: 'headline', id: 'headline' }),
            el('section', { class: 'insights', id: 'insights' }),
            el('section', { class: 'scope-row', id: 'scope-row' }),
            el('nav', { class: 'pivot', id: 'pivot' }),
            el('section', { class: 'year-pills', id: 'year-pills' }),
            el('section', { class: 'list-wrap', id: 'listwrap' }),
          ]),
        ]),
        el('section', { class: 'about-host', id: 'view-about' }),
        el('section', { class: 'process-host', id: 'view-process' }),
      ]),
    );

    mountTopbar(document.getElementById('topbar'));
    mountFilterRail(document.getElementById('rail'));
    mountHeadline(document.getElementById('headline'));
    mountInsights(document.getElementById('insights'));
    mountScopeRow(document.getElementById('scope-row'));
    mountPivot(document.getElementById('pivot'));
    mountYearPills(document.getElementById('year-pills'));
    mountList(document.getElementById('listwrap'));
    mountAbout(document.getElementById('view-about'));
    mountProcess(document.getElementById('view-process'));
    mountUnfundedModal();
    mountPdfPreviewModal();
    mountKeyboard();

    applyViewVisibility();
    on('view', applyViewVisibility);
    window.addEventListener('hashchange', syncViewFromHash);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
