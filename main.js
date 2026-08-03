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
 *   9. scoped all-project funding timeline
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
    'app.name': { en: 'Sredstva', hr: 'Sredstva' },
    'app.title': { en: 'Sredstva · HAVC Open Registry', hr: 'Sredstva · HAVC otvoreni registar' },
    'app.subtitle': { en: 'Croatian audiovisual public funding — open registry',
                      hr: 'Hrvatski audiovizualni javni poticaji — otvoreni registar' },

    // View tabs
    'nav.dashboard': { en: 'Registry', hr: 'Registar' },
    'nav.about':     { en: 'About',    hr: 'O autoru' },
    'nav.process':   { en: 'Process',  hr: 'Proces' },
    'nav.sections':  { en: 'sections', hr: 'sekcije' },

    'about.links_title': { en: 'Elsewhere', hr: 'Drugdje' },

    'years.all':   { en: 'All years', hr: 'Sve godine' },
    'years.label': { en: 'Year',      hr: 'Godina' },

    'process.input':     { en: 'Input',   hr: 'Ulaz' },
    'process.process':   { en: 'Process', hr: 'Proces' },
    'process.output':    { en: 'Output',  hr: 'Izlaz' },
    'process.why_good':  { en: 'Why it worked',         hr: 'Što je radilo' },
    'process.why_limited':{ en: 'Why it broke',         hr: 'Što je puklo' },
    'process.artifacts': { en: 'Artifacts',             hr: 'Artefakti' },
    'process.diagram':   { en: 'The approaches at a glance', hr: 'Pristupi na prvi pogled' },
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
    'facet.filters':  { en: 'Filters',        hr: 'Filtri' },
    'facet.all':      { en: 'all',            hr: 'sve' },
    'facet.reset':    { en: 'Reset',          hr: 'Poništi' },
    'share.label':    { en: 'Share view', hr: 'Podijeli prikaz' },
    'share.copied':   { en: 'Link copied', hr: 'Poveznica kopirana' },
    'share.failed':   { en: 'Copy failed', hr: 'Kopiranje nije uspjelo' },
    'share.aria':     { en: 'Copy a link to the current view', hr: 'Kopiraj poveznicu na trenutačni prikaz' },
    'wordmark.home':  { en: 'Reset and return to the registry home', hr: 'Poništi prikaz i vrati se na početak registra' },
    'facet.currency_note': { en: '1 € = {rate} kn (fixed, ECB)', hr: '1 € = {rate} kn (fiksno, ESB)' },
    'facet.unfunded.label': { en: 'Discussed, never funded', hr: 'Spominjani, ne financirani' },
    'facet.unfunded.sub':   { en: 'mentions and explicit non-awards without a verified award',
                              hr: 'spomeni i izričito neodobreni projekti bez potvrđene potpore' },

    'header.line': { en: 'Croatian audiovisual public funding · 2009–{maxYear}',
                     hr: 'Hrvatski javni poticaji za audiovizualnu djelatnost · 2009.–{maxYear}.' },
    'header.decisions': { en: '{n} decisions', hr: '{n} odluka' },
    'header.funded':    { en: '{amt} funded',  hr: '{amt} dodijeljeno' },
    'header.projects':  { en: '{n} funded projects', hr: '{n} financiranih projekata' },
    'header.calls':     { en: '{n} calls',     hr: '{n} natječaja' },
    'header.unfunded':  { en: '{n} unfunded',  hr: '{n} bez sredstava' },
    'header.stats.open': {
      en: 'Open full registry analytics',
      hr: 'Otvori punu analitiku registra',
    },
    'header.notice.kicker': {
      en: 'Data provenance',
      hr: 'Podrijetlo podataka',
    },
    'header.notice.body': {
      en: 'All registry data is machine-extracted from public funding results published on havc.hr. Each project, decision, and amount links directly to the source HAVC PDF. No human review has been performed yet; human review is planned if HAVC approves the project under Komplementarne.',
      hr: 'Svi podaci u registru strojno su izdvojeni iz javno objavljenih rezultata financiranja na havc.hr. Svaki projekt, odluka i iznos imaju izravnu poveznicu na izvorni HAVC PDF. Ručna provjera još nije provedena; planirana je ako HAVC odobri projekt u okviru poziva Komplementarne.',
    },
    'header.notice.audit': {
      en: 'Automated cross-check {ts}: official totals alignment (PASS {pass}, WARN {warn}, FAIL {fail}); rows {raw}->{dedup}.',
      hr: 'Automatska provjera {ts}: uskladenost sa sluzbenim zbrojevima (PASS {pass}, WARN {warn}, FAIL {fail}); redci {raw}->{dedup}.',
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
    'metric.decisions':   { en: 'Decisions', hr: 'Odluke' },
    'metric.top50share':  { en: 'Top 50 share', hr: 'Udio top 50' },
    'metric.p90':         { en: 'P90 award', hr: 'P90 iznos' },
    'metric.p95':         { en: 'P95 award', hr: 'P95 iznos' },
    'metric.mean':        { en: 'Mean award', hr: 'Prosjecni iznos' },
    'metric.projects':    { en: 'projects', hr: 'projekata' },

    'metric.top10ProdShare':  { en: 'Top 10 producers share', hr: 'Udio top 10 producenata' },
    'metric.giniProducers':   { en: 'Producer inequality (Gini)', hr: 'Nejednakost producenata (Gini)' },
    'metric.pareto50':        { en: 'Producers holding 50 %', hr: 'Producenata za 50 %' },
    'metric.repeatFunded':    { en: 'Multi-round projects', hr: 'Projekti s vise rundi' },
    'metric.medianRounds':    { en: 'Median rounds per project', hr: 'Medijan rundi po projektu' },
    'metric.largestProject':  { en: 'Largest cumulative project', hr: 'Najveci kumulativni projekt' },
    'metric.skew':            { en: 'Skew (mean ÷ median)', hr: 'Asimetricnost (prosjek÷medijan)' },
    'metric.producers.sub':   { en: '{n} producers', hr: '{n} producenata' },
    'metric.pareto.sub':      { en: '{share} of all producers', hr: '{share} svih producenata' },
    'metric.repeat.sub':      { en: 'of {n} funded projects', hr: 'od {n} financiranih projekata' },
    'metric.largest.sub':     { en: 'summed across rounds', hr: 'zbroj svih rundi' },
    'metric.expand.hint':     { en: 'click for formula and explanation', hr: 'klikni za formulu i objasnjenje' },
    'metric.formula.label':   { en: 'Formula', hr: 'Formula' },
    'metric.explain.label':   { en: 'What it measures', hr: 'Sto mjeri' },

    'formula.top10ProdShare':   { en: 'Σ(top 10 producers by total) ÷ Σ(all amounts)', hr: 'Σ(top 10 producenata po iznosu) ÷ Σ(svi iznosi)' },
    'formula.giniProducers':    { en: '(2·Σ(i·xᵢ) − (n+1)·Σxᵢ) ÷ (n·Σxᵢ)\nover sorted producer totals x₁ ≤ … ≤ xₙ', hr: '(2·Σ(i·xᵢ) − (n+1)·Σxᵢ) ÷ (n·Σxᵢ)\nnad sortiranim sumama producenata x₁ ≤ … ≤ xₙ' },
    'formula.pareto50':         { en: 'min { k | Σᵢ₌₁..k xᵢ ÷ Σ(all amounts) ≥ 0.5 }\nover producers sorted descending', hr: 'min { k | Σᵢ₌₁..k xᵢ ÷ Σ(svi iznosi) ≥ 0.5 }\nnad producentima sortiranima silazno' },
    'formula.repeatFunded':     { en: 'count(projects with ≥ 2 positive decisions) ÷ count(funded projects)', hr: 'count(projekti s ≥ 2 pozitivne odluke) ÷ count(financirani projekti)' },
    'formula.medianRounds':     { en: 'median(count(positive decisions per project))', hr: 'medijan(count(pozitivne odluke po projektu))' },
    'formula.largestProject':   { en: 'max(Σ amount_eur per project)', hr: 'max(Σ amount_eur po projektu)' },
    'formula.p95':              { en: 'quantile(amount_eur, 0.95 | amount_eur > 0)', hr: 'kvantil(amount_eur, 0.95 | amount_eur > 0)' },
    'formula.skew':             { en: 'mean ÷ median (over positive amounts)', hr: 'prosjek ÷ medijan (nad pozitivnim iznosima)' },

    'kpi.desc.top10ProdShare':  { en: 'Share of total funding that flowed to the ten production companies with the largest cumulative awards. A high share means the sector is financially concentrated around a few key houses.', hr: 'Udio ukupnih sredstava koji je primilo 10 najvecih produkcijskih kuca po kumulativnom iznosu. Visok udio znaci da je sektor financijski koncentriran na nekoliko nositelja.' },
    'kpi.desc.giniProducers':   { en: 'Inequality coefficient over cumulative funding per production company (not per project). 0 % means every company received an equal sum, 100 % means one company absorbed everything.', hr: 'Nejednakost ukupne dodjele po produkcijskim kucama (ne po projektima). 0 % znaci da je svaka kuca primila jednak ukupni iznos, 100 % da je jedna kuca apsorbirala sve.' },
    'kpi.desc.pareto50':        { en: 'How many production companies it takes to add up to half of all registry funding. A small number means funding is heavily concentrated.', hr: 'Koliko je produkcijskih kuca skupilo polovicu svih sredstava registra. Ako je broj malen, financiranje je jako koncentrirano.' },
    'kpi.desc.repeatFunded':    { en: 'Share of funded projects that received more than one positive decision (e.g. development plus production). Indicates how often projects are followed across multiple stages.', hr: 'Udio projekata koji su primili vise od jedne pozitivne odluke (npr. razvoj i proizvodnja). Pokazuje koliko se cesto projekti prate kroz vise faza.' },
    'kpi.desc.medianRounds':    { en: 'Typical number of positive decisions a project accumulates across its lifetime in the registry. A value of 1 means projects mostly get touched once; higher values mean staged support.', hr: 'Tipican broj pozitivnih odluka koje projekt akumulira tijekom svog vijeka u registru. Vrijednost 1 znaci da se projekti uglavnom financiraju jednom; vise vrijednosti znace fazno pracenje.' },
    'kpi.desc.largestProject':  { en: 'The biggest single cumulative project total — i.e. all decisions on one project summed. Differs from the largest individual award and exposes long-running flagships.', hr: 'Najveci ukupni iznos koji je jedan projekt prikupio kroz sve svoje rundi. Razlikuje se od najvece pojedinacne dodjele i otkriva projekte koji su financirani u vise navrata.' },
    'kpi.desc.p95':             { en: '95th percentile: only 5 % of decisions are this large or larger. A sharper long-tail indicator than P90 — useful when the top of the distribution is what matters.', hr: '95. percentil: samo 5 % dodjela je ovog iznosa ili veceg. Ostriji indikator dugog repa od P90 — koristan kad nas zanima sam vrh raspodjele.' },
    'kpi.desc.skew':            { en: 'Ratio of mean to median across positive awards. 1.00× means a symmetric distribution; higher values mean a few very large awards are pulling the mean above the median.', hr: 'Omjer prosjeka i medijana nad pozitivnim dodjelama. 1.00× znaci simetricnu raspodjelu; visi brojevi znace da pojedinacne velike potpore povlace prosjek iznad medijana.' },

    'insights.open.hint':   { en: 'click anywhere for full analytics', hr: 'klikni bilo gdje za punu analitiku' },
    'insights.open.kicker': { en: 'global dataset', hr: 'globalni skup podataka' },

    'analytics.title':        { en: 'Registry analytics', hr: 'Analitika registra' },
    'analytics.subtitle':     { en: 'Global view across all available rows (independent from active filters)', hr: 'Globalni pregled svih dostupnih redaka (neovisno o aktivnim filterima)' },
    'analytics.overview':     { en: 'Registry overview', hr: 'Pregled registra' },
    'analytics.projects':     { en: 'Funded projects', hr: 'Financirani projekti' },
    'analytics.calls':        { en: 'Source calls', hr: 'Izvorni natječaji' },
    'analytics.unfunded':     { en: 'Unfunded mentions', hr: 'Spomenuti bez sredstava' },
    'analytics.yearly':       { en: 'Funding by year', hr: 'Financiranje po godini' },
    'analytics.program_mix':  { en: 'Programme mix by amount', hr: 'Raspodjela po programu (iznos)' },
    'analytics.category_mix': { en: 'Category mix by amount', hr: 'Raspodjela po kategoriji (iznos)' },
    'analytics.size_dist':    { en: 'Award-size distribution', hr: 'Raspodjela velicine iznosa' },
    'analytics.volatility':   { en: 'Year-over-year shifts', hr: 'Promjene iz godine u godinu' },
    'analytics.window':       { en: 'Data window notes', hr: 'Napomene o vremenskom rasponu' },
    'analytics.yoy.up':       { en: 'largest increase', hr: 'najveci rast' },
    'analytics.yoy.down':     { en: 'largest drop', hr: 'najveci pad' },
    'analytics.note.pre2009': { en: 'Rows exist before 2009 (earliest detected year is 2008).', hr: 'Postoje redci prije 2009. (najranija pronadena godina je 2008.).' },
    'analytics.note.current': { en: '{year} is likely partial (in-year data snapshot).', hr: '{year} je vjerojatno parcijalna godina (presjek usred godine).' },
    'analytics.note.stable':  { en: 'No special year-window caveats detected.', hr: 'Nema posebnih napomena za vremenski raspon.' },
    'analytics.studio.subtitle': {
      en: 'Contextual analysis with a like-for-like registry benchmark',
      hr: 'Kontekstualna analiza s usporedivom referentnom vrijednošću registra',
    },
    'analytics.loading': {
      en: 'Calculating this view from the registry…',
      hr: 'Izračunavam ovaj prikaz iz registra…',
    },
    'analytics.context.current': { en: 'Current scope', hr: 'Trenutačni opseg' },
    'analytics.context.benchmark': { en: 'Registry benchmark', hr: 'Referentni registar' },
    'analytics.context.global': { en: 'All registry records', hr: 'Svi zapisi registra' },
    'analytics.context.same_period': {
      en: 'All registry records in the same time window',
      hr: 'Svi zapisi registra u istom vremenskom rasponu',
    },
    'analytics.context.search': { en: 'search “{q}”', hr: 'pretraga „{q}”' },
    'analytics.context.scopes': { en: '{n} active scopes', hr: '{n} aktivnih opsega' },
    'analytics.context.filters': { en: '{n} active filters', hr: '{n} aktivnih filtara' },
    'analytics.chapter.overview': { en: 'Overview', hr: 'Pregled' },
    'analytics.chapter.time': { en: 'Time', hr: 'Vrijeme' },
    'analytics.chapter.distribution': { en: 'Award distribution', hr: 'Raspodjela potpora' },
    'analytics.chapter.mix': { en: 'Programme mix', hr: 'Struktura programa' },
    'analytics.chapter.concentration': { en: 'Recipient concentration', hr: 'Koncentracija korisnika' },
    'analytics.chapter.lifecycles': { en: 'Project lifecycles', hr: 'Životni ciklusi projekata' },
    'analytics.chapter.methodology': { en: 'Data & methodology', hr: 'Podaci i metodologija' },
    'analytics.overview.diagnosis': { en: 'What distinguishes this scope', hr: 'Što izdvaja ovaj opseg' },
    'analytics.overview.findings': { en: 'Key registry findings', hr: 'Ključni nalazi registra' },
    'analytics.overview.no_difference': {
      en: 'This is the complete benchmark population. The notes below describe the registry itself.',
      hr: 'Ovo je cijela referentna populacija. Napomene u nastavku opisuju sam registar.',
    },
    'analytics.metric.repeat': { en: 'Multi-decision projects', hr: 'Projekti s više odluka' },
    'analytics.metric.gini': { en: 'Recipient Gini', hr: 'Gini korisnika' },
    'analytics.metric.not_available': { en: 'not available', hr: 'nije dostupno' },
    'analytics.metric.vs_benchmark': { en: 'vs benchmark', hr: 'prema referentnoj vrijednosti' },
    'analytics.finding.scopeShare': {
      en: 'This scope contains {amount} of recorded funding and {rows} of decisions in the same time window.',
      hr: 'Ovaj opseg sadrži {amount} zabilježenih sredstava i {rows} odluka u istom vremenskom rasponu.',
    },
    'analytics.finding.medianRatio.up': {
      en: 'Its typical award is {ratio}× the registry median ({current} vs {benchmark}).',
      hr: 'Tipična potpora je {ratio}× veća od medijana registra ({current} prema {benchmark}).',
    },
    'analytics.finding.medianRatio.down': {
      en: 'Its typical award is {ratio}× the registry median ({current} vs {benchmark}).',
      hr: 'Tipična potpora iznosi {ratio}× medijana registra ({current} prema {benchmark}).',
    },
    'analytics.finding.repeatDelta': {
      en: 'Projects receive multiple recorded decisions {direction} often here ({current} vs {benchmark}).',
      hr: 'Projekti ovdje dobivaju više zabilježenih odluka {direction} često ({current} prema {benchmark}).',
    },
    'analytics.finding.direction.more': { en: 'more', hr: 'češće' },
    'analytics.finding.direction.less': { en: 'less', hr: 'rjeđe' },
    'analytics.finding.concentrationDelta': {
      en: 'Attributed funding is {direction} concentrated than the benchmark (Gini {current} vs {benchmark}).',
      hr: 'Pripisana sredstva su {direction} koncentrirana od referentne vrijednosti (Gini {current} prema {benchmark}).',
    },
    'analytics.finding.concentration.more': { en: 'more', hr: 'više' },
    'analytics.finding.concentration.less': { en: 'less', hr: 'manje' },
    'analytics.finding.programmeOverindex': {
      en: '{programme} is over-represented by {delta} percentage points in this scope.',
      hr: '{programme} je u ovom opsegu zastupljeniji za {delta} postotnih bodova.',
    },
    'analytics.finding.latestChange': {
      en: 'The latest complete year, {year}, changed {percent} from {previousYear}.',
      hr: 'Posljednja potpuna godina, {year}., promijenila se {percent} u odnosu na {previousYear}.',
    },
    'analytics.finding.distributionSkew': {
      en: 'The mean award is {ratio}× the median, showing how strongly large awards pull the average upward.',
      hr: 'Prosječna potpora je {ratio}× veća od medijana, što pokazuje koliko velike potpore podižu prosjek.',
    },
    'analytics.finding.leadingProgramme': {
      en: '{programme} accounts for {share} of recorded funding.',
      hr: '{programme} čini {share} zabilježenih sredstava.',
    },
    'analytics.selection.label': { en: 'Selected segment', hr: 'Odabrani segment' },
    'analytics.selection.show': { en: 'Show these records', hr: 'Prikaži ove zapise' },
    'analytics.selection.clear': { en: 'Clear selection', hr: 'Očisti odabir' },
    'analytics.selection.project_hint': {
      en: 'Choose an individual project below to continue in the registry.',
      hr: 'Odaberi pojedinačni projekt u nastavku za nastavak u registru.',
    },
    'analytics.series.current': { en: 'Current scope', hr: 'Trenutačni opseg' },
    'analytics.series.benchmark': { en: 'Registry benchmark', hr: 'Referentni registar' },
    'analytics.table.open': { en: 'Show exact data table', hr: 'Prikaži tablicu točnih podataka' },
    'analytics.control.amount': { en: 'Amount', hr: 'Iznos' },
    'analytics.control.count': { en: 'Decisions', hr: 'Odluke' },
    'analytics.control.median': { en: 'Median', hr: 'Medijan' },
    'analytics.control.programmes': { en: 'Programmes', hr: 'Programi' },
    'analytics.control.categories': { en: 'Categories', hr: 'Kategorije' },
    'analytics.control.rounds': { en: 'Rounds', hr: 'Rokovi' },
    'analytics.time.title': { en: 'Funding through time', hr: 'Financiranje kroz vrijeme' },
    'analytics.time.note': {
      en: 'The benchmark keeps the same time window while removing programme, category, round, search, and entity scopes.',
      hr: 'Referentna vrijednost zadržava isti vremenski raspon, a uklanja program, kategoriju, rok, pretragu i opsege subjekata.',
    },
    'analytics.time.partial': { en: '{year} is a partial year.', hr: '{year}. je djelomična godina.' },
    'analytics.distribution.title': { en: 'How award sizes are distributed', hr: 'Kako su raspoređene veličine potpora' },
    'analytics.distribution.note': {
      en: 'Positive recorded amounts only. Select a band to inspect its records.',
      hr: 'Samo pozitivni zabilježeni iznosi. Odaberi raspon za pregled zapisa.',
    },
    'analytics.distribution.percentiles': { en: 'Percentile ledger', hr: 'Pregled percentila' },
    'analytics.distribution.p25': { en: 'P25', hr: 'P25' },
    'analytics.distribution.p50': { en: 'Median', hr: 'Medijan' },
    'analytics.distribution.p75': { en: 'P75', hr: 'P75' },
    'analytics.distribution.p90': { en: 'P90', hr: 'P90' },
    'analytics.distribution.p95': { en: 'P95', hr: 'P95' },
    'analytics.distribution.p99': { en: 'P99', hr: 'P99' },
    'analytics.mix.title': { en: 'Where the money sits', hr: 'Gdje se sredstva nalaze' },
    'analytics.mix.heatmap': { en: 'Programme activity by year', hr: 'Aktivnost programa po godini' },
    'analytics.mix.other': { en: 'Other / unattributed', hr: 'Ostalo / nepripisano' },
    'analytics.concentration.title': { en: 'How attributed funding is distributed', hr: 'Kako su raspoređena pripisana sredstva' },
    'analytics.concentration.definition': {
      en: 'Recipient = recorded production company; otherwise recorded applicant. Concentration uses attributed funding as its denominator.',
      hr: 'Korisnik = zabilježena produkcijska kuća; u suprotnom zabilježeni prijavitelj. Koncentracija koristi pripisana sredstva kao nazivnik.',
    },
    'analytics.concentration.coverage': {
      en: '{amount} of funding value and {rows} of decisions have an attributable recipient.',
      hr: '{amount} vrijednosti sredstava i {rows} odluka imaju pripisivog korisnika.',
    },
    'analytics.concentration.unavailable': {
      en: 'Concentration is withheld because this scope has fewer than 10 recipients or less than 60% attributed funding coverage.',
      hr: 'Koncentracija se ne prikazuje jer opseg ima manje od 10 korisnika ili manje od 60% pokrivenosti pripisanim sredstvima.',
    },
    'analytics.concentration.lorenz': { en: 'Lorenz curve', hr: 'Lorenzova krivulja' },
    'analytics.concentration.top_shares': { en: 'Share held by top recipients', hr: 'Udio najvećih korisnika' },
    'analytics.concentration.recipients': { en: 'Recipients', hr: 'Korisnici' },
    'analytics.concentration.top_recipients': { en: 'Largest attributed recipients', hr: 'Najveći pripisani korisnici' },
    'analytics.concentration.pareto': {
      en: '{n} recipients account for half of attributed funding.',
      hr: '{n} korisnika čini polovicu pripisanih sredstava.',
    },
    'analytics.lifecycle.title': { en: 'How projects move through recorded support', hr: 'Kako se projekti kreću kroz zabilježenu potporu' },
    'analytics.lifecycle.multi_programme': { en: 'Projects in multiple programmes', hr: 'Projekti u više programa' },
    'analytics.lifecycle.duration': { en: 'Median observed duration', hr: 'Medijan zabilježenog trajanja' },
    'analytics.lifecycle.years': { en: '{n} years', hr: '{n} godina' },
    'analytics.lifecycle.transitions': { en: 'Observed stage pathways', hr: 'Zabilježeni prijelazi faza' },
    'analytics.lifecycle.note': {
      en: 'These are observed links between funded records, not application conversion or success rates.',
      hr: 'Ovo su zabilježene veze među financiranim zapisima, a ne stope prolaza prijava ili uspješnosti.',
    },
    'analytics.lifecycle.projects': { en: '{n} matching projects', hr: '{n} odgovarajućih projekata' },
    'analytics.stage.script': { en: 'Script', hr: 'Scenarij' },
    'analytics.stage.development': { en: 'Development', hr: 'Razvoj' },
    'analytics.stage.production': { en: 'Production', hr: 'Proizvodnja' },
    'analytics.stage.distribution': { en: 'Distribution', hr: 'Distribucija' },
    'analytics.stage.other': { en: 'Other support', hr: 'Ostala potpora' },
    'analytics.data.title': { en: 'What the dataset can support', hr: 'Što skup podataka može pouzdano prikazati' },
    'analytics.data.field': { en: 'Field', hr: 'Polje' },
    'analytics.data.rows': { en: 'Decision coverage', hr: 'Pokrivenost odluka' },
    'analytics.data.amount': { en: 'Funding-value coverage', hr: 'Pokrivenost vrijednosti sredstava' },
    'analytics.data.sources': { en: 'Source and audit coverage', hr: 'Pokrivenost izvora i provjere' },
    'analytics.data.formulas': { en: 'Definitions and formulas', hr: 'Definicije i formule' },
    'analytics.data.limitations': { en: 'Important limitations', hr: 'Važna ograničenja' },
    'analytics.data.no_acceptance': {
      en: 'Application acceptance rates are not calculated because non-award records are incomplete.',
      hr: 'Stope prolaza prijava ne izračunavaju se jer zapisi o neodobrenim prijavama nisu potpuni.',
    },
    'analytics.data.creator_sparse': {
      en: 'Director, writer, and narrative fields are incomplete. Their coverage is shown before any interpretation.',
      hr: 'Polja redatelja, scenarista i obrazloženja nisu potpuna. Pokrivenost se prikazuje prije svake interpretacije.',
    },
    'analytics.data.currency': {
      en: 'HRK amounts use the fixed conversion 1 EUR = {rate} HRK. Values are nominal and not inflation-adjusted.',
      hr: 'Iznosi u HRK koriste fiksni tečaj 1 EUR = {rate} HRK. Vrijednosti su nominalne i nisu prilagođene inflaciji.',
    },
    'analytics.data.source_urls': {
      en: '{found} of {total} result documents have a canonical HAVC source URL.',
      hr: '{found} od {total} dokumenata rezultata ima kanonski HAVC izvorni URL.',
    },
    'analytics.data.audit': {
      en: 'Automated official-total checks: {pass} pass, {warn} warnings, {fail} failures.',
      hr: 'Automatske provjere službenih zbrojeva: {pass} prolazi, {warn} upozorenja, {fail} pogrešaka.',
    },
    'analytics.data.formula.median': {
      en: 'Median: the middle positive award after sorting amounts.',
      hr: 'Medijan: srednja pozitivna potpora nakon sortiranja iznosa.',
    },
    'analytics.data.formula.gini': {
      en: 'Gini: inequality across cumulative attributed funding per recipient, from 0% equal to 100% maximally concentrated.',
      hr: 'Gini: nejednakost kumulativnih pripisanih sredstava po korisniku, od 0% jednakosti do 100% maksimalne koncentracije.',
    },
    'analytics.data.formula.lifecycle': {
      en: 'Lifecycle: records sharing one normalized project family, ordered by year and mapped to broad support stages.',
      hr: 'Životni ciklus: zapisi iste normalizirane projektne porodice, poredani po godini i mapirani u široke faze potpore.',
    },
    'analytics.empty.title': { en: 'No records in this scope', hr: 'Nema zapisa u ovom opsegu' },
    'analytics.empty.body': {
      en: 'Close analytics and remove a filter or scope to restore a measurable population.',
      hr: 'Zatvori analitiku i ukloni filtar ili opseg kako bi se vratila mjerljiva populacija.',
    },

    'timeline.projects.title': {
      en: 'Project funding timeline',
      hr: 'Vremenska crta financiranja projekata',
    },
    'timeline.projects.summary': {
      en: '{n} funded projects in the current scope',
      hr: '{n} financiranih projekata u trenutačnom opsegu',
    },
    'timeline.projects.legend': {
      en: 'Bubble area represents complete lifetime funding',
      hr: 'Površina kruga prikazuje ukupno financiranje kroz cijeli vijek projekta',
    },
    'timeline.projects.placement': {
      en: 'Placed by the latest matching record',
      hr: 'Smješteno prema zadnjem zapisu koji odgovara filtrima',
    },
    'timeline.projects.hint': {
      en: 'Hover or use arrow keys to inspect. Click or press Enter to open a project.',
      hr: 'Prijeđi pokazivačem ili koristi strelice za pregled. Klikni ili pritisni Enter za otvaranje projekta.',
    },
    'timeline.projects.empty': {
      en: 'No projects with a positive recorded lifetime amount match the current filters.',
      hr: 'Nijedan projekt s pozitivnim zabilježenim ukupnim iznosom ne odgovara trenutačnim filtrima.',
    },
    'timeline.projects.lifetime': {
      en: 'Lifetime funding',
      hr: 'Ukupno financiranje',
    },
    'timeline.projects.matching': {
      en: '{n} matching decisions',
      hr: '{n} odluka u opsegu',
    },
    'timeline.projects.keyboard': {
      en: 'Project funding timeline with {n} projects. Use arrow keys to move between projects and Enter to open the selected project.',
      hr: 'Vremenska crta financiranja s {n} projekata. Koristi strelice za pomicanje među projektima i Enter za otvaranje odabranog projekta.',
    },

    'scope.label':    { en: 'scope', hr: 'opseg' },
    // Short, because it now shares a line with the live record count instead of
    // owning a 40px band whose only job was to say nothing was happening. The
    // "click a bar or a group row" hint moved onto the marks that do the work.
    'scope.empty':    { en: 'whole registry', hr: 'cijeli registar' },
    'scope.clearAll': { en: 'clear all', hr: 'očisti sve' },
    'scope.kind.producer':  { en: 'producer',  hr: 'producent' },
    'scope.kind.director':  { en: 'director',  hr: 'redatelj' },
    'scope.kind.writer':    { en: 'writer',    hr: 'scenarist' },
    'scope.kind.years':     { en: 'year',      hr: 'godina' },
    'scope.kind.program':   { en: 'programme', hr: 'program' },
    'scope.kind.cat':       { en: 'category',  hr: 'kategorija' },
    'scope.kind.rok':       { en: 'round',     hr: 'rok' },
    'scope.kind.recipient': { en: 'recipient', hr: 'korisnik' },
    'scope.kind.amount':    { en: 'amount',    hr: 'iznos' },
    'scope.kind.project':   { en: 'project',   hr: 'projekt' },
    'scope.kind.q':         { en: 'search',    hr: 'traži' },

    'year.single': { en: 'only {year}', hr: 'samo {year}.' },
    'timeline.collapse': { en: 'hide timeline', hr: 'sakrij vremensku crtu' },
    'timeline.expand':   { en: 'show timeline', hr: 'prikaži vremensku crtu' },
    'timeline.full':     { en: 'enlarge timeline', hr: 'povećaj vremensku crtu' },
    'timeline.compact':  { en: 'shrink timeline', hr: 'smanji vremensku crtu' },

    'pivot.label':     { en: 'Group by', hr: 'Grupiraj po' },
    'pivot.projects':  { en: 'Projects',  hr: 'Projekti' },
    'pivot.decisions': { en: 'Decisions', hr: 'Odluke' },
    'pivot.producer':  { en: 'Producer',  hr: 'Producent' },
    'pivot.director':  { en: 'Director',  hr: 'Redatelj' },
    'pivot.writer':    { en: 'Writer',    hr: 'Scenarist' },
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
    'col.untitled':  { en: '(untitled)',  hr: '(bez naslova)' },
    'col.unattributed': { en: '(unattributed)', hr: '(neidentificirano)' },
    'col.unattributed.producer': { en: '(no producer recorded)', hr: '(producent nije zabilježen)' },
    'col.unattributed.director': { en: '(no director recorded)', hr: '(redatelj nije zabilježen)' },
    'col.unattributed.writer':   { en: '(no writer recorded)',   hr: '(scenarist nije zabilježen)' },

    'status.showing': { en: 'Showing', hr: 'Prikazano' },
    'status.of':      { en: 'of',      hr: 'od' },
    'status.rows':    { en: 'records', hr: 'zapisa' },
    'status.total':   { en: 'total',   hr: 'ukupno' },
    'status.coverage':{ en: 'HAVC 2009–{maxYear}', hr: 'HAVC 2009.–{maxYear}.' },
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
    'profile.events_count': { en: '{n} events', hr: '{n} događaja' },
    'profile.decision_tag': { en: 'decision', hr: 'odluka' },
    'profile.scope_short': { en: 'scope', hr: 'suzi' },
    'amount.original_suffix': { en: '(orig.)', hr: '(izvorno)' },
    'pdf.preview':     { en: 'preview', hr: 'pregled' },
    'pdf.missing':     { en: 'no canonical PDF on file', hr: 'nema službenog PDF-a' },
    'pdf.fallback_title': { en: 'PDF', hr: 'PDF' },
    'pdf.preview_title': { en: 'HAVC source preview', hr: 'Pregled HAVC izvora' },
    'pdf.havc_source': { en: 'HAVC source', hr: 'HAVC izvor' },
    'pdf.url_label':   { en: 'HAVC URL', hr: 'HAVC URL' },
    'pdf.source_note': { en: 'Directly loaded from havc.hr for source validation.', hr: 'Izravno učitano s havc.hr radi provjere izvora.' },
    'pdf.open_new_tab':{ en: 'open in new tab', hr: 'otvori u novoj kartici' },
    'pdf.download':    { en: 'download', hr: 'preuzmi' },

    'unfunded.title': { en: 'Discussed but never funded',
                        hr: 'Spominjani, ali nikad financirani' },
    'unfunded.note':  { en: 'Narrative mentions and explicit non-awards are listed only when no verified award exists for the same project family.',
                        hr: 'Spomeni u obrazloženjima i izričito neodobrene prijave prikazuju se samo kada ista projektna porodica nema potvrđenu potporu.' },
    'unfunded.sources_count': { en: '{n} src', hr: '{n} izv.' },
    'modal.close':    { en: 'close',  hr: 'zatvori' },
    'view.about.load_error': { en: 'failed to load about content — see console', hr: 'učitavanje sadržaja stranice O autoru nije uspjelo — pogledaj konzolu' },
    'view.process.load_error': { en: 'failed to load process content — see console', hr: 'učitavanje sadržaja stranice Proces nije uspjelo — pogledaj konzolu' },
    'process.diagram_aria': { en: 'pipeline iteration loop', hr: 'petlja iteracija obrade' },
    'process.timeline.problem': { en: 'Problem', hr: 'Problem' },
    'process.timeline.decision': { en: 'Decision', hr: 'Odluka' },
    'process.timeline.result': { en: 'Result', hr: 'Rezultat' },
    'process.timeline.more_context': { en: 'More context', hr: 'Više konteksta' },
    'helper.tip.label': { en: 'HAVC helper', hr: 'HAVC asistent' },
    'helper.tip.title': { en: 'Browse HAVC directly', hr: 'Pregledavaj HAVC izravno' },
    'helper.tip.body': {
      en: 'HAVC Companion is meant for easier browsing of havc.hr public-calls pages directly, without using this Sredstva web app.',
      hr: 'HAVC asistent služi za lakše pregledavanje stranica javnih poziva na havc.hr izravno, bez korištenja web aplikacije Sredstva.',
    },
    'helper.tip.open_store': { en: 'Open in Chrome Web Store', hr: 'Otvori u Chrome Web Storeu' },
    'helper.tip.store_aria': { en: 'Open HAVC Companion in Chrome Web Store', hr: 'Otvori HAVC asistent u Chrome Web Storeu' },
    'repo.open_aria': { en: 'Open GitHub repository', hr: 'Otvori GitHub repozitorij' },
    'boot.loading_registry': { en: 'loading registry…', hr: 'učitavanje registra…' },
    'boot.load_data_error': { en: 'failed to load data.json — see console', hr: 'učitavanje data.json nije uspjelo — pogledaj konzolu' },

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

  function syncDocumentI18n(lang) {
    document.documentElement.lang = lang;
    document.title = t('app.title', lang);
  }

  const UNATTRIBUTED_KEY = '__unattributed__';
  const SIZE_BUCKETS = [0, 1000, 5000, 20000, 50000, 100000, 250000, 500000, 1000000, Infinity];
  const HAVC_HELPER_STORE_URL = 'https://chromewebstore.google.com/detail/havc-companion-%E2%80%94-javni-po/jjfmjbmebnljefefcgfdjljenilgmfpg';
  const HAVC_REPO_URL = 'https://github.com/matijarma/havc-explorer';

  // ═══ 2. Data loader + indexers ══════════════════════════════════════
  let DATA = null;
  let docById = new Map();
  let narrativeById = new Map();
  let decisionById = new Map();
  let searchIndex = new Map();           // token -> Set<rowIdx>
  let rowNormTitles = [];                // rowIdx -> project family key
  let projectIndex = new Map();          // family key -> aggregated project record
  let projectAliasIndex = new Map();     // normalized title alias -> Set<family key>
  let GLOBAL_ANALYTICS = null;           // global dataset analytics snapshot
  let SANITY_REPORT = null;              // optional sanity report summary

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
  function projectKeyForRow(row) {
    const familyId = typeof row.project_family_id === 'string' ? row.project_family_id.trim() : '';
    return familyId || normTitle(row.family_title || row.title);
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
      project_links: asArray(doc.project_links).map((linkAny) => {
        const link = asObject(linkAny);
        return {
          source_title: link.source_title || null,
          family_id: link.family_id || null,
          family_title: link.family_title || null,
          match_status: link.match_status || 'unmatched',
          method: link.method || null,
          confidence: link.confidence || null,
        };
      }),
    };
  }

  function processResultsRecord(rec, id) {
    const src = asObject(rec.source);
    const doc = asObject(rec.document);
    const totals = asObject(rec.totals);
    const filename = src.filename || src.filename_decoded || null;
    const sourceUrl = src.source_url || src.url || null;

    if (isNonFundingDoc(filename)) return { doc: null, rows: [], nonAwards: [] };

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
    const nonAwards = [];
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

        const fundingStatus = row.funding_status || null;
        const familyId = typeof row.project_family_id === 'string'
          ? row.project_family_id
          : null;
        const familyTitle = typeof row.project_family_title === 'string'
          ? row.project_family_title
          : null;
        const outRow = {
          doc: id,
          row_id: row.row_id || null,
          n: row.row_number != null ? row.row_number : nCounter,
          title,
          family_title: familyTitle,
          project_family_id: familyId,
          applicant: row.applicant || null,
          producer: row.production_company || row.entity || null,
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
          funding_status: fundingStatus,
        };
        if (fundingStatus === 'awarded') {
          outRows.push(outRow);
        } else if (fundingStatus === 'not_awarded') {
          nonAwards.push(outRow);
        }
      });
    });

    docEntry.row_count = outRows.length;
    docEntry.source_row_count = nCounter;
    return { doc: docEntry, rows: outRows, nonAwards };
  }

  function buildProjectEvents(narratives, decisions) {
    const events = {};
    const seenByKey = new Map();

    function add(kind, doc, projectTitle, link) {
      const familyId = link && link.family_id ? link.family_id : null;
      const key = familyId || normTitle(projectTitle);
      if (!key) return;
      const evt = {
        type: kind,
        id: doc.id,
        year: doc.year,
        program: doc.program,
        summary: doc.summary,
        project: projectTitle,
        family_id: familyId,
        family_title: link && link.family_title ? link.family_title : null,
        match_status: link && link.match_status ? link.match_status : 'unmatched',
      };

      let seen = seenByKey.get(key);
      if (!seen) { seen = new Set(); seenByKey.set(key, seen); }
      const sig = kind + '|' + doc.id + '|' + projectTitle;
      if (seen.has(sig)) return;
      seen.add(sig);

      if (!events[key]) events[key] = [];
      events[key].push(evt);
    }

    function addDocument(kind, doc) {
      const links = asArray(doc.project_links);
      if (links.length) {
        links.forEach((link) => add(
          kind,
          doc,
          link.source_title || link.family_title || '',
          link,
        ));
        return;
      }
      asArray(doc.referenced_projects).forEach((title) => add(kind, doc, title, null));
    }

    narratives.forEach((doc) => addDocument('narrative', doc));
    decisions.forEach((doc) => addDocument('decision', doc));
    return events;
  }

  function buildUnfundedMentions(rows, narratives, decisions, nonAwards) {
    const awardedFamilyIds = new Set();
    const awardedTitles = new Set();
    rows.forEach((r) => {
      if (r.project_family_id) awardedFamilyIds.add(r.project_family_id);
      for (const value of [r.title, r.family_title]) {
        const key = normTitle(value);
        if (key) awardedTitles.add(key);
      }
    });

    const bucket = new Map();
    function isFunded(familyId, title) {
      if (familyId && awardedFamilyIds.has(familyId)) return true;
      const titleKey = normTitle(title);
      return !!titleKey && awardedTitles.has(titleKey);
    }
    function entryFor(familyId, title) {
      const titleKey = normTitle(title);
      if (!titleKey || isFunded(familyId, title)) return null;
      const key = familyId || ('title:' + titleKey);
      let entry = bucket.get(key);
      if (!entry) {
        entry = {
          key,
          family_id: familyId || null,
          title,
          narratives: [],
          decisions: [],
          non_awards: [],
          sources: [],
          first_year: null,
        };
        bucket.set(key, entry);
      }
      return entry;
    }
    function addYear(entry, year) {
      if (!entry || !Number.isInteger(year)) return;
      if (entry.first_year == null || year < entry.first_year) entry.first_year = year;
    }
    function addSource(entry, sourceKey) {
      if (entry && !entry.sources.includes(sourceKey)) entry.sources.push(sourceKey);
    }

    asArray(nonAwards).forEach((row) => {
      const entry = entryFor(
        row.project_family_id,
        row.family_title || row.title,
      );
      if (!entry) return;
      if (!entry.non_awards.includes(row.doc)) entry.non_awards.push(row.doc);
      addSource(entry, 'result:' + row.doc);
      addYear(entry, row.year);
    });

    function addDocument(kind, doc) {
      const links = asArray(doc.project_links);
      const values = links.length
        ? links.map((link) => ({
            title: link.family_title || link.source_title,
            familyId: link.family_id || null,
            matchStatus: link.match_status || 'unmatched',
          }))
        : asArray(doc.referenced_projects).map((title) => ({
            title,
            familyId: null,
            matchStatus: 'unmatched',
          }));
      values.forEach((item) => {
        if (item.matchStatus === 'awarded' || isFunded(item.familyId, item.title)) return;
        const entry = entryFor(item.familyId, item.title);
        if (!entry) return;
        const target = kind === 'narrative' ? entry.narratives : entry.decisions;
        if (!target.includes(doc.id)) target.push(doc.id);
        addSource(entry, kind + ':' + doc.id);
        addYear(entry, doc.year);
      });
    }

    narratives.forEach((doc) => addDocument('narrative', doc));
    decisions.forEach((doc) => addDocument('decision', doc));

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
    const nonAwards = [];
    const usedIds = new Set();

    asArray(records).forEach((rec, idx) => {
      const r = asObject(rec);
      const docType = r.doc_type;
      const id = makeRecordId(r, idx, usedIds);

      if (docType === 'results_table') {
        const out = processResultsRecord(r, id);
        if (out.doc) docs.push(out.doc);
        rows.push(...out.rows);
        nonAwards.push(...out.nonAwards);
      } else if (docType === 'narrative') {
        narratives.push(extractEventDoc(r, id));
      } else if (docType === 'decision') {
        decisions.push(extractEventDoc(r, id));
      }
    });

    const flagged = flagOutliers(rows);
    const projectEvents = buildProjectEvents(narratives, decisions);
    const unfundedMentions = buildUnfundedMentions(
      rows,
      narratives,
      decisions,
      nonAwards,
    );
    const facets = deriveFacets(rows);

    return {
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      hrk_to_eur: HRK_TO_EUR,
      facets,
      rows,
      docs,
      narratives,
      decisions,
      non_awards: nonAwards,
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
    const nonAwards = asArray(base.non_awards);
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
      non_awards: nonAwards,
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
  async function loadOptionalSanityReport() {
    const urls = [
      'havc/10_sanity_check_official.json',
      '../reports/10_sanity_check_official.json',
      './reports/10_sanity_check_official.json',
      'reports/10_sanity_check_official.json',
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        return asObject(sanitizeDeep(await res.json()));
      } catch (_) {
        // Optional source: silently continue to fallback text.
      }
    }
    return null;
  }
  async function loadData() {
    const [res, sanityReport] = await Promise.all([
      fetch('havc/data.json'),
      loadOptionalSanityReport(),
    ]);
    const raw = sanitizeDeep(await res.json());
    DATA = coerceDashboardData(raw);
    SANITY_REPORT = sanityReport;
    docById = new Map(DATA.docs.map(d => [d.id, d]));
    narrativeById = new Map(DATA.narratives.map(n => [n.id, n]));
    decisionById = new Map(DATA.decisions.map(d => [d.id, d]));

    searchIndex = new Map();
    projectAliasIndex = new Map();
    rowNormTitles = new Array(DATA.rows.length);
    DATA.rows.forEach((r, i) => {
      const projectKey = projectKeyForRow(r);
      rowNormTitles[i] = projectKey;
      for (const value of [r.title, r.family_title]) {
        const alias = normTitle(value);
        if (!alias || !projectKey) continue;
        let keys = projectAliasIndex.get(alias);
        if (!keys) { keys = new Set(); projectAliasIndex.set(alias, keys); }
        keys.add(projectKey);
      }
      const fields = [
        r.title,
        r.family_title,
        r.director,
        r.producer,
        r.applicant,
        r.writer,
      ];
      for (const f of fields) {
        for (const tok of tokens(f || '')) {
          let bucket = searchIndex.get(tok);
          if (!bucket) { bucket = new Set(); searchIndex.set(tok, bucket); }
          bucket.add(i);
        }
      }
    });

    GLOBAL_ANALYTICS = buildGlobalAnalytics(DATA.rows);
    buildProjectIndex();
  }

  function buildProjectIndex() {
    projectIndex = new Map();
    DATA.rows.forEach((r, i) => {
      const key = rowNormTitles[i] || UNATTRIBUTED_KEY;
      let p = projectIndex.get(key);
      if (!p) {
        p = {
          title: r.family_title || r.title || '',
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

  function percentileFromSorted(sorted, p) {
    if (!sorted.length) return 0;
    const i = Math.floor((sorted.length - 1) * p);
    return sorted[i];
  }

  function giniFromSorted(sorted) {
    if (!sorted.length) return 0;
    let weighted = 0;
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
      const x = sorted[i];
      sum += x;
      weighted += (i + 1) * x;
    }
    if (!sum) return 0;
    const n = sorted.length;
    return (2 * weighted) / (n * sum) - ((n + 1) / n);
  }

  function topShare(projectEntries, n, total) {
    if (!total) return 0;
    let s = 0;
    const limit = Math.min(n, projectEntries.length);
    for (let i = 0; i < limit; i++) s += projectEntries[i][1];
    return s / total;
  }

  function buildGlobalAnalytics(rows) {
    const positiveAmounts = [];
    const byYearAmount = new Map();
    const byYearCount = new Map();
    const byProgramAmount = new Map();
    const byProgramCount = new Map();
    const byCatAmount = new Map();
    const byCatCount = new Map();
    const sizeHistogram = new Array(SIZE_BUCKETS.length - 1).fill(0);
    const projectTotals = new Map();
    const projectRoundCounts = new Map();
    const producerTotals = new Map();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const amt = r.amount_eur || 0;
      const year = r.year;
      const program = r.program || 'other';
      const cat = r.cat_type || 'other';

      byProgramCount.set(program, (byProgramCount.get(program) || 0) + 1);
      byProgramAmount.set(program, (byProgramAmount.get(program) || 0) + amt);
      byCatCount.set(cat, (byCatCount.get(cat) || 0) + 1);
      byCatAmount.set(cat, (byCatAmount.get(cat) || 0) + amt);

      if (year != null) {
        byYearCount.set(year, (byYearCount.get(year) || 0) + 1);
        byYearAmount.set(year, (byYearAmount.get(year) || 0) + amt);
      }

      if (amt > 0) {
        positiveAmounts.push(amt);
        for (let b = 0; b < SIZE_BUCKETS.length - 1; b++) {
          if (amt >= SIZE_BUCKETS[b] && amt < SIZE_BUCKETS[b + 1]) {
            sizeHistogram[b] += 1;
            break;
          }
        }
        const pKey = rowNormTitles[i] || '';
        if (pKey && pKey !== UNATTRIBUTED_KEY) {
          projectTotals.set(pKey, (projectTotals.get(pKey) || 0) + amt);
          projectRoundCounts.set(pKey, (projectRoundCounts.get(pKey) || 0) + 1);
        }
        if (r.producer) {
          producerTotals.set(r.producer, (producerTotals.get(r.producer) || 0) + amt);
        }
      }
    }

    const sortedAmounts = positiveAmounts.slice().sort((a, b) => a - b);
    const totalAmount = positiveAmounts.reduce((s, x) => s + x, 0);
    const awardedCount = positiveAmounts.length;
    const meanAmount = awardedCount ? (totalAmount / awardedCount) : 0;
    const medianAmount = median(positiveAmounts);
    const p90Amount = percentileFromSorted(sortedAmounts, 0.90);
    const p95Amount = percentileFromSorted(sortedAmounts, 0.95);
    const p99Amount = percentileFromSorted(sortedAmounts, 0.99);
    const maxAmount = sortedAmounts.length ? sortedAmounts[sortedAmounts.length - 1] : 0;
    const meanMedianRatio = medianAmount > 0 ? (meanAmount / medianAmount) : null;

    const yearSeries = [...byYearCount.keys()]
      .sort((a, b) => a - b)
      .map((year) => ({
        year,
        amount: byYearAmount.get(year) || 0,
        count: byYearCount.get(year) || 0,
      }));

    const minYear = yearSeries.length ? yearSeries[0].year : null;
    const maxYear = yearSeries.length ? yearSeries[yearSeries.length - 1].year : null;
    const currentYear = new Date().getFullYear();

    const yoy = [];
    for (let i = 1; i < yearSeries.length; i++) {
      const prev = yearSeries[i - 1];
      const cur = yearSeries[i];
      const delta = cur.amount - prev.amount;
      yoy.push({
        year: cur.year,
        delta,
        pct: prev.amount > 0 ? (delta / prev.amount) : null,
      });
    }
    const yoyForExtrema = (maxYear != null && maxYear === currentYear)
      ? yoy.filter((x) => x.year !== currentYear)
      : yoy;
    const maxGain = yoyForExtrema.length
      ? yoyForExtrema.reduce((best, cur) => cur.delta > best.delta ? cur : best, yoyForExtrema[0])
      : null;
    const maxDrop = yoyForExtrema.length
      ? yoyForExtrema.reduce((best, cur) => cur.delta < best.delta ? cur : best, yoyForExtrema[0])
      : null;

    function mixFrom(amountMap, countMap) {
      return [...amountMap.entries()]
        .map(([key, amount]) => ({
          key,
          amount,
          count: countMap.get(key) || 0,
          share: totalAmount ? (amount / totalAmount) : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
    }

    const programMix = mixFrom(byProgramAmount, byProgramCount);
    const categoryMix = mixFrom(byCatAmount, byCatCount);
    const projectEntries = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);

    const producerEntries = [...producerTotals.entries()].sort((a, b) => b[1] - a[1]);
    const producerSortedAsc = [...producerTotals.values()].sort((a, b) => a - b);
    const producerGini = giniFromSorted(producerSortedAsc);

    let paretoAcc = 0;
    let pareto50Count = 0;
    for (let i = 0; i < producerEntries.length; i++) {
      paretoAcc += producerEntries[i][1];
      pareto50Count = i + 1;
      if (totalAmount > 0 && paretoAcc / totalAmount >= 0.5) break;
    }
    const pareto50 = {
      count: producerEntries.length ? pareto50Count : 0,
      share: producerTotals.size ? (pareto50Count / producerTotals.size) : 0,
    };

    const roundCounts = [...projectRoundCounts.values()];
    const repeatFundedShare = roundCounts.length
      ? roundCounts.filter((n) => n > 1).length / roundCounts.length
      : 0;
    const medianRounds = roundCounts.length ? median(roundCounts) : 0;
    const largestProjectTotal = projectEntries.length ? projectEntries[0][1] : 0;

    return {
      rowCount: rows.length,
      awardedCount,
      totalAmount,
      meanAmount,
      medianAmount,
      p90Amount,
      p95Amount,
      p99Amount,
      maxAmount,
      meanMedianRatio,
      gini: producerGini,
      yearSeries,
      sizeHistogram,
      programMix,
      categoryMix,
      projectCount: projectEntries.length,
      uniqueProducers: producerTotals.size,
      concentration: {
        top10: topShare(producerEntries, 10, totalAmount),
        top50: topShare(producerEntries, 50, totalAmount),
        top100: topShare(producerEntries, 100, totalAmount),
      },
      pareto50,
      repeatFundedShare,
      medianRounds,
      largestProjectTotal,
      yoy: {
        maxGain,
        maxDrop,
      },
      flags: {
        pre2009Present: minYear != null && minYear < 2009,
        currentYearPartial: maxYear != null && maxYear === currentYear,
        currentYear,
      },
    };
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
    // One list for every way the registry can be narrowed, whatever set it:
    // a rail chip, a drill-down click on a chart or group row, the year slider,
    // the search box, or an analytics selection. Tokens are {dim, value, label?}.
    // Semantics: AND across dimensions, OR within one — so two programmes are a
    // union, while a programme AND a producer intersect. Before this was two
    // disjoint mechanisms (state.filters + state.scopes) that AND-ed blindly, so
    // "program=X" from a chart and "program=Y" from the rail silently produced an
    // empty list with nothing on screen to explain it.
    narrow: [],
    normalize: true,       // display-only: original currency vs. normalized €
    // Produced by the list once it has filtered, consumed by the view bar. Kept
    // in state rather than read back out of the DOM so the bar has one source.
    readout: { shown: 0, total: 0, sum: 0 },
    groupBy: 'projects',
    sort: { key: 'title', dir: 'asc' },
    expandedKey: null,     // normTitle of the expanded project (works in projects/decisions)
    expandedRoundIds: new Set(), // `${doc}:${n}` per expanded "why" inside a profile
    expandedMentions: false,
    theme: localStorage.getItem('sredstva-theme') || 'light',
    lang: localStorage.getItem('sredstva-lang') || 'hr',
    hideUnattributed: true,
    showUnfunded: false,
    showAnalytics: false,
    expandedAnalyticsKpi: null, // KPI key currently expanded inside the analytics modal
    pdfPreview: null, // { title, source_url }
    showHelperTip: false,
    showProvenance: false,  // the headline's (i) — the data-origin note
    // 'collapsed' | 'default' | 'full'. The timeline is the screen's visual
    // signature, so desktop shows it expanded — the list keeps its guaranteed
    // floor either way (see "The list always wins" in style.css), which is what
    // makes that safe on a short viewport. Mobile renders the compact summary
    // instead and never reaches this. Remembered across sessions.
    timelineView: localStorage.getItem('sredstva-timeline') || 'default',
    mobileFiltersOpen: false,
    view: 'dashboard', // 'dashboard' | 'about' | 'process'
  };

  // ─── Narrowing dimensions ───────────────────────────────────────────
  // `get` is the row accessor for plain-equality dimensions, which are the ones
  // that OR within themselves. `single: true` dimensions replace rather than
  // accumulate — a year range, an amount band, a project family or a search
  // string has no useful union with a second one of its kind — and each carries a
  // bespoke matcher in buildNarrowPlan().
  const NARROW_DIMS = {
    program:   { get: (r) => r.program },
    cat:       { get: (r) => r.cat_type },
    rok:       { get: (r) => r.rok },
    producer:  { get: (r) => r.producer },
    director:  { get: (r) => r.director },
    writer:    { get: (r) => r.writer },
    recipient: { get: (r) => (window.SredstvaAnalytics
      ? window.SredstvaAnalytics.recipientForRow(r)
      : (r.producer || r.applicant || null)) },
    years:     { single: true },
    amount:    { single: true },
    project:   { single: true },
    q:         { single: true },
  };
  function isNarrowDim(dim) {
    return Object.prototype.hasOwnProperty.call(NARROW_DIMS, dim);
  }
  function isSingleDim(dim) {
    return !!(NARROW_DIMS[dim] && NARROW_DIMS[dim].single);
  }
  function sameNarrowValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
  }
  function sameNarrowToken(a, b) {
    return !!a && !!b && a.dim === b.dim && sameNarrowValue(a.value, b.value);
  }
  // First token on a single-cardinality dimension, or null.
  function narrowOne(dim) {
    return state.narrow.find(t => t.dim === dim) || null;
  }
  // All values present on a multi-cardinality dimension.
  function narrowSet(dim) {
    const out = new Set();
    for (const t of state.narrow) if (t.dim === dim) out.add(t.value);
    return out;
  }
  function hasNarrowToken(dim, value) {
    return state.narrow.some(t => t.dim === dim && sameNarrowValue(t.value, value));
  }

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

  function commitNarrow(next) {
    state.narrow = next;
    schedulePersist();
    fire('narrow');
  }
  // opts.switchToProjects: drilling into a group row only makes sense if the list
  // then shows that group's projects rather than staying on the aggregate pivot.
  function addNarrow(token, opts) {
    if (!token || !isNarrowDim(token.dim)) return;
    if (hasNarrowToken(token.dim, token.value)) return;
    const next = isSingleDim(token.dim)
      ? [...state.narrow.filter(t => t.dim !== token.dim), token]
      : [...state.narrow, token];
    if (opts && opts.switchToProjects) {
      state.groupBy = 'projects';
      state.expandedKey = null;
    }
    state.narrow = next;
    // Field name only, never the value: which filters earn their place is
    // worth knowing; what people search for is none of our business.
    window.havcUsage?.('filter', token.dim);
    schedulePersist();
    fire(['narrow', 'groupBy']);
  }
  function removeNarrow(idx) {
    if (idx < 0 || idx >= state.narrow.length) return;
    commitNarrow(state.narrow.filter((_, i) => i !== idx));
  }
  // Rail chips and year ticks are toggles: clicking an active value clears it.
  function toggleNarrow(token) {
    if (!token || !isNarrowDim(token.dim)) return;
    if (hasNarrowToken(token.dim, token.value)) {
      commitNarrow(state.narrow.filter(t => !sameNarrowToken(t, token)));
      return;
    }
    addNarrow(token);
  }
  // Replace-or-clear for single-cardinality dimensions (years, amount, q, project).
  function setNarrowOne(dim, value, label) {
    if (!isNarrowDim(dim)) return;
    const without = state.narrow.filter(t => t.dim !== dim);
    const cleared = value == null || value === '';
    if (!cleared && hasNarrowToken(dim, value)) return;
    if (!cleared) window.havcUsage?.('filter', dim);
    commitNarrow(cleared ? without : [...without, label == null ? { dim, value } : { dim, value, label }]);
  }
  function clearNarrow() {
    if (state.narrow.length === 0) return;
    commitNarrow([]);
  }
  function popNarrow() {
    if (state.narrow.length === 0) return false;
    commitNarrow(state.narrow.slice(0, -1));
    return true;
  }
  function setReadout(next) {
    const cur = state.readout;
    if (cur.shown === next.shown && cur.total === next.total && cur.sum === next.sum) return;
    state.readout = next;
    fire('readout');
  }
  function setNormalize(v) {
    const next = !!v;
    if (state.normalize === next) return;
    state.normalize = next;
    schedulePersist();
    fire('normalize');
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
  // A single year is just a one-year range now — there is no separate
  // "selectedYear" for the pills row to disagree with the slider about.
  function setSelectedYear(year) {
    if (year == null) { setNarrowOne('years', null); return; }
    const y = Number(year);
    setNarrowOne('years', [y, y]);
  }
  function setYearRange(from, to) {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const full = DATA && DATA.facets && DATA.facets.years;
    // The full span is not a narrowing — drop the token instead of carrying a
    // no-op chip that claims the view is scoped when it isn't.
    if (full && full.length && lo <= full[0] && hi >= full[full.length - 1]) {
      setNarrowOne('years', null);
      return;
    }
    setNarrowOne('years', [lo, hi]);
  }
  function setQuery(str) {
    const q = (str || '').trim();
    setNarrowOne('q', q || null);
  }
  function setExpandedKey(key) {
    state.expandedKey = state.expandedKey === key ? null : key;
    state.expandedRoundIds = new Set();
    state.expandedMentions = false;
    schedulePersist();
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
    syncDocumentI18n(lang);
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
    schedulePersist();
    fire('hideUnattributed');
  }
  function setShowUnfunded(v) {
    state.showUnfunded = v;
    fire('showUnfunded');
  }
  function setShowAnalytics(v) {
    const opening = !!v && !state.showAnalytics;
    state.showAnalytics = !!v;
    if (!state.showAnalytics) state.expandedAnalyticsKpi = null;
    if (opening) window.havcUsage?.('studio_open');
    fire('showAnalytics');
  }
  function setExpandedAnalyticsKpi(key) {
    state.expandedAnalyticsKpi = state.expandedAnalyticsKpi === key ? null : key;
    fire('expandedAnalyticsKpi');
  }
  function setPdfPreview(v) {
    state.pdfPreview = v || null;
    if (state.pdfPreview) window.havcUsage?.('pdf_open');
    fire('pdfPreview');
  }
  function setShowHelperTip(v) {
    const next = !!v;
    if (state.showHelperTip === next) return;
    state.showHelperTip = next;
    fire('helperTip');
  }
  // The choice outlives the session — re-collapsing a chart you deliberately
  // opened, on every reload, is the kind of thing that makes a tool feel like it
  // is arguing with you.
  const TIMELINE_VIEWS = ['collapsed', 'default', 'full'];
  function setTimelineView(v) {
    const next = TIMELINE_VIEWS.includes(v) ? v : 'default';
    if (state.timelineView === next) return;
    state.timelineView = next;
    try { localStorage.setItem('sredstva-timeline', next); } catch (_) {}
    fire('viewport');
  }
  function setShowProvenance(v) {
    const next = !!v;
    if (state.showProvenance === next) return;
    state.showProvenance = next;
    fire('provenance');
  }
  function setMobileFiltersOpen(v) {
    const open = !!v;
    if (open && state.view !== 'dashboard') return;
    if (open && !isRailDrawer()) return;
    if (state.mobileFiltersOpen === open) return;
    state.mobileFiltersOpen = open;
    document.body.classList.toggle('mobile-filters-open', open);
    fire('mobileFilters');
  }

  // ─── Viewport observers ─────────────────────────────────────────────
  // Width decides the shell (locked panels vs. document scroll); height decides
  // how much optional chrome we can afford above the list. Both fire 'viewport'.
  const mq = (q) => (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia(q)
    : null;
  // Three independent questions, which one breakpoint used to answer badly:
  //
  //  isMobile()     — phone. Document scroll, simplified rows, and the timeline
  //                   replaced by a compact summary.
  //  isRailDrawer() — anything not wide enough to spare a 280px column for the
  //                   rail. A tablet at 1024px lost 27% of its width to it, which
  //                   is why the registry felt unusable there. Tablets get the
  //                   drawer but KEEP the desktop shell and the timeline.
  //  isWide()       — wide enough for all seven grouping buttons in the view bar
  //                   rather than a select.
  const MOBILE_MQL = mq('(max-width: 900px)');
  const RAIL_DRAWER_MQL = mq('(max-width: 1199px)');
  const WIDE_MQL = mq('(min-width: 1400px)');
  function isMobile() {
    return !!(MOBILE_MQL && MOBILE_MQL.matches);
  }
  function isRailDrawer() {
    return !!(RAIL_DRAWER_MQL && RAIL_DRAWER_MQL.matches);
  }
  function isWide() {
    return !!(WIDE_MQL && WIDE_MQL.matches);
  }
  function onViewportChange() {
    document.body.classList.toggle('is-mobile', isMobile());
    document.body.classList.toggle('is-rail-drawer', isRailDrawer());
    if (!isRailDrawer() && state.mobileFiltersOpen) {
      state.mobileFiltersOpen = false;
      document.body.classList.remove('mobile-filters-open');
    }
    fire('viewport');
  }
  [MOBILE_MQL, RAIL_DRAWER_MQL, WIDE_MQL].forEach((m) => {
    if (!m) return;
    if (m.addEventListener) m.addEventListener('change', onViewportChange);
    else if (m.addListener) m.addListener(onViewportChange);
  });
  function setView(view) {
    const next = (view === 'about' || view === 'process') ? view : 'dashboard';
    if (state.view === next) return;
    if (next !== 'dashboard' && state.mobileFiltersOpen) {
      setMobileFiltersOpen(false);
    }
    state.showHelperTip = false;
    state.view = next;
    document.body.classList.remove('view-dashboard', 'view-about', 'view-process');
    document.body.classList.add('view-' + next);
    window.havcUsage?.('view', next);
    fire('view');
  }
  function navigateView(view) {
    setView(view);
    schedulePersist();
  }

  function openScopedProject(projectKey, projectTitle) {
    const token = { dim: 'project', value: projectKey, label: projectTitle };
    state.narrow = [...state.narrow.filter(t => t.dim !== 'project'), token];
    state.groupBy = 'projects';
    state.sort = defaultSortFor('projects');
    state.expandedKey = projectKey;
    state.expandedRoundIds = new Set();
    state.expandedMentions = false;
    schedulePersist();
    fire(['narrow', 'groupBy', 'sort', 'expanded']);
    requestAnimationFrame(() => {
      const list = document.querySelector('#listwrap .list');
      if (list && typeof list.scrollTo === 'function') list.scrollTo({ top: 0, left: 0 });
    });
  }

  // ═══ 4. Clean URL + explicit share state ════════════════════════════
  let persistTimer = null;
  function cleanAppUrl() {
    try {
      history.replaceState(null, '', new URL('/', location.origin));
    } catch (_) {}
  }
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(cleanAppUrl, 120);
  }
  function buildShareUrl() {
    try {
      const payload = {
        nw: state.narrow,
        n: state.normalize ? 1 : 0,
        g: state.groupBy,
        hu: state.hideUnattributed ? 1 : 0,
        so: state.sort,
        v: state.view,
      };
      const enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const u = new URL('/', location.origin);
      u.searchParams.set('f', enc);
      return u;
    } catch (_) {
      return new URL('/', location.origin);
    }
  }
  // Share links minted before filters and scopes were merged carry the old
  // y/p/c/r/q/sy/s keys. Those URLs are already out in the world, so keep
  // reading them and fold them into the one token list.
  const LEGACY_SCOPE_DIM = {
    applicant: 'producer',   // applicant became an alias of producer
    sizeBand: 'amount',
    year: 'years',
  };
  function readNarrowPayload(payload) {
    const out = [];
    const push = (dim, value, label) => {
      if (!isNarrowDim(dim) || value == null || value === '') return;
      if (out.some(t => t.dim === dim && sameNarrowValue(t.value, value))) return;
      out.push(label == null ? { dim, value } : { dim, value, label });
    };
    if (Array.isArray(payload.nw)) {
      for (const t of payload.nw) {
        if (t && typeof t.dim === 'string') push(t.dim, t.value, t.label);
      }
      return out;
    }
    // ── legacy shape ──
    // y (range) and sy (single year) were AND-ed, so sy — being narrower — is
    // the effective selection whenever both are present. A y covering the whole
    // registry narrows nothing and must not become a no-op chip.
    const span = (DATA && DATA.facets && DATA.facets.years) || null;
    if (typeof payload.sy === 'number') {
      push('years', [payload.sy, payload.sy]);
    } else if (Array.isArray(payload.y) && payload.y.length === 2) {
      const isFullSpan = span && span.length
        && payload.y[0] <= span[0] && payload.y[1] >= span[span.length - 1];
      if (!isFullSpan) push('years', payload.y);
    }
    if (typeof payload.q === 'string') push('q', payload.q.trim());
    (Array.isArray(payload.p) ? payload.p : []).forEach(v => push('program', v));
    (Array.isArray(payload.c) ? payload.c : []).forEach(v => push('cat', v));
    (Array.isArray(payload.r) ? payload.r : []).forEach(v => push('rok', v));
    (Array.isArray(payload.s) ? payload.s : []).forEach((s) => {
      if (!s || typeof s.kind !== 'string') return;
      const dim = LEGACY_SCOPE_DIM[s.kind] || s.kind;
      // A legacy single-year scope and a legacy sy key can both be present; push()
      // dedupes, and 'years' being single-cardinality means the first one wins.
      push(dim, s.kind === 'year' ? [s.value, s.value] : s.value, s.label);
    });
    return out;
  }

  function readSharedState() {
    try {
      const u = new URL(location.href);
      const f = u.searchParams.get('f');
      const legacyView = (u.hash || '').replace(/^#\/?/, '');
      if (!f) {
        if (legacyView === 'about' || legacyView === 'process') state.view = legacyView;
        cleanAppUrl();
        return;
      }
      const payload = JSON.parse(decodeURIComponent(escape(atob(f))));
      state.narrow = readNarrowPayload(payload);
      if (typeof payload.n === 'number') state.normalize = !!payload.n;
      if (typeof payload.g === 'string') {
        // backward compat: 'project' → 'decisions'; 'year' → 'projects' (year is now a filter, not a pivot)
        // Phase 6: 'applicant' → 'producer' (applicant is now an alias of producer after entity unification)
        let g = payload.g === 'project' ? 'decisions' : payload.g;
        if (g === 'year') g = 'projects';
        if (g === 'applicant') g = 'producer';
        if (PIVOTS.includes(g)) state.groupBy = g;
      }
      if (typeof payload.hu === 'number') state.hideUnattributed = !!payload.hu;
      if (payload.so && typeof payload.so === 'object' && typeof payload.so.key === 'string') {
        state.sort = {
          key: payload.so.key,
          dir: payload.so.dir === 'desc' ? 'desc' : 'asc',
        };
      } else {
        state.sort = defaultSortFor(state.groupBy);
      }
      if (payload.v === 'about' || payload.v === 'process' || payload.v === 'dashboard') {
        state.view = payload.v;
      } else if (legacyView === 'about' || legacyView === 'process') {
        state.view = legacyView;
      }
    } catch (err) {
      // A malformed or stale share link must never strand the user on a noisy
      // URL — but swallowing the reason entirely hides real bugs in here, so say
      // something. The user still lands on a clean, working registry.
      console.warn('Ignoring unreadable share state:', err);
    } finally {
      cleanAppUrl();
    }
  }

  async function copyShareUrl() {
    const shareUrl = buildShareUrl();
    history.replaceState(null, '', shareUrl);
    const text = shareUrl.href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand('copy');
        helper.remove();
        if (!copied) throw new Error('copy command failed');
      }
      window.havcUsage?.('share_created');
      return true;
    } catch (_) {
      return false;
    }
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

  function formatPercent(ratio, lang, digits) {
    const locale = lang === 'hr' ? 'hr-HR' : 'en-US';
    const pct = ((ratio || 0) * 100);
    const d = digits == null ? 1 : digits;
    return pct.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  }

  function formatUtcTimestamp(iso, lang) {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    const locale = lang === 'hr' ? 'hr-HR' : 'en-US';
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      }).format(d) + ' UTC';
    } catch (_) {
      return String(iso).replace('T', ' ').replace('Z', ' UTC');
    }
  }

  function buildSanityInfoSummary(lang) {
    if (!SANITY_REPORT) return null;

    const locale = lang === 'hr' ? 'hr-HR' : 'en-US';
    const ts = formatUtcTimestamp(SANITY_REPORT.generated_at, lang)
      || (lang === 'hr' ? 'bez vremenske oznake' : 'no timestamp');

    const directOverall = asObject(asObject(asObject(SANITY_REPORT).results).direct_overall);
    const counts = asObject(directOverall.group_status_counts_dedup);
    const pass = toFiniteInt(counts.PASS) || 0;
    const warn = toFiniteInt(counts.WARN) || 0;
    const fail = toFiniteInt(counts.FAIL) || 0;

    const diag = asObject(SANITY_REPORT.diagnostics_summary);
    const rowsRaw = toFiniteInt(diag.rows_raw_total);
    const rowsDedup = toFiniteInt(diag.rows_dedup_total);

    const rawText = rowsRaw == null ? '—' : rowsRaw.toLocaleString(locale);
    const dedupText = rowsDedup == null ? '—' : rowsDedup.toLocaleString(locale);
    return t('header.notice.audit', lang, {
      ts,
      pass: pass.toLocaleString(locale),
      warn: warn.toLocaleString(locale),
      fail: fail.toLocaleString(locale),
      raw: rawText,
      dedup: dedupText,
    });
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
    const readout = el('div', { class: 'chart-readout mono' });
    let pinned = null;

    function labelFor(i, v) {
      return labels && labels[i] != null ? labels[i] : String(v);
    }

    function renderPinnedOrHide() {
      if (pinned == null) {
        tooltip.classList.remove('on');
        readout.classList.remove('on');
        readout.textContent = '';
        return;
      }
      const v = values[pinned] != null ? values[pinned] : '';
      const text = labelFor(pinned, v);
      tooltip.textContent = text;
      tooltip.classList.add('on');
      readout.textContent = text;
      readout.classList.add('on');
    }

    function show(i, v, stick) {
      const text = labelFor(i, v);
      tooltip.textContent = text;
      tooltip.classList.add('on');
      readout.textContent = text;
      readout.classList.add('on');
      if (stick) pinned = i;
    }

    const bars = values.map((v, i) => {
      const label = labelFor(i, v);
      const bar = el('div', {
        class: 'bar',
        style: `height: ${Math.max(1, (v / max) * 100)}%`,
      });
      if (labels && labels[i] != null) bar.dataset.label = labels[i];
      bar.setAttribute('title', label);
      bar.setAttribute('role', 'button');
      bar.setAttribute('tabindex', '0');
      bar.setAttribute('aria-label', label);
      bar.addEventListener('mouseenter', () => {
        show(i, v, false);
        bar.classList.add('hot');
      });
      bar.addEventListener('mouseleave', () => {
        renderPinnedOrHide();
        bar.classList.remove('hot');
      });
      bar.addEventListener('focus', () => show(i, v, false));
      bar.addEventListener('blur', () => renderPinnedOrHide());
      bar.addEventListener('click', (e) => {
        if (pinned === i) pinned = null;
        else pinned = i;
        renderPinnedOrHide();
        if (opts.onclick) opts.onclick(i, v, e);
      });
      bar.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        bar.click();
      });
      return bar;
    });
    return el('div', { class: 'chart-wrap' }, [
      el('div', { class: 'bars' }, bars),
      tooltip,
      readout,
    ]);
  }

  // ═══ 6. Topbar ═════════════════════════════════════════════════════
  function mountTopbar(root) {
    const VIEW_TABS = ['dashboard', 'about', 'process'];
    let searchDraft = (narrowOne('q') || {}).value || '';
    let shareStatus = 'idle';
    let shareTimer = null;

    async function shareCurrentView() {
      clearTimeout(shareTimer);
      shareStatus = (await copyShareUrl()) ? 'copied' : 'failed';
      render();
      const button = root.querySelector('.share-view-btn');
      if (button) button.focus();
      shareTimer = setTimeout(() => {
        shareStatus = 'idle';
        cleanAppUrl();
        render();
      }, 2200);
    }

    const onDocPointerDown = (e) => {
      if (!state.showHelperTip) return;
      const wrap = root.querySelector('.helper-tip-wrap');
      if (!wrap) return;
      if (!wrap.contains(e.target)) setShowHelperTip(false);
    };
    const onDocKeyDown = (e) => {
      if (e.key === 'Escape' && state.showHelperTip) {
        setShowHelperTip(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeyDown);

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
      const showMobileFilterToggle = isDash && isRailDrawer();
      const nextLang = lang === 'hr' ? 'en' : 'hr';
      const activeEl = document.activeElement;
      const hadSearchFocus = Boolean(
        activeEl &&
        activeEl.tagName === 'INPUT' &&
        activeEl.closest &&
        activeEl.closest('.search')
      );
      const prevSelStart = hadSearchFocus && typeof activeEl.selectionStart === 'number'
        ? activeEl.selectionStart
        : null;
      const prevSelEnd = hadSearchFocus && typeof activeEl.selectionEnd === 'number'
        ? activeEl.selectionEnd
        : null;
      if (hadSearchFocus) {
        searchDraft = activeEl.value;
      } else {
        searchDraft = (narrowOne('q') || {}).value || '';
      }
      const themeIcon = state.theme === 'light'
        ? 'fa-solid fa-sun'
        : state.theme === 'dark'
          ? 'fa-solid fa-moon'
          : 'fa-solid fa-circle-half-stroke';
      root.replaceChildren(
        el('div', { class: 'topbar-row' }, [
          el('a', {
            class: 'wordmark',
            href: '/',
            title: t('wordmark.home', lang),
            'aria-label': t('wordmark.home', lang),
          }, [
            t('app.name', lang),
            el('span', { class: 'dot', text: '·' }),
          ]),
          el('nav', {
            class: 'view-tabs',
            role: 'tablist',
            'aria-label': t('nav.sections', lang),
          }, VIEW_TABS.map(v => viewTabBtn(v, lang))),
          isDash ? el('div', { class: 'search' }, [
            fa('fa-solid fa-magnifying-glass', 'search-icon'),
            el('input', {
              type: 'text',
              placeholder: t('search.placeholder', lang),
              value: searchDraft,
              oninput: (e) => {
                clearTimeout(render._searchDebounce);
                const val = e.target.value;
                searchDraft = val;
                render._searchDebounce = setTimeout(() => {
                  setQuery(val);
                }, 220);
              },
            }),
          ]) : el('div', { class: 'search-spacer' }),
          el('div', { class: 'toolbar' }, [
            el('button', {
              class: 'mode-toggle share-view-btn' + (shareStatus === 'copied' ? ' is-copied' : '') + (shareStatus === 'failed' ? ' is-failed' : ''),
              type: 'button',
              title: t(shareStatus === 'copied' ? 'share.copied' : shareStatus === 'failed' ? 'share.failed' : 'share.aria', lang),
              'aria-label': t(shareStatus === 'copied' ? 'share.copied' : shareStatus === 'failed' ? 'share.failed' : 'share.aria', lang),
              'aria-live': 'polite',
              'aria-atomic': 'true',
              onclick: shareCurrentView,
            }, [
              fa(shareStatus === 'copied'
                ? 'fa-solid fa-check'
                : shareStatus === 'failed'
                  ? 'fa-solid fa-triangle-exclamation'
                  : 'fa-solid fa-share-nodes'),
              el('span', {
                class: 'share-view-label',
                text: t(shareStatus === 'copied' ? 'share.copied' : shareStatus === 'failed' ? 'share.failed' : 'share.label', lang),
              }),
            ]),
            showMobileFilterToggle ? el('button', {
              class: 'mode-toggle mobile-filter-toggle' + (state.mobileFiltersOpen ? ' is-open' : ''),
              type: 'button',
              title: t('facet.filters', lang),
              'aria-label': t('facet.filters', lang),
              'aria-controls': 'rail',
              'aria-expanded': state.mobileFiltersOpen ? 'true' : 'false',
              onclick: () => setMobileFiltersOpen(!state.mobileFiltersOpen),
            }, [
              fa(state.mobileFiltersOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-sliders'),
            ]) : null,
            el('a', {
              class: 'mode-toggle repo-link-btn',
              href: HAVC_REPO_URL,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: t('repo.open_aria', lang),
              'aria-label': t('repo.open_aria', lang),
            }, [
              fa('fa-brands fa-github'),
            ]),
            el('div', { class: 'helper-tip-wrap' }, [
              el('button', {
                class: 'mode-toggle helper-tip-btn',
                type: 'button',
                title: t('helper.tip.label', lang),
                'aria-haspopup': 'dialog',
                'aria-expanded': state.showHelperTip ? 'true' : 'false',
                onclick: (e) => {
                  e.stopPropagation();
                  setShowHelperTip(!state.showHelperTip);
                },
              }, [
                fa('fa-brands fa-chrome'),
                el('span', { class: 'mode-toggle-k', text: t('helper.tip.label', lang) }),
              ]),
              state.showHelperTip ? el('div', {
                class: 'helper-tip-popover',
                role: 'dialog',
                'aria-label': t('helper.tip.title', lang),
              }, [
                el('h3', { class: 'helper-tip-title display', text: t('helper.tip.title', lang) }),
                el('p', { class: 'helper-tip-body', text: t('helper.tip.body', lang) }),
                el('a', {
                  class: 'btn mono helper-tip-link',
                  href: HAVC_HELPER_STORE_URL,
                  target: '_blank',
                  rel: 'noopener',
                  'aria-label': t('helper.tip.store_aria', lang),
                  onclick: () => setShowHelperTip(false),
                }, [t('helper.tip.open_store', lang)]),
              ]) : null,
            ]),
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
      if (isDash && hadSearchFocus) {
        const nextSearchInput = root.querySelector('.search input');
        if (nextSearchInput) {
          nextSearchInput.focus();
          if (prevSelStart != null && prevSelEnd != null) {
            const max = nextSearchInput.value.length;
            nextSearchInput.setSelectionRange(
              Math.min(prevSelStart, max),
              Math.min(prevSelEnd, max),
            );
          }
        }
      }
    }
    // 'viewport' matters here: the mobile filter toggle is the only way to reach
    // the rail below 900px, so the topbar must rebuild when we cross that line.
    on(['lang', 'theme', 'narrow', 'view', 'mobileFilters', 'helperTip', 'viewport'], render);
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

  // 19 tick marks in a 280px rail is ~14px each, well under the 44px target the
  // design system asks for on coarse pointers. So touch devices also get a
  // horizontally-scrollable year list — always in the DOM, revealed by CSS under
  // @media (pointer: coarse), which keeps pointer sniffing out of the JS. This is
  // the one place the old #year-pills band still earns its keep: inside the
  // filter drawer, where it is genuinely the better control.
  function buildYearPills(minYear, maxYear) {
    const sel = (narrowOne('years') || {}).value || null;
    const only = sel && sel[0] === sel[1] ? sel[0] : null;
    const pills = [el('button', {
      class: 'btn mono year-pill year-pill-all' + (sel == null ? ' active' : ''),
      type: 'button',
      text: t('years.all', state.lang),
      onclick: () => setNarrowOne('years', null),
    })];
    for (let y = minYear; y <= maxYear; y++) {
      pills.push(el('button', {
        class: 'btn mono year-pill' + (only === y ? ' active' : ''),
        type: 'button',
        text: String(y),
        'aria-pressed': only === y ? 'true' : 'false',
        onclick: () => { if (only === y) setNarrowOne('years', null); else setYearRange(y, y); },
      }));
    }
    return el('div', { class: 'year-pills-list' }, pills);
  }

  // Year slider, boundary model.
  //
  // The thumbs sit on year BOUNDARIES, not on years: the left thumb is 1 January
  // of its year, the right thumb is 31 December of the year before it. So for
  // 2008–2026 there are 20 stops for 19 years, and the two thumbs can never
  // coincide — one step apart already means one whole year, with a highlighted
  // segment exactly one year wide.
  //
  // The old model put both thumbs on years, which made a single-year selection
  // render as a zero-width bar: picking 2020 left no visible mark anywhere, and
  // the knob tooltips are only opaque while dragging, so at rest the year filter
  // had no readout at all.
  function buildYearSlider(minYear, maxYear) {
    const lo = minYear, hi = maxYear + 1;        // boundary domain
    const span = Math.max(1, hi - lo);
    const sel = (narrowOne('years') || {}).value || [minYear, maxYear];
    const yrFrom = Math.max(minYear, Math.min(maxYear, sel[0]));
    const yrTo = Math.max(yrFrom, Math.min(maxYear, sel[1]));

    // Drag state is in boundary units: [a, b) with b >= a + 1.
    let dragA = null, dragB = null;
    let rafPending = false;

    const pct = (boundary) => ((boundary - lo) / span) * 100;

    const trackEl = el('div', { class: 'track' });
    const rangeEl = el('div', { class: 'range' });
    const knobFromEl = el('div', { class: 'knob from' });
    const knobToEl = el('div', { class: 'knob to' });
    const tipFromEl = el('div', { class: 'knob-tooltip from' });
    const tipToEl = el('div', { class: 'knob-tooltip to' });

    function applyVisual(a, b) {
      const pa = pct(a), pb = pct(b);
      rangeEl.style.left = pa + '%';
      rangeEl.style.right = (100 - pb) + '%';
      knobFromEl.style.left = pa + '%';
      knobToEl.style.left = pb + '%';
      tipFromEl.style.left = pa + '%';
      tipToEl.style.left = pb + '%';
      // Tooltips name the years the thumbs enclose, not the boundary numbers —
      // "2020" and "2020" for one year, never "2020" and "2021".
      tipFromEl.textContent = String(a);
      tipToEl.textContent = String(b - 1);
      for (const tick of tickEls) {
        const y = +tick.dataset.year;
        tick.classList.toggle('in-range', y >= a && y <= b - 1);
      }
    }

    function scheduleVisual() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        applyVisual(dragA != null ? dragA : yrFrom, dragB != null ? dragB : yrTo + 1);
      });
    }

    const inputFromEl = el('input', {
      type: 'range', min: String(lo), max: String(hi - 1), value: String(yrFrom),
      class: 'from', 'aria-label': t('facet.year', state.lang),
    });
    const inputToEl = el('input', {
      type: 'range', min: String(lo + 1), max: String(hi), value: String(yrTo + 1),
      class: 'to', 'aria-label': t('facet.year', state.lang),
    });

    function onFromInput() {
      const ceiling = (dragB != null ? dragB : yrTo + 1) - 1;   // keep 1 year of gap
      dragA = Math.min(+inputFromEl.value, ceiling);
      if (dragB == null) dragB = yrTo + 1;
      sliderEl.classList.add('dragging');
      scheduleVisual();
    }
    function onToInput() {
      const floor = (dragA != null ? dragA : yrFrom) + 1;
      dragB = Math.max(+inputToEl.value, floor);
      if (dragA == null) dragA = yrFrom;
      sliderEl.classList.add('dragging');
      scheduleVisual();
    }
    function commit() {
      sliderEl.classList.remove('dragging');
      if (dragA == null && dragB == null) return;
      const a = dragA != null ? dragA : yrFrom;
      const b = dragB != null ? dragB : yrTo + 1;
      dragA = null; dragB = null;
      if (a !== yrFrom || b - 1 !== yrTo) setYearRange(a, b - 1);
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

    // One tick per year, centred in that year's slot. Clicking it selects that
    // single year — the common case, which dragging two thumbs onto adjacent
    // boundaries makes needlessly fiddly.
    const tickEls = [];
    for (let y = minYear; y <= maxYear; y++) {
      const isOnly = y === yrFrom && y === yrTo;
      const tick = el('button', {
        class: 'year-tick' + (isOnly ? ' is-only' : ''),
        type: 'button',
        title: t('year.single', state.lang, { year: y }),
        'aria-label': t('year.single', state.lang, { year: y }),
        'aria-pressed': isOnly ? 'true' : 'false',
        dataset: { year: String(y) },
        // Selecting the year you already have selected alone clears it, so the
        // tick is a toggle like every other narrowing control.
        onclick: () => { if (isOnly) setNarrowOne('years', null); else setYearRange(y, y); },
      });
      tick.style.left = pct(y + 0.5) + '%';
      tickEls.push(tick);
    }
    const ticksEl = el('div', { class: 'year-ticks' }, tickEls);

    const sliderEl = el('div', { class: 'year-slider' }, [
      trackEl, rangeEl, ticksEl, inputFromEl, inputToEl,
      knobFromEl, knobToEl, tipFromEl, tipToEl,
    ]);

    applyVisual(yrFrom, yrTo + 1);
    return sliderEl;
  }

  function mountFilterRail(root) {
    const minYear = DATA.facets.years[0];
    const maxYear = DATA.facets.years[DATA.facets.years.length - 1];

    // Counts were computed once over every row and then never moved, so the rail
    // read identically whether you had narrowed or not. Recompute them per
    // change against everything EXCEPT the facet's own dimension — that is what
    // keeps the other programmes' counts alive so you can still add a second one.
    // One pass over ~9.5k rows per facet is not worth optimizing.
    function countsFor(dim, field) {
      const out = {};
      for (const i of applyFiltersExcept(dim)) {
        const v = DATA.rows[i][field];
        if (v) out[v] = (out[v] || 0) + 1;
      }
      return out;
    }

    // A value whose count has fallen to 0 under the OTHER narrowings is dropped
    // from the list — except when it is itself active, or you would be unable to
    // untick the very chip you are looking at a token for.
    function visibleValues(order, counts, dim) {
      return order.filter(k => counts[k] || hasNarrowToken(dim, k));
    }

    function chipList(items, dim, field, labelKey, counts) {
      return items.map(k => el('button', {
        class: 'chip' + (hasNarrowToken(dim, k) ? ' active' : ''),
        onclick: () => toggleNarrow({
          dim,
          value: k,
          label: labelKey ? t(labelKey + '.' + k, state.lang) : k,
        }),
      }, [
        el('span', { text: labelKey ? t(labelKey + '.' + k, state.lang) : k }),
        el('span', { class: 'count', text: String(counts[k] || 0) }),
      ]));
    }

    function render() {
      const lang = state.lang;
      const years = (narrowOne('years') || {}).value || [minYear, maxYear];
      const [yrFrom, yrTo] = years;
      const programCounts = countsFor('program', 'program');
      const catCounts = countsFor('cat', 'cat_type');
      const rokCounts = countsFor('rok', 'rok');

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
        el('div', { class: 'rail-mobile-head' }, [
          el('span', { class: 'kicker', text: t('facet.filters', lang) }),
          el('button', {
            class: 'btn mono rail-mobile-close',
            type: 'button',
            onclick: () => setMobileFiltersOpen(false),
          }, [
            fa('fa-solid fa-xmark', 'icon-left'),
            t('modal.close', lang),
          ]),
        ]),
        // Year
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.year', lang) }),
          ]),
          // One year reads as a single centred label rather than "2020 2020".
          yrFrom === yrTo
            ? el('div', { class: 'endpoints is-single' }, [
                el('span', { class: 'mono', text: String(yrFrom) }),
              ])
            : el('div', { class: 'endpoints' }, [
                el('span', { class: 'mono', text: String(yrFrom) }),
                el('span', { class: 'mono', text: String(yrTo) }),
              ]),
          yearSlider,
          buildYearPills(minYear, maxYear),
        ]),
        // Programme
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.program', lang) }),
            el('span', { class: 'count', text: narrowSet('program').size || t('facet.all', lang) }),
          ]),
          el('div', { class: 'facet-list' },
            chipList(visibleValues(PROGRAM_ORDER, programCounts, 'program'), 'program', 'program', 'prog', programCounts)),
        ]),
        // Category
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.cat', lang) }),
            el('span', { class: 'count', text: narrowSet('cat').size || t('facet.all', lang) }),
          ]),
          el('div', { class: 'facet-list' },
            chipList(visibleValues(CAT_ORDER, catCounts, 'cat'), 'cat', 'cat_type', 'cat', catCounts)),
        ]),
        // Round
        DATA.facets.roks.length > 0 && el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.rok', lang) }),
            el('span', { class: 'count', text: narrowSet('rok').size || t('facet.all', lang) }),
          ]),
          el('div', { class: 'facet-list' },
            chipList(visibleValues(DATA.facets.roks.slice().sort(), rokCounts, 'rok'), 'rok', 'rok', null, rokCounts)),
        ]),
        // Currency
        el('div', { class: 'facet' }, [
          el('div', { class: 'facet-header' }, [
            el('span', { class: 'kicker', text: t('facet.currency', lang) }),
          ]),
          el('div', { class: 'normalize-toggle' }, [
            el('button', {
              class: 'btn mono' + (!state.normalize ? ' active' : ''),
              text: t('facet.original', lang),
              onclick: () => setNormalize(false),
            }),
            el('button', {
              class: 'btn mono' + (state.normalize ? ' active' : ''),
              text: t('facet.normalize', lang),
              onclick: () => setNormalize(true),
            }),
          ]),
          el('span', { class: 'note', text: t('facet.currency_note', lang, { rate: DATA.hrk_to_eur }) }),
        ]),
        // Footer
        el('div', { class: 'rail-footer' }, [
          el('div', { class: 'btn-row' }, [
            el('button', {
              class: 'btn mono',
              onclick: clearNarrow,
            }, [
              fa('fa-solid fa-rotate-left', 'icon-left'),
              t('facet.reset', lang),
            ]),
          ]),
          unfundedBlock,
        ]),
      );
    }
    on(['narrow', 'normalize', 'lang'], render);
    render();
  }

  // ═══ Filter / derive helpers ════════════════════════════════════════
  function rowMatchesProjectScope(rowIndex, scopeValue) {
    const projectKey = rowNormTitles[rowIndex];
    if (projectKey === scopeValue) return true;
    const alias = normTitle(scopeValue);
    const matchingFamilies = projectAliasIndex.get(alias);
    return !!matchingFamilies && matchingFamilies.has(projectKey);
  }

  // Compile state.narrow into a shape the row loop can run cheaply: one Set per
  // active equality dimension (membership = the OR within that dimension) plus
  // the four bespoke matchers. Built once per call, not once per row.
  function buildNarrowPlan(tokens) {
    const eq = [];
    const byDim = new Map();
    let years = null, amount = null, project = null, searched = null;
    for (const t of (tokens || [])) {
      if (!t || !isNarrowDim(t.dim)) continue;
      switch (t.dim) {
        case 'years':   years = t.value; break;
        case 'amount':  amount = t.value; break;
        case 'project': project = t.value; break;
        case 'q': {
          const q = String(t.value || '').trim();
          if (q) searched = searchRowIds(q);
          break;
        }
        default: {
          let set = byDim.get(t.dim);
          if (!set) { set = new Set(); byDim.set(t.dim, set); }
          set.add(t.value);
        }
      }
    }
    for (const [dim, values] of byDim) eq.push({ get: NARROW_DIMS[dim].get, values });
    return { eq, years, amount, project, searched, active: eq.length > 0
      || years || amount || project != null || searched };
  }

  function rowMatchesPlan(i, plan) {
    const r = DATA.rows[i];
    if (plan.years && r.year && (r.year < plan.years[0] || r.year > plan.years[1])) return false;
    if (plan.amount) {
      const a = r.amount_eur || 0;
      if (a < plan.amount[0] || a >= plan.amount[1]) return false;
    }
    if (plan.searched && !plan.searched.has(i)) return false;
    if (plan.project != null && !rowMatchesProjectScope(i, plan.project)) return false;
    for (let k = 0; k < plan.eq.length; k++) {
      if (!plan.eq[k].values.has(plan.eq[k].get(r))) return false;
    }
    return true;
  }

  function applyFilters() {
    const plan = buildNarrowPlan(state.narrow);
    const out = [];
    for (let i = 0; i < DATA.rows.length; i++) {
      if (!plan.active || rowMatchesPlan(i, plan)) out.push(i);
    }
    return out;
  }

  // Row ids matching everything EXCEPT one dimension. Facet counts need this:
  // if selecting a programme zeroed every other programme's count, you could
  // never add a second one.
  function applyFiltersExcept(dim) {
    const plan = buildNarrowPlan(state.narrow.filter(t => t.dim !== dim));
    const out = [];
    for (let i = 0; i < DATA.rows.length; i++) {
      if (!plan.active || rowMatchesPlan(i, plan)) out.push(i);
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
                    title: DATA.rows[i].family_title || DATA.rows[i].title || '',
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
  // One line: what the registry is, plus its global totals.
  //
  // The provenance note used to sit here permanently as a 275-character
  // paragraph — the largest block of copy on the screen, unchanging, and the
  // single biggest reason the headline cost 156px. It is a trust statement you
  // read once, so it moved behind the (i), which is where a reader looks for it
  // when they actually want it.
  //
  // These totals are deliberately GLOBAL and stay global (PRODUCT.md keeps
  // registry facts distinct from the active scope). What changed is that they are
  // no longer the loudest thing on screen — the scoped count in #viewbar is.
  function mountHeadline(root) {
    const openAnalytics = () => setShowAnalytics(true);

    const onDocPointerDown = (e) => {
      if (!state.showProvenance) return;
      const wrap = root.querySelector('.head-note-wrap');
      if (wrap && !wrap.contains(e.target)) setShowProvenance(false);
    };
    const onDocKeyDown = (e) => {
      if (e.key === 'Escape' && state.showProvenance) setShowProvenance(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeyDown);

    function render() {
      const lang = state.lang;
      const maxYear = DATA.facets.years[DATA.facets.years.length - 1];
      const fundedProjects = GLOBAL_ANALYTICS ? GLOBAL_ANALYTICS.projectCount : 0;
      root.replaceChildren(
        el('div', { class: 'head-line' }, [
          // Truncates before the figures do; the title attribute keeps the full
          // string reachable when it does.
          el('span', {
            class: 'head-main',
            text: t('header.line', lang, { maxYear }),
            title: t('header.line', lang, { maxYear }),
          }),
          el('div', { class: 'head-note-wrap' }, [
            el('button', {
              class: 'head-note-btn',
              type: 'button',
              title: t('header.notice.kicker', lang),
              'aria-label': t('header.notice.kicker', lang),
              'aria-haspopup': 'dialog',
              'aria-expanded': state.showProvenance ? 'true' : 'false',
              onclick: (e) => {
                e.stopPropagation();
                setShowProvenance(!state.showProvenance);
              },
            }, [fa('fa-solid fa-circle-info')]),
            state.showProvenance && el('div', {
              class: 'helper-tip-popover head-note-popover',
              role: 'dialog',
              'aria-label': t('header.notice.kicker', lang),
            }, [
              el('div', { class: 'helper-tip-title display', text: t('header.notice.kicker', lang) }),
              el('div', { class: 'helper-tip-body', text: t('header.notice.body', lang) }),
              // The old statusbar's coverage note belongs with provenance, not
              // pinned below the table.
              el('div', {
                class: 'head-note-coverage mono',
                text: t('status.coverage', lang, { maxYear }),
              }),
            ]),
          ]),
        ]),
        el('button', {
          class: 'head-stats mono',
          type: 'button',
          onclick: openAnalytics,
          title: t('header.stats.open', lang),
          'aria-label': t('header.stats.open', lang),
        }, [
          el('span', { class: 'head-stat' }, [
            fa('fa-solid fa-coins', 'icon-left'),
            t('header.funded', lang, { amt: formatAmount(DATA.counts.total_amount_eur, 'EUR', lang) }),
          ]),
          el('span', { class: 'sep', text: '·' }),
          el('span', { class: 'head-stat' }, [
            fa('fa-regular fa-clapperboard', 'icon-left'),
            t('header.projects', lang, { n: fundedProjects.toLocaleString() }),
          ]),
          el('span', { class: 'sep', text: '·' }),
          el('span', { class: 'head-stat' }, [
            fa('fa-solid fa-list-check', 'icon-left'),
            t('header.decisions', lang, { n: DATA.counts.rows.toLocaleString() }),
          ]),
          el('span', { class: 'sep', text: '·' }),
          el('span', { class: 'head-stat' }, [
            fa('fa-regular fa-folder-open', 'icon-left'),
            t('header.calls', lang, { n: DATA.counts.docs_results_tables }),
          ]),
          fa('fa-solid fa-arrow-up-right-from-square', 'head-stats-open-icon'),
        ]),
      );
    }
    on(['lang', 'provenance'], render);
    render();
  }

  // ═══ 9. Insights strip ══════════════════════════════════════════════
  function mountInsights(root) {
    const openAnalytics = () => setShowAnalytics(true);
    let timelineCleanup = null;

    root.addEventListener('click', (e) => {
      if (!isMobile()) return;
      const interactive = e.target && e.target.closest('button, a, input, textarea, select');
      if (interactive) return;
      openAnalytics();
    });
    root.addEventListener('keydown', (e) => {
      if (!isMobile()) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openAnalytics();
    });

    function hashString(value) {
      let hash = 2166136261;
      const input = String(value || '');
      for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function timelineModel() {
      const fallbackRange = [
        DATA.facets.years[0],
        DATA.facets.years[DATA.facets.years.length - 1],
      ];
      const range = (narrowOne('years') || {}).value || fallbackRange;
      const minYear = Number(range[0]);
      const maxYear = Number(range[1]);

      function rowTimelineTime(rowId, row, projectKey) {
        const yearStart = Date.UTC(row.year, 0, 1);
        const nextYearStart = Date.UTC(row.year + 1, 0, 1);
        const doc = docById.get(row.doc);
        const dateMatch = doc && typeof doc.decision_date === 'string'
          ? /^(\d{4})-(\d{2})-(\d{2})/.exec(doc.decision_date)
          : null;

        if (dateMatch) {
          const month = Math.max(1, Math.min(12, Number(dateMatch[2]))) - 1;
          const day = Math.max(1, Math.min(31, Number(dateMatch[3])));
          const dated = Date.UTC(row.year, month, day);
          return Math.max(yearStart, Math.min(nextYearStart - 1, dated));
        }

        const seed = hashString(`${projectKey}:${row.doc}:${row.n}:${rowId}`);
        const fraction = 0.04 + ((seed % 10007) / 10006) * 0.92;
        return yearStart + (nextYearStart - yearStart) * fraction;
      }

      const matches = new Map();
      for (const rowId of applyFilters()) {
        const key = rowNormTitles[rowId];
        const row = DATA.rows[rowId];
        if (!key || key === UNATTRIBUTED_KEY || row.year == null) continue;
        const time = rowTimelineTime(rowId, row, key);
        let item = matches.get(key);
        if (!item) {
          item = {
            key,
            title: row.title || '',
            year: row.year,
            time,
            matchingCount: 0,
          };
          matches.set(key, item);
        }
        item.matchingCount += 1;
        if (time > item.time) {
          item.time = time;
          item.year = row.year;
        }
      }

      const items = [];
      for (const item of matches.values()) {
        const project = projectIndex.get(item.key);
        if (!project || !(project.total_eur > 0)) continue;
        items.push({
          ...item,
          title: project.title || item.title || t('col.untitled', state.lang),
          total: project.total_eur,
        });
      }

      return {
        items,
        minYear,
        maxYear,
      };
    }

    function timelineItemLabel(item, lang) {
      return [
        item.title,
        String(item.year),
        `${t('timeline.projects.lifetime', lang)}: ${formatAmount(item.total, 'EUR', lang)}`,
        t('timeline.projects.matching', lang, { n: item.matchingCount.toLocaleString() }),
      ].join(' · ');
    }

    function layoutTimelineItems(items, width, height) {
      const margin = { left: 24, right: 24, top: 12, bottom: 28 };
      const plotWidth = Math.max(1, width - margin.left - margin.right);
      const plotHeight = Math.max(1, height - margin.top - margin.bottom);
      const maxTotal = items.reduce((max, item) => Math.max(max, item.total), 1);
      const minRadius = 1.35;
      const maxRadius = Math.max(10, Math.min(18, plotHeight * 0.17));
      const trackY = margin.top + plotHeight / 2;

      const ordered = items.slice().sort((a, b) =>
        a.time - b.time || hashString(a.key) - hashString(b.key)
      );
      const positionSpan = Math.max(1, ordered.length - 1);
      const packed = ordered.map((item, index) => {
        const radius = Math.max(minRadius, Math.sqrt(item.total / maxTotal) * maxRadius);
        const seed = hashString(item.key);
        const unit = ((seed % 10007) / 10006) * 2 - 1;
        const availableJitter = Math.max(0, plotHeight / 2 - radius - 2);
        const largeBubbleBias = 1 - (radius / maxRadius) * 0.55;
        return {
          ...item,
          radius,
          x: margin.left + (index / positionSpan) * plotWidth,
          y: trackY + unit * availableJitter * largeBubbleBias,
        };
      });

      return {
        items: packed.sort((a, b) => a.radius - b.radius || hashString(a.key) - hashString(b.key)),
        margin,
        plotWidth,
        plotHeight,
        trackY,
      };
    }

    function mountTimelineCanvas(plot, canvas, tooltip, option, live, model, lang) {
      let layout = null;
      let resizeObserver = null;
      let frame = null;
      let activeKey = null;
      let hoverKey = null;
      let hasKeyboardFocus = false;
      let hitGrid = new Map();
      const hitCellSize = 30;

      function cssVar(name) {
        return getComputedStyle(document.body).getPropertyValue(name).trim();
      }

      function itemByKey(key) {
        return key && layout ? layout.items.find(item => item.key === key) : null;
      }

      function buildHitGrid() {
        hitGrid = new Map();
        if (!layout) return;
        for (const item of layout.items) {
          const minX = Math.floor((item.x - item.radius - 2) / hitCellSize);
          const maxX = Math.floor((item.x + item.radius + 2) / hitCellSize);
          const minY = Math.floor((item.y - item.radius - 2) / hitCellSize);
          const maxY = Math.floor((item.y + item.radius + 2) / hitCellSize);
          for (let gx = minX; gx <= maxX; gx++) {
            for (let gy = minY; gy <= maxY; gy++) {
              const key = `${gx}:${gy}`;
              const bucket = hitGrid.get(key) || [];
              bucket.push(item);
              hitGrid.set(key, bucket);
            }
          }
        }
      }

      function hitTest(x, y) {
        const bucket = hitGrid.get(`${Math.floor(x / hitCellSize)}:${Math.floor(y / hitCellSize)}`) || [];
        for (let i = bucket.length - 1; i >= 0; i--) {
          const item = bucket[i];
          const dx = x - item.x;
          const dy = y - item.y;
          const hitRadius = Math.max(4, item.radius + 1.5);
          if (dx * dx + dy * dy <= hitRadius * hitRadius) return item;
        }
        return null;
      }

      function showTooltip(item) {
        if (!item || !layout) {
          tooltip.hidden = true;
          return;
        }
        tooltip.replaceChildren(
          el('strong', { class: 'project-timeline-tooltip-title', text: item.title }),
          el('span', {
            class: 'project-timeline-tooltip-meta mono',
            text: `${item.year} · ${formatAmount(item.total, 'EUR', lang)} · ${t('timeline.projects.matching', lang, { n: item.matchingCount.toLocaleString() })}`,
          }),
        );
        tooltip.hidden = false;
        const width = canvas.clientWidth || 1;
        const left = Math.max(108, Math.min(width - 108, item.x));
        const above = item.y > 76;
        tooltip.classList.toggle('is-below', !above);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${above ? item.y - item.radius - 8 : item.y + item.radius + 8}px`;
      }

      function draw() {
        if (!layout) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const rule = cssVar('--rule');
        const paperDim = cssVar('--paper-dim');
        const ink = cssVar('--ink');
        const red = cssVar('--red');
        const selected = itemByKey(hoverKey) || itemByKey(activeKey);

        ctx.save();
        ctx.strokeStyle = rule;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(layout.margin.left, layout.trackY);
        ctx.lineTo(width - layout.margin.right, layout.trackY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(layout.margin.left, layout.trackY - 5);
        ctx.lineTo(layout.margin.left, layout.trackY + 5);
        ctx.moveTo(width - layout.margin.right, layout.trackY - 5);
        ctx.lineTo(width - layout.margin.right, layout.trackY + 5);
        ctx.stroke();
        ctx.restore();

        for (const item of layout.items) {
          const isSelected = selected && selected.key === item.key;
          ctx.save();
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
          ctx.fillStyle = red;
          ctx.globalAlpha = isSelected ? 0.98 : 0.46;
          ctx.fill();
          if (item.radius >= 5) {
            ctx.strokeStyle = ink;
            ctx.lineWidth = isSelected ? 1.8 : 0.8;
            ctx.globalAlpha = isSelected ? 0.95 : 0.5;
            ctx.stroke();
          }
          if (isSelected) {
            ctx.beginPath();
            ctx.arc(item.x, item.y, item.radius + 3, 0, Math.PI * 2);
            ctx.strokeStyle = red;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.7;
            ctx.stroke();
          }
          ctx.restore();
        }

        ctx.save();
        ctx.fillStyle = paperDim;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textBaseline = 'bottom';
        if (model.minYear === model.maxYear) {
          ctx.textAlign = 'center';
          ctx.fillText(String(model.minYear), width / 2, height - 5);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(String(model.minYear), layout.margin.left, height - 5);
          ctx.textAlign = 'right';
          ctx.fillText(String(model.maxYear), width - layout.margin.right, height - 5);
        }
        ctx.restore();
      }

      function setActive(item, announce) {
        if (!item) return;
        activeKey = item.key;
        const label = timelineItemLabel(item, lang);
        option.textContent = label;
        option.setAttribute('aria-label', label);
        if (announce) live.textContent = label;
        if (hasKeyboardFocus && !hoverKey) showTooltip(item);
        draw();
      }

      function moveActive(direction) {
        if (!layout || !layout.items.length) return;
        const current = itemByKey(activeKey) || layout.items[layout.items.length - 1];
        const candidates = layout.items.filter(item => {
          if (item.key === current.key) return false;
          if (direction === 'left') return item.x < current.x - 0.5;
          if (direction === 'right') return item.x > current.x + 0.5;
          if (direction === 'up') return item.y < current.y - 0.5;
          return item.y > current.y + 0.5;
        });
        if (!candidates.length) return;
        const horizontal = direction === 'left' || direction === 'right';
        candidates.sort((a, b) => {
          const aPrimary = horizontal ? Math.abs(a.x - current.x) : Math.abs(a.y - current.y);
          const bPrimary = horizontal ? Math.abs(b.x - current.x) : Math.abs(b.y - current.y);
          const aCross = horizontal ? Math.abs(a.y - current.y) : Math.abs(a.x - current.x);
          const bCross = horizontal ? Math.abs(b.y - current.y) : Math.abs(b.x - current.x);
          return (aPrimary + aCross * 0.28) - (bPrimary + bCross * 0.28);
        });
        setActive(candidates[0], true);
      }

      function activate(item) {
        if (!item) return;
        openScopedProject(item.key, item.title);
      }

      function relayout() {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        layout = layoutTimelineItems(model.items, rect.width, rect.height);
        buildHitGrid();
        if (activeKey && !itemByKey(activeKey)) activeKey = null;
        draw();
      }

      function scheduleRelayout() {
        if (frame != null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = null;
          relayout();
        });
      }

      canvas.addEventListener('pointermove', (e) => {
        if (!layout) return;
        const rect = canvas.getBoundingClientRect();
        const item = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        const nextKey = item ? item.key : null;
        if (hoverKey === nextKey) return;
        hoverKey = nextKey;
        canvas.classList.toggle('is-over-project', !!item);
        if (item) showTooltip(item);
        else if (hasKeyboardFocus) showTooltip(itemByKey(activeKey));
        else showTooltip(null);
        draw();
      });
      canvas.addEventListener('pointerleave', () => {
        hoverKey = null;
        canvas.classList.remove('is-over-project');
        if (hasKeyboardFocus) showTooltip(itemByKey(activeKey));
        else showTooltip(null);
        draw();
      });
      canvas.addEventListener('click', (e) => {
        if (!layout) return;
        const rect = canvas.getBoundingClientRect();
        activate(hitTest(e.clientX - rect.left, e.clientY - rect.top));
      });
      plot.addEventListener('focus', () => {
        hasKeyboardFocus = true;
        if (!activeKey && layout && layout.items.length) {
          setActive(layout.items[layout.items.length - 1], false);
        } else {
          showTooltip(itemByKey(activeKey));
          draw();
        }
      });
      plot.addEventListener('blur', () => {
        hasKeyboardFocus = false;
        if (!hoverKey) showTooltip(null);
        draw();
      });
      plot.addEventListener('keydown', (e) => {
        const keyMap = {
          ArrowLeft: 'left',
          ArrowRight: 'right',
          ArrowUp: 'up',
          ArrowDown: 'down',
        };
        if (keyMap[e.key]) {
          e.preventDefault();
          moveActive(keyMap[e.key]);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(itemByKey(activeKey));
        }
      });

      resizeObserver = new ResizeObserver(scheduleRelayout);
      resizeObserver.observe(canvas);
      scheduleRelayout();

      return () => {
        if (frame != null) cancelAnimationFrame(frame);
        if (resizeObserver) resizeObserver.disconnect();
      };
    }

    function render() {
      if (timelineCleanup) {
        timelineCleanup();
        timelineCleanup = null;
      }
      const lang = state.lang;
      const a = GLOBAL_ANALYTICS;
      if (!a) {
        root.replaceChildren();
        return;
      }

      if (isMobile()) {
        root.className = 'insights insights-openable insights-mobile';
        root.tabIndex = 0;
        root.setAttribute('role', 'button');
        root.setAttribute('aria-label', t('insights.open.hint', lang));
        root.replaceChildren(
          el('div', { class: 'insights-mobile-summary' }, [
            el('span', { class: 'insights-mobile-amount mono', text: formatCompact(a.totalAmount, lang) }),
            el('span', { class: 'insights-mobile-meta mono', text:
              `${a.rowCount.toLocaleString()} ${t('status.rows', lang)} · ${a.projectCount.toLocaleString()} ${t('metric.projects', lang)}`
            }),
          ]),
          el('button', {
            class: 'btn mono insights-mobile-btn',
            type: 'button',
            onclick: openAnalytics,
          }, [
            fa('fa-solid fa-chart-column', 'icon-left'),
            t('analytics.title', lang),
          ]),
        );
        return;
      }

      // Three sizes: a ~28px strip, the default 178px plot, and a taller "full"
      // plot for reading the distribution properly. Expanded is the desktop
      // default — the chart is the main screen's visual signature — and the list's
      // guaranteed floor plus a scrollable .main is what keeps that safe when the
      // viewport is short. Browsing the list stays the priority; the chart just
      // no longer has to be sacrificed pre-emptively to protect it.
      const view = state.timelineView;
      const open = view !== 'collapsed';
      const model = timelineModel();
      const summary = t('timeline.projects.summary', lang, { n: model.items.length.toLocaleString() });

      root.className = 'insights project-timeline-insights'
        + (open ? '' : ' is-collapsed')
        + (view === 'full' ? ' is-full' : '');
      root.removeAttribute('role');
      root.removeAttribute('aria-label');
      root.removeAttribute('tabindex');

      const sizeBtn = open && el('button', {
        class: 'timeline-disclosure',
        type: 'button',
        title: t(view === 'full' ? 'timeline.compact' : 'timeline.full', lang),
        'aria-label': t(view === 'full' ? 'timeline.compact' : 'timeline.full', lang),
        onclick: () => setTimelineView(view === 'full' ? 'default' : 'full'),
      }, [fa(view === 'full'
        ? 'fa-solid fa-down-left-and-up-right-to-center'
        : 'fa-solid fa-up-right-and-down-left-from-center')]);

      const disclosure = el('button', {
        class: 'timeline-disclosure',
        type: 'button',
        title: t(open ? 'timeline.collapse' : 'timeline.expand', lang),
        'aria-label': t(open ? 'timeline.collapse' : 'timeline.expand', lang),
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => setTimelineView(open ? 'collapsed' : 'default'),
      }, [fa(open ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down')]);

      const head = el('header', { class: 'project-timeline-head' }, [
        el('div', { class: 'project-timeline-heading' }, [
          el('span', { class: 'kicker', text: t('timeline.projects.title', lang) }),
          el('span', { class: 'project-timeline-summary mono', text: summary }),
        ]),
        // The legend explains marks you cannot see while collapsed, so it goes
        // with them. The hover hint moved onto the plot's own title attribute —
        // it belongs on the thing it describes, not on a line of its own.
        open && el('div', { class: 'project-timeline-legend mono' }, [
          el('span', { class: 'project-timeline-legend-dots', 'aria-hidden': 'true' }, [
            el('span', { class: 'project-timeline-legend-dot is-small' }),
            el('span', { class: 'project-timeline-legend-dot is-large' }),
          ]),
          el('span', { text: t('timeline.projects.legend', lang) }),
          el('span', { class: 'sep', text: '·' }),
          el('span', { text: t('timeline.projects.placement', lang) }),
        ]),
        el('div', { class: 'timeline-controls' }, [sizeBtn, disclosure]),
      ]);

      if (!open) {
        root.replaceChildren(head);
        return;
      }

      if (!model.items.length) {
        root.replaceChildren(
          head,
          el('div', { class: 'project-timeline-empty' }, [
            fa('fa-regular fa-circle', 'icon-left'),
            el('span', { text: t('timeline.projects.empty', lang) }),
          ]),
        );
        return;
      }

      const canvas = el('canvas', {
        class: 'project-timeline-canvas',
        'aria-hidden': 'true',
      });
      const tooltip = el('div', {
        class: 'project-timeline-tooltip',
        role: 'tooltip',
        hidden: true,
      });
      const optionId = 'project-timeline-active-option';
      const option = el('div', {
        class: 'sr-only',
        id: optionId,
        role: 'option',
        'aria-selected': 'true',
      });
      const live = el('div', {
        class: 'sr-only',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      });
      const plot = el('div', {
        class: 'project-timeline-plot',
        role: 'listbox',
        tabindex: '0',
        'aria-activedescendant': optionId,
        'aria-label': t('timeline.projects.keyboard', lang, { n: model.items.length.toLocaleString() }),
        title: t('timeline.projects.hint', lang),
      }, [canvas, tooltip, option, live]);
      root.replaceChildren(head, plot);
      timelineCleanup = mountTimelineCanvas(plot, canvas, tooltip, option, live, model, lang);
    }
    on(['narrow', 'lang', 'theme', 'viewport'], render);
    render();
  }

  // ═══ 10/11. View bar ════════════════════════════════════════════════
  const PIVOTS = ['projects', 'decisions', 'producer', 'director', 'writer', 'program', 'cat'];
  const PIVOTS_WITH_UNATTRIBUTED = new Set(['producer', 'director', 'writer']);

  // One bar that answers "what am I looking at?" — the live record count, every
  // active narrowing as a removable token, and the grouping control. It replaces
  // three stacked bands (scope row + pivot + year pills, 136–164px) with ~44px,
  // and it is where narrowing finally becomes visible: the count sits next to the
  // tokens that caused it, and the bar itself tints when the view is a subset.
  //
  // Before, the loudest numbers on screen lived in #headline, which subscribed to
  // ['lang'] alone and therefore never moved when you filtered; the only truthful
  // readout was a 34px statusbar pinned to the bottom of the window.
  function mountViewBar(root) {
    function tokenLabel(token, lang) {
      const kind = t('scope.kind.' + token.dim, lang);
      let val;
      if (token.dim === 'program') val = t('prog.' + token.value, lang);
      else if (token.dim === 'cat') val = t('cat.' + token.value, lang);
      else if (token.dim === 'project') val = token.label || t('col.untitled', lang);
      else if (token.dim === 'amount') val = token.label || bandLabel(token.value[0], token.value[1]);
      else if (token.dim === 'years') {
        val = token.value[0] === token.value[1]
          ? String(token.value[0])
          : `${token.value[0]}–${token.value[1]}`;
      } else val = token.label != null ? token.label : String(token.value);
      return [kind, val];
    }

    // Re-render is driven by both 'narrow' and 'readout', and one user action
    // fires both. Skip the redundant pass so a token's × doesn't get rebuilt
    // out from under the pointer twice.
    let lastSig = null;

    function render() {
      const lang = state.lang;
      const narrowed = state.narrow.length > 0;
      const { shown, total, sum } = state.readout;
      const sig = JSON.stringify([state.narrow, shown, total, sum, lang,
        state.groupBy, state.hideUnattributed, isWide(), isMobile()]);
      if (sig === lastSig) return;
      lastSig = sig;

      // ── readout ──
      const readout = el('div', { class: 'vb-readout' }, [
        el('span', { class: 'vb-count mono', text: shown.toLocaleString() }),
        narrowed
          ? el('span', { class: 'vb-of mono', text: `${t('status.of', lang)} ${total.toLocaleString()} ${t('status.rows', lang)}` })
          : el('span', { class: 'vb-of mono', text: t('status.rows', lang) }),
        el('span', { class: 'vb-sum mono', text: '· ' + formatAmount(sum, 'EUR', lang) }),
      ]);

      // ── tokens ──
      const tokens = el('div', { class: 'vb-tokens' });
      if (!narrowed) {
        tokens.appendChild(el('span', { class: 'scope-empty', text: t('scope.empty', lang) }));
      } else {
        state.narrow.forEach((token, idx) => {
          const [k, v] = tokenLabel(token, lang);
          tokens.appendChild(el('button', {
            class: 'scope-chip',
            title: t('scope.clearAll', lang),
            onclick: () => removeNarrow(idx),
          }, [
            el('span', { class: 'k mono', text: k }),
            el('span', { class: 'eq', text: '=' }),
            el('span', { class: 'v', text: v }),
            el('span', { class: 'x' }, [fa('fa-solid fa-xmark')]),
          ]));
        });
        tokens.appendChild(el('button', {
          class: 'btn mono scope-clear',
          text: t('scope.clearAll', lang),
          onclick: clearNarrow,
        }));
      }

      // ── grouping ──
      // Seven buttons plus the readout only fit on genuinely wide screens; below
      // that fall back to the select the mobile layout already uses rather than
      // letting the bar wrap into a second row.
      const group = el('div', { class: 'vb-group' }, [
        el(isWide() ? 'span' : 'label', { class: 'kicker', text: t('pivot.label', lang) }),
      ]);
      if (isWide()) {
        PIVOTS.forEach(p => group.appendChild(el('button', {
          class: 'btn mono' + (state.groupBy === p ? ' active' : ''),
          text: t('pivot.' + p, lang),
          onclick: () => setGroupBy(p),
        })));
      } else {
        group.appendChild(el('select', {
          class: 'pivot-select mono',
          'aria-label': t('pivot.label', lang),
          onchange: (e) => setGroupBy(e.target.value),
        }, PIVOTS.map(p => {
          const opt = el('option', { value: p, text: t('pivot.' + p, lang) });
          if (state.groupBy === p) opt.selected = true;
          return opt;
        })));
      }

      if (PIVOTS_WITH_UNATTRIBUTED.has(state.groupBy)) {
        group.appendChild(el('button', {
          class: 'btn mono unattributed-toggle' + (state.hideUnattributed ? ' active' : ''),
          text: t('pivot.hideUnattributed', lang),
          onclick: () => setHideUnattributed(!state.hideUnattributed),
        }));
        if (state.hideUnattributed) {
          const field = state.groupBy; // 'producer' | 'director' | 'writer'
          let hiddenCount = 0;
          for (const i of applyFilters()) {
            const v = DATA.rows[i][field];
            if (v == null || String(v).trim() === '') hiddenCount++;
          }
          if (hiddenCount > 0) {
            group.appendChild(el('span', {
              class: 'kicker unattributed-caption',
              text: hiddenCount.toLocaleString() + ' ' + t('pivot.hiddenSuffix', lang),
            }));
          }
        }
      }

      root.classList.toggle('is-narrowed', narrowed);
      root.replaceChildren(readout, tokens, group);
    }
    on(['narrow', 'readout', 'lang', 'groupBy', 'hideUnattributed', 'viewport'], render);
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
        title: doc.natjecaj_title || fallbackTitle || doc.filename || t('pdf.fallback_title', state.lang),
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
      const normalize = state.normalize;

      if (filteredIds.length === 0) {
        spacer.replaceChildren(el('div', { class: 'list-empty', text: t('status.empty', lang) }));
        spacer.style.height = '200px';
        updateStatus();
        return;
      }

      let visibleH, scrollTop;
      if (isMobile()) {
        visibleH = window.innerHeight || 600;
        const rect = scrollEl.getBoundingClientRect();
        scrollTop = Math.max(0, -rect.top);
      } else {
        visibleH = scrollEl.clientHeight || 600;
        scrollTop = scrollEl.scrollTop;
      }

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
          hasEvents && el('span', { class: 'events-pip', title: t('profile.events_count', lang, { n: events.length }) }),
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
            formatAmount(r.amount, 'HRK', lang) + ' ' + t('amount.original_suffix', lang) }),
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
      const titleText = p.key === UNATTRIBUTED_KEY ? t('col.unattributed', lang) : (p.title || t('col.untitled', lang));
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
        // Drilling into a group row produces exactly the token a rail chip
        // produces for the same value, so the rail lights up and the two can
        // never disagree — they are the same state now.
        addNarrow({
          dim, value,
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
            title: `${r.title || t('col.untitled', lang)} · ${y} · ${t('prog.' + (r.program || 'other'), lang)} · ${formatAmount(r.amount_eur, 'EUR', lang)}`,
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

      const titleText = project.key === UNATTRIBUTED_KEY ? t('col.unattributed', lang) : (project.title || t('col.untitled', lang));

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
              addNarrow({ dim: 'project', value: project.normTitle, label: project.title });
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
              addNarrow({ dim: 'program', value: r.program, label: t('prog.' + r.program, lang) });
            },
            title: t('profile.scope_short', lang),
          }),
          el('span', {
            class: 'rc-cat clickable',
            text: r.cat_type && r.cat_type !== 'other' ? t('cat.' + r.cat_type, lang) : '',
            onclick: (e) => {
              e.stopPropagation();
              if (!r.cat_type || r.cat_type === 'other') return;
              addNarrow({ dim: 'cat', value: r.cat_type, label: t('cat.' + r.cat_type, lang) });
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
                el('span', { class: 'tag decision', text: t('profile.decision_tag', lang) }),
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

    // The list owns the filtered set, so it owns the count. It publishes it and
    // the view bar renders it, which is why there is no longer a statusbar
    // stranded below the fold to hold this number.
    function updateStatus() {
      let sum = 0;
      for (const i of filteredIds) sum += (DATA.rows[i].amount_eur || 0);
      setReadout({ shown: filteredIds.length, total: DATA.rows.length, sum });
    }

    let rafQueued = false;
    const requestPaint = () => {
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(() => { rafQueued = false; paint(); });
    };
    scrollEl.addEventListener('scroll', requestPaint);
    window.addEventListener('scroll', requestPaint, { passive: true });
    window.addEventListener('resize', paint);

    on(['narrow', 'normalize', 'groupBy', 'sort', 'expanded', 'hideUnattributed', 'lang'], () => {
      recomputeData();
    });
    on(['viewport'], paint);

    root.replaceChildren(headerEl, scrollEl);

    recomputeData();
  }

  // ═══ 13. Analytics modal ════════════════════════════════════════════
  function mountAnalyticsModalLegacy() {
    let host = null;
    let keyHandler = null;

    function close() { setShowAnalytics(false); }

    function overviewStat(label, value, sub) {
      return el('article', { class: 'analytics-overview-stat' }, [
        el('span', { class: 'label', text: label }),
        el('span', { class: 'value', text: value }),
        sub ? el('span', { class: 'sub', text: sub }) : null,
      ]);
    }

    function kpiCard(spec, lang) {
      const isOpen = state.expandedAnalyticsKpi === spec.key;
      const onActivate = () => setExpandedAnalyticsKpi(spec.key);
      const children = [
        el('span', { class: 'label', text: spec.label }),
        el('span', { class: 'value', text: spec.value }),
        spec.sub ? el('span', { class: 'sub', text: spec.sub }) : null,
        el('span', { class: 'analytics-kpi-chevron' }, [
          fa(isOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'),
        ]),
      ];
      if (isOpen) {
        if (spec.formulaKey) {
          children.push(el('div', { class: 'analytics-kpi-detail' }, [
            el('div', { class: 'analytics-kpi-detail-label kicker', text: t('metric.formula.label', lang) }),
            el('div', { class: 'analytics-kpi-formula', text: t(spec.formulaKey, lang) }),
          ]));
        }
        if (spec.descKey) {
          children.push(el('div', { class: 'analytics-kpi-detail' }, [
            el('div', { class: 'analytics-kpi-detail-label kicker', text: t('metric.explain.label', lang) }),
            el('p', { class: 'analytics-kpi-explain', text: t(spec.descKey, lang) }),
          ]));
        }
      }
      return el('article', {
        class: 'analytics-kpi' + (isOpen ? ' is-expanded' : ''),
        role: 'button',
        tabindex: '0',
        'aria-expanded': isOpen ? 'true' : 'false',
        'aria-label': spec.label,
        title: isOpen ? '' : t('metric.expand.hint', lang),
        onclick: onActivate,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        },
      }, children);
    }

    function buildKpiSpecs(a, lang) {
      const producersSub = t('metric.producers.sub', lang, {
        n: (a.uniqueProducers || 0).toLocaleString(),
      });
      const skewValue = a.meanMedianRatio != null
        ? a.meanMedianRatio.toFixed(2) + '×'
        : '—';
      return [
        {
          key: 'top10ProdShare',
          label: t('metric.top10ProdShare', lang),
          value: formatPercent(a.concentration.top10, lang, 1),
          sub: `${t('metric.top50share', lang)}: ${formatPercent(a.concentration.top50, lang, 1)}`,
          formulaKey: 'formula.top10ProdShare',
          descKey: 'kpi.desc.top10ProdShare',
        },
        {
          key: 'giniProducers',
          label: t('metric.giniProducers', lang),
          value: formatPercent(a.gini, lang, 1),
          sub: producersSub,
          formulaKey: 'formula.giniProducers',
          descKey: 'kpi.desc.giniProducers',
        },
        {
          key: 'pareto50',
          label: t('metric.pareto50', lang),
          value: (a.pareto50?.count || 0).toLocaleString(),
          sub: t('metric.pareto.sub', lang, {
            share: formatPercent(a.pareto50?.share || 0, lang, 1),
          }),
          formulaKey: 'formula.pareto50',
          descKey: 'kpi.desc.pareto50',
        },
        {
          key: 'repeatFunded',
          label: t('metric.repeatFunded', lang),
          value: formatPercent(a.repeatFundedShare || 0, lang, 1),
          sub: t('metric.repeat.sub', lang, {
            n: (a.projectCount || 0).toLocaleString(),
          }),
          formulaKey: 'formula.repeatFunded',
          descKey: 'kpi.desc.repeatFunded',
        },
        {
          key: 'medianRounds',
          label: t('metric.medianRounds', lang),
          value: (a.medianRounds || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
          sub: null,
          formulaKey: 'formula.medianRounds',
          descKey: 'kpi.desc.medianRounds',
        },
        {
          key: 'largestProject',
          label: t('metric.largestProject', lang),
          value: formatAmount(a.largestProjectTotal || 0, 'EUR', lang),
          sub: t('metric.largest.sub', lang),
          formulaKey: 'formula.largestProject',
          descKey: 'kpi.desc.largestProject',
        },
        {
          key: 'p95',
          label: t('metric.p95', lang),
          value: formatAmount(a.p95Amount, 'EUR', lang),
          sub: a.p99Amount ? `P99: ${formatAmount(a.p99Amount, 'EUR', lang)}` : null,
          formulaKey: 'formula.p95',
          descKey: 'kpi.desc.p95',
        },
        {
          key: 'skew',
          label: t('metric.skew', lang),
          value: skewValue,
          sub: null,
          formulaKey: 'formula.skew',
          descKey: 'kpi.desc.skew',
        },
      ];
    }

    function mixList(items, lang, keyPrefix) {
      return el('div', { class: 'analytics-mix-list' }, items.map((m) => el('div', { class: 'analytics-mix-row' }, [
        el('div', { class: 'analytics-mix-head' }, [
          el('span', { class: 'analytics-mix-name', text: t(keyPrefix + m.key, lang) }),
          el('span', { class: 'analytics-mix-val mono', text: formatAmount(m.amount, 'EUR', lang) }),
          el('span', { class: 'analytics-mix-pct mono', text: formatPercent(m.share, lang, 1) }),
        ]),
        el('div', { class: 'analytics-mix-track' }, [
          el('div', { class: 'analytics-mix-fill', style: `width:${Math.max(1, m.share * 100)}%` }),
        ]),
      ])));
    }

    function yoyRow(kindKey, item, lang) {
      if (!item) {
        return el('div', { class: 'analytics-yoy-row' }, [
          el('span', { class: 'analytics-yoy-kind kicker', text: t(kindKey, lang) }),
          el('span', { class: 'analytics-yoy-year mono', text: '—' }),
          el('span', { class: 'analytics-yoy-delta mono', text: '—' }),
        ]);
      }
      const pctText = item.pct == null ? '—' : formatPercent(Math.abs(item.pct), lang, 1);
      return el('div', { class: 'analytics-yoy-row' }, [
        el('span', { class: 'analytics-yoy-kind kicker', text: t(kindKey, lang) }),
        el('span', { class: 'analytics-yoy-year mono', text: String(item.year) }),
        el('span', { class: 'analytics-yoy-delta mono', text: `${formatAmount(item.delta, 'EUR', lang)} · ${pctText}` }),
      ]);
    }

    function render() {
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      if (host) {
        host.remove();
        host = null;
      }

      if (!state.showAnalytics || !GLOBAL_ANALYTICS) return;

      const lang = state.lang;
      const a = GLOBAL_ANALYTICS;
      const yearVals = a.yearSeries.map(x => x.amount);
      const yearTooltips = a.yearSeries.map(x =>
        `${x.year} · ${formatCompact(x.amount, lang)} · ${x.count.toLocaleString()} ${t('metric.count', lang)}`);
      const histVals = a.sizeHistogram;
      const histTooltips = histVals.map((v, i) =>
        `${bandLabel(SIZE_BUCKETS[i], SIZE_BUCKETS[i + 1])} · ${v.toLocaleString()} ${t('metric.count', lang)}`);
      const notes = [];
      if (a.flags.pre2009Present) notes.push(t('analytics.note.pre2009', lang));
      if (a.flags.currentYearPartial) notes.push(t('analytics.note.current', lang, { year: a.flags.currentYear }));
      if (notes.length === 0) notes.push(t('analytics.note.stable', lang));

      host = el('div', { class: 'modal-backdrop', onclick: close }, [
        el('div', { class: 'modal modal-wide analytics-modal', onclick: (e) => e.stopPropagation() }, [
          el('div', { class: 'modal-head' }, [
            el('div', { class: 'analytics-head' }, [
              el('h2', { text: t('analytics.title', lang) }),
              el('p', { class: 'analytics-subhead mono', text: t('analytics.subtitle', lang) }),
            ]),
            el('button', { class: 'btn mono', onclick: close }, [
              fa('fa-solid fa-xmark', 'icon-left'),
              t('modal.close', lang),
            ]),
          ]),
          el('div', { class: 'modal-body analytics-body' }, [
            el('section', { class: 'analytics-overview-block' }, [
              el('div', { class: 'analytics-section-title kicker', text: t('analytics.overview', lang) }),
              el('div', { class: 'analytics-overview' }, [
                overviewStat(t('metric.total', lang), formatAmount(a.totalAmount, 'EUR', lang)),
                overviewStat(t('analytics.projects', lang), a.projectCount.toLocaleString()),
                overviewStat(t('metric.decisions', lang), a.rowCount.toLocaleString()),
                overviewStat(t('analytics.calls', lang), DATA.counts.docs_results_tables.toLocaleString()),
                overviewStat(t('metric.median', lang), formatAmount(a.medianAmount, 'EUR', lang)),
                overviewStat(t('analytics.unfunded', lang), DATA.counts.unfunded_mention_count.toLocaleString()),
              ]),
            ]),
            el('section', { class: 'analytics-kpis' }, buildKpiSpecs(a, lang).map((spec) => kpiCard(spec, lang))),
            el('section', { class: 'analytics-grid' }, [
              el('article', { class: 'analytics-card analytics-card-year' }, [
                el('div', { class: 'analytics-card-title kicker', text: t('analytics.yearly', lang) }),
                barsChart(yearVals, yearTooltips),
                el('div', { class: 'bars-labels' }, [
                  el('span', { text: a.yearSeries.length ? String(a.yearSeries[0].year) : '' }),
                  el('span', { text: a.yearSeries.length ? String(a.yearSeries[a.yearSeries.length - 1].year) : '' }),
                ]),
              ]),
              el('article', { class: 'analytics-card analytics-card-program' }, [
                el('div', { class: 'analytics-card-title kicker', text: t('analytics.program_mix', lang) }),
                mixList(a.programMix.slice(0, 10), lang, 'prog.'),
              ]),
              el('article', { class: 'analytics-card analytics-card-category' }, [
                el('div', { class: 'analytics-card-title kicker', text: t('analytics.category_mix', lang) }),
                mixList(a.categoryMix.slice(0, 10), lang, 'cat.'),
              ]),
              el('article', { class: 'analytics-card analytics-card-size' }, [
                el('div', { class: 'analytics-card-title kicker', text: t('analytics.size_dist', lang) }),
                barsChart(histVals, histTooltips),
                el('div', { class: 'bars-labels' }, [
                  el('span', { text: '€0' }),
                  el('span', { text: '€1M+' }),
                ]),
              ]),
            ]),
            el('section', { class: 'analytics-meta' }, [
              el('article', { class: 'analytics-card analytics-card-volatility' }, [
                el('div', { class: 'analytics-card-title kicker', text: t('analytics.volatility', lang) }),
                yoyRow('analytics.yoy.up', a.yoy.maxGain, lang),
                yoyRow('analytics.yoy.down', a.yoy.maxDrop, lang),
              ]),
              el('article', { class: 'analytics-card analytics-card-window' }, [
                el('div', { class: 'analytics-card-title kicker', text: t('analytics.window', lang) }),
                el('ul', { class: 'analytics-note-list' }, notes.map((line) =>
                  el('li', { class: 'analytics-note', text: line })
                )),
              ]),
            ]),
          ]),
        ]),
      ]);
      document.body.appendChild(host);

      keyHandler = (e) => {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', keyHandler);
    }

    on(['showAnalytics', 'lang', 'expandedAnalyticsKpi'], render);
    render();
  }

  // ═══ 14. Unfunded mentions modal ════════════════════════════════════
  function mountAnalyticsModal() {
    if (typeof window.createSredstvaAnalyticsStudio !== 'function') {
      console.error('analytics-studio.js did not load');
      return;
    }
    const controller = window.createSredstvaAnalyticsStudio({
      Analytics: window.SredstvaAnalytics,
      getData: () => DATA,
      getSanityReport: () => SANITY_REPORT,
      state,
      subscribe: on,
      setShowAnalytics,
      setSelectedYear,
      addNarrow,
      narrowOne,
      narrowSet,
      applyFilters,
      t,
      el,
      fa,
      formatAmount,
      formatPercent,
      bandLabel,
      asObject,
      toFiniteInt,
      HRK_TO_EUR,
      SIZE_BUCKETS,
    });
    controller.sync();
  }

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
                addNarrow({
                  dim: 'project',
                  value: u.family_id || normTitle(u.title),
                  label: u.title,
                });
                close();
              },
            }, [
              el('span', { class: 'y mono', text: u.first_year != null ? String(u.first_year) : '—' }),
              el('span', { class: 't', text: u.title }),
              el('span', { class: 'n mono', text: t('unfunded.sources_count', lang, {
                n: asArray(u.sources).length || asArray(u.narratives).length,
              }) }),
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
      const paneTitle = preview.title || t('pdf.fallback_title', lang);

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
      if (e.key === 'Escape' && state.mobileFiltersOpen) {
        setMobileFiltersOpen(false);
        return;
      }
      if (e.key === '/' && !inField) {
        e.preventDefault();
        const inp = document.querySelector('.search input');
        if (inp) inp.focus();
        return;
      }
      if (e.key === 'Escape' && !inField) {
        if (state.showAnalytics) {
          setShowAnalytics(false);
        } else if (state.pdfPreview) {
          setPdfPreview(null);
        } else if (state.expandedKey) {
          state.expandedKey = null;
          state.expandedRoundIds = new Set();
          state.expandedMentions = false;
          fire('expanded');
        } else if (state.narrow.length > 0) {
          popNarrow();
        }
      }
    });
  }

  // Widening past the drawer breakpoint puts the rail back in the layout, so an
  // open drawer must not linger on top of it.
  function installMobileFilterViewportGuard() {
    const sync = () => {
      if (!isRailDrawer()) setMobileFiltersOpen(false);
    };
    if (RAIL_DRAWER_MQL) {
      if (typeof RAIL_DRAWER_MQL.addEventListener === 'function') RAIL_DRAWER_MQL.addEventListener('change', sync);
      else if (typeof RAIL_DRAWER_MQL.addListener === 'function') RAIL_DRAWER_MQL.addListener(sync);
    }
    sync();
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
        el('p', { class: 'view-error', text: t('view.about.load_error', state.lang) }),
      ]));
      console.error(err);
    }

    // Prose paragraphs may carry inline links: [label](href) for a named link,
    // or a bare http(s) URL. Internal hrefs (#/process) stay in-tab.
    const INLINE_LINK = /\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;

    function inlineToNodes(text) {
      const src = String(text == null ? '' : text);
      const nodes = [];
      let last = 0;
      INLINE_LINK.lastIndex = 0;
      let m;
      while ((m = INLINE_LINK.exec(src)) !== null) {
        if (m.index > last) nodes.push(document.createTextNode(src.slice(last, m.index)));
        let label = m[1] || m[3];
        let href = m[2] || m[3];
        let trailing = '';
        if (!m[1]) {                              // bare URL: don't swallow sentence punctuation
          const trim = /[.,;:!?]+$/.exec(href);
          if (trim) {
            trailing = trim[0];
            href = href.slice(0, -trailing.length);
            label = href;
          }
        }
        const external = /^https?:\/\//i.test(href);
        nodes.push(el('a', {
          href,
          text: label,
          target: external ? '_blank' : null,
          rel: external ? 'noopener noreferrer' : null,
        }));
        if (trailing) nodes.push(document.createTextNode(trailing));
        last = m.index + m[0].length;
      }
      if (last < src.length) nodes.push(document.createTextNode(src.slice(last)));
      return nodes;
    }

    function paragraphsToNodes(arr) {
      return (arr || []).map(p => el('p', null, inlineToNodes(p)));
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
        el('p', { class: 'view-error', text: t('view.process.load_error', state.lang) }),
      ]));
      console.error(err);
    }

    function normalizeClaim(claim) {
      if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
        return {
          text: typeof claim.text === 'string' ? claim.text : '',
          sources: Array.isArray(claim.sources) ? claim.sources : [],
        };
      }
      return {
        text: claim == null ? '' : String(claim),
        sources: [],
      };
    }

    function renderSourceChips(sources) {
      const chips = (Array.isArray(sources) ? sources : []).map((src) => {
        if (!src || typeof src !== 'object') return null;
        const parts = [];
        if (src.label) parts.push(String(src.label));
        if (src.stamp) parts.push(String(src.stamp));
        const text = parts.join(' · ');
        if (!text) return null;
        const kind = src.kind ? (' source-chip--' + String(src.kind)) : '';
        return el('span', { class: 'source-chip mono' + kind, text });
      }).filter(Boolean);
      if (!chips.length) return null;
      return el('div', { class: 'source-chips' }, chips);
    }

    function renderClaimBlock(tag, className, claim) {
      const c = normalizeClaim(claim);
      if (!c.text && (!c.sources || !c.sources.length)) return null;
      return el(tag, { class: className }, [
        c.text ? el('span', { class: 'claim-text', text: c.text }) : null,
        renderSourceChips(c.sources),
      ]);
    }

    function renderClaimList(items) {
      return (items || []).map((line) => {
        const c = normalizeClaim(line);
        if (!c.text && (!c.sources || !c.sources.length)) return null;
        return el('li', null, [
          c.text ? el('span', { class: 'claim-text', text: c.text }) : null,
          renderSourceChips(c.sources),
        ]);
      }).filter(Boolean);
    }

    function computeLiveFacts() {
      const docs = DATA && Array.isArray(DATA.docs) ? DATA.docs : [];
      const rows = DATA && Array.isArray(DATA.rows) ? DATA.rows : [];
      const narratives = DATA && Array.isArray(DATA.narratives) ? DATA.narratives : [];
      const decisions = DATA && Array.isArray(DATA.decisions) ? DATA.decisions : [];
      const years = DATA && DATA.facets && Array.isArray(DATA.facets.years)
        ? DATA.facets.years.filter((y) => Number.isInteger(y)).sort((a, b) => a - b)
        : [];

      const sourceUrlMissingCount = docs.reduce((acc, d) => (
        acc + ((d && (!d.source_url || d.source_url_missing === true)) ? 1 : 0)
      ), 0);
      const projectFamilyCount = new Set(
        rows.map((row) => row && row.project_family_id).filter(Boolean),
      ).size;

      return {
        record_count: docs.length + narratives.length + decisions.length,
        results_doc_count: docs.length,
        narrative_count: narratives.length,
        decision_count: decisions.length,
        row_count: rows.length,
        awarded_count: rows.length,
        not_awarded_count: DATA && Array.isArray(DATA.non_awards) ? DATA.non_awards.length : 0,
        project_family_count: projectFamilyCount,
        source_url_missing_count: sourceUrlMissingCount,
        year_range: years.length ? `${years[0]}–${years[years.length - 1]}` : '—',
        hrk_to_eur: DATA && DATA.hrk_to_eur ? String(DATA.hrk_to_eur) : '—',
      };
    }

    function formatLiveFactValue(item, facts, lang) {
      if (!item || typeof item !== 'object') return '—';
      let raw = item.data_key ? facts[item.data_key] : item.value;
      if (raw == null || raw === '') return '—';
      if (typeof raw === 'number') {
        if (item.format === 'int' || item.format === 'number') {
          return raw.toLocaleString(lang === 'hr' ? 'hr-HR' : 'en-US');
        }
        return String(raw);
      }
      return String(raw);
    }

    function renderLiveFacts(liveFactsCfg, lang) {
      if (!liveFactsCfg || !Array.isArray(liveFactsCfg.items) || !liveFactsCfg.items.length) return null;
      const facts = computeLiveFacts();
      return el('section', { class: 'process-live-facts' }, [
        liveFactsCfg.title ? el('h2', { class: 'process-section-title', text: liveFactsCfg.title }) : null,
        liveFactsCfg.subtitle ? el('p', { class: 'process-live-facts-subhead', text: liveFactsCfg.subtitle }) : null,
        el('div', { class: 'live-facts-grid' }, liveFactsCfg.items.map((it) => el('article', { class: 'live-fact-card' }, [
          el('div', { class: 'live-fact-value display', text: formatLiveFactValue(it, facts, lang) }),
          el('div', { class: 'live-fact-label kicker', text: it.label || '' }),
          it.note ? el('div', { class: 'live-fact-note mono', text: it.note }) : null,
          renderSourceChips(it.sources),
        ]))),
        liveFactsCfg.footnote ? el('p', { class: 'process-live-facts-footnote', text: liveFactsCfg.footnote }) : null,
      ]);
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
        return el('div', { class: 'artifact artifact-note' }, [
          renderClaimBlock('div', 'artifact-note-line', a.text),
          renderSourceChips(a.sources),
        ]);
      }
      if (a.kind === 'file') {
        const head = el('div', { class: 'artifact-pill-head' }, [
          el('span', { class: 'artifact-path mono', text: a.path }),
          a.size ? el('span', { class: 'artifact-size mono', text: a.size }) : null,
        ]);
        return el('div', { class: 'artifact artifact-file' }, [
          head,
          a.note ? renderClaimBlock('div', 'artifact-note-line', a.note) : null,
          renderSourceChips(a.sources),
        ]);
      }
      if (a.kind === 'metric') {
        return el('div', { class: 'artifact artifact-metric' }, [
          el('div', { class: 'artifact-metric-value display', text: a.value }),
          el('div', { class: 'artifact-metric-label kicker', text: a.label }),
          a.note ? renderClaimBlock('div', 'artifact-metric-note mono', a.note) : null,
          renderSourceChips(a.sources),
        ]);
      }
      if (a.kind === 'code' || a.kind === 'quote') {
        const cls = 'artifact artifact-code' + (a.kind === 'quote' ? ' is-quote' : '');
        return el('div', { class: cls }, [
          a.caption ? el('div', { class: 'artifact-caption kicker', text: a.caption }) : null,
          el('pre', { class: 'artifact-code-body' }, [
            el('code', { class: 'mono', text: a.body || '' }),
          ]),
          renderSourceChips(a.sources),
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
        'aria-label': t('process.diagram_aria', state.lang),
      }, [defs, ...edgeNodes, ...nodeGroups]);

      return el('div', { class: 'flow-diagram' }, [svg]);
    }

    function renderExcerpt(excerpt, cls) {
      if (!excerpt) return null;
      const ex = typeof excerpt === 'string' ? { body: excerpt } : excerpt;
      return el('div', { class: cls || 'timeline-excerpt artifact-code' }, [
        ex.caption ? el('div', { class: 'artifact-caption kicker', text: ex.caption }) : null,
        el('pre', { class: 'artifact-code-body' }, [
          el('code', { class: 'mono', text: ex.body || '' }),
        ]),
        renderSourceChips(ex.sources),
      ]);
    }

    function renderPlainGuide(guide) {
      if (!guide) return null;
      const items = Array.isArray(guide.items) ? guide.items : [];
      return el('section', { class: 'deepdive-plain' }, [
        guide.title ? el('h3', { class: 'process-section-title', text: guide.title }) : null,
        guide.intro ? renderClaimBlock('p', 'deepdive-plain-intro', guide.intro) : null,
        items.length ? el('div', { class: 'plain-guide-grid' }, items.map((it) => el('article', { class: 'plain-guide-card' }, [
          it.title ? el('h4', { class: 'plain-guide-title', text: it.title }) : null,
          it.body ? renderClaimBlock('p', 'plain-guide-body', it.body) : null,
          renderSourceChips(it.sources),
        ]))) : null,
      ]);
    }

    function renderTimeline(timeline) {
      if (!timeline || !Array.isArray(timeline.checkpoints) || !timeline.checkpoints.length) return null;
      return el('section', { class: 'deepdive-timeline' }, [
        timeline.title ? el('h3', { class: 'process-section-title', text: timeline.title }) : null,
        timeline.intro ? renderClaimBlock('p', 'timeline-intro', timeline.intro) : null,
        el('div', { class: 'timeline-list' }, timeline.checkpoints.map((cp) => el('article', {
          class: 'timeline-item',
          id: cp.id || null,
        }, [
          el('header', { class: 'timeline-item-head' }, [
            cp.date ? el('div', { class: 'timeline-date mono', text: cp.date }) : null,
            cp.title ? el('h4', { class: 'timeline-title', text: cp.title }) : null,
          ]),
          cp.summary ? renderClaimBlock('p', 'timeline-summary', cp.summary) : null,
          (cp.problem || cp.decision || cp.result) ? el('div', { class: 'timeline-three-up' }, [
            cp.problem ? el('div', { class: 'timeline-lane' }, [
              el('div', { class: 'timeline-lane-label kicker', text: cp.problem_label || t('process.timeline.problem', state.lang) }),
              renderClaimBlock('p', 'timeline-lane-copy', cp.problem),
            ]) : null,
            cp.decision ? el('div', { class: 'timeline-lane' }, [
              el('div', { class: 'timeline-lane-label kicker', text: cp.decision_label || t('process.timeline.decision', state.lang) }),
              renderClaimBlock('p', 'timeline-lane-copy', cp.decision),
            ]) : null,
            cp.result ? el('div', { class: 'timeline-lane' }, [
              el('div', { class: 'timeline-lane-label kicker', text: cp.result_label || t('process.timeline.result', state.lang) }),
              renderClaimBlock('p', 'timeline-lane-copy', cp.result),
            ]) : null,
          ]) : null,
          (Array.isArray(cp.delta_metrics) && cp.delta_metrics.length) ? el('div', { class: 'timeline-metric-row' },
            cp.delta_metrics.map((m) => el('div', { class: 'timeline-metric' }, [
              el('div', { class: 'timeline-metric-value display', text: m.value || '—' }),
              el('div', { class: 'timeline-metric-label kicker', text: m.label || '' }),
              m.note ? el('div', { class: 'timeline-metric-note mono', text: m.note }) : null,
            ]))) : null,
          cp.excerpt_compact ? renderExcerpt(cp.excerpt_compact, 'timeline-excerpt artifact-code') : null,
          cp.excerpt_more ? el('details', { class: 'timeline-more' }, [
            el('summary', {
              class: 'timeline-more-summary mono',
              text: cp.excerpt_more.toggle_label || t('process.timeline.more_context', state.lang),
            }),
            renderExcerpt(cp.excerpt_more, 'timeline-excerpt timeline-excerpt-more artifact-code'),
          ]) : null,
          renderSourceChips(cp.sources),
        ]))),
      ]);
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
        p.what ? renderClaimBlock('p', 'pass-what', p.what) : null,
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
            renderSourceChips(m.sources),
          ]))) : null,
        (Array.isArray(p.artifacts) && p.artifacts.length) ? el('div', { class: 'pass-artifacts' },
          p.artifacts.map(a => renderArtifact(a, lang))) : null,
        renderSourceChips(p.sources),
      ]);
    }

    function renderTally(tally) {
      if (!tally || !Array.isArray(tally.items)) return null;
      return el('section', { class: 'deepdive-tally' }, [
        tally.title ? el('h3', { class: 'process-section-title', text: tally.title }) : null,
        tally.as_of ? el('p', { class: 'tally-as-of mono', text: tally.as_of }) : null,
        el('div', { class: 'tally-strip' }, tally.items.map(it => el('div', { class: 'tally-tile' }, [
          el('div', { class: 'display tally-tile-value', text: it.value }),
          el('div', { class: 'kicker tally-tile-label', text: it.label }),
          it.note ? el('div', { class: 'mono tally-tile-note', text: it.note }) : null,
          renderSourceChips(it.sources),
        ]))),
        tally.tokens_footnote ? renderClaimBlock('p', 'tokens-footnote mono', tally.tokens_footnote) : null,
        renderSourceChips(tally.sources),
      ]);
    }

    function renderDeepDive(dd, lang) {
      if (!dd) return null;
      const technicalBlocks = [
        dd.loop_diagram ? el('section', { class: 'deepdive-loop' }, [renderFlowDiagram(dd.loop_diagram)]) : null,
        (Array.isArray(dd.passes) && dd.passes.length) ? el('section', { class: 'deepdive-passes' },
          dd.passes.map(p => renderPassCard(p, lang))) : null,
        renderTally(dd.tally),
      ].filter(Boolean);
      return el('section', { class: 'process-deepdive' }, [
        el('header', { class: 'deepdive-head' }, [
          dd.kicker ? el('div', { class: 'kicker', text: dd.kicker }) : null,
          dd.headline ? el('h2', { class: 'display deepdive-headline', text: dd.headline }) : null,
          dd.subhead ? renderClaimBlock('p', 'deepdive-subhead', dd.subhead) : null,
          dd._todo_translate ? el('p', { class: 'deepdive-todo mono', text: t('process.deep_dive.todo', lang) }) : null,
        ]),
        renderPlainGuide(dd.plain_guide),
        renderTimeline(dd.timeline),
        technicalBlocks.length ? el('section', { class: 'deepdive-technical' }, [
          dd.technical_title ? el('h3', { class: 'process-section-title', text: dd.technical_title }) : null,
          ...technicalBlocks,
        ]) : null,
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
        renderClaimBlock('p', 'era-what', era.what),

        el('div', { class: 'era-pros-cons' }, [
          el('div', { class: 'era-prosbox era-prosbox--pros' }, [
            el('h4', { class: 'era-prosbox-title kicker', text: t('process.why_good', lang) }),
            el('ul', { class: 'era-prosbox-list' },
              renderClaimList(era.why_good || [])),
          ]),
          el('div', { class: 'era-prosbox era-prosbox--cons' }, [
            el('h4', { class: 'era-prosbox-title kicker', text: t('process.why_limited', lang) }),
            el('ul', { class: 'era-prosbox-list' },
              renderClaimList(era.why_limited || [])),
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
      const gridStyle = `--cmp-era-count:${Math.max(1, eras.length)};`;
      const headers = el('div', { class: 'cmp-row cmp-header', style: gridStyle }, [
        el('div', { class: 'cmp-cell cmp-cell-metric kicker', text: cmp.metric_label || '' }),
        ...eras.map(e => el('div', { class: 'cmp-cell kicker', text: e.label })),
      ]);
      const body = cmp.rows.map(row => el('div', { class: 'cmp-row', style: gridStyle }, [
        el('div', { class: 'cmp-cell cmp-cell-metric', text: row.metric }),
        ...eras.map(era => el('div', { class: 'cmp-cell', text: row[era.id] || '—' })),
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
          c.hero && c.hero.subhead ? renderClaimBlock('p', 'process-subhead', c.hero.subhead) : null,
        ]),

        renderLiveFacts(c.live_facts, lang),

        eras.length > 0 && el('section', { class: 'process-diagram-section' }, [
          el('h2', { class: 'process-section-title', text: t('process.diagram', lang) }),
          el('div', {
            class: 'process-diagram',
            style: `--process-era-count:${Math.max(1, eras.length)};`,
          }, eras.map(e => renderEraColumn(e, lang))),
        ]),

        eras.length > 0 && el('section', { class: 'process-eras' },
          eras.map(e => renderEraCard(e, lang))),

        deepDive ? renderDeepDive(deepDive, lang) : null,

        renderComparison(c.comparison, eras, lang),

        c.footnote ? renderClaimBlock('p', 'process-footnote', c.footnote) : null,
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

  // ═══ 18. Boot ═══════════════════════════════════════════════════════
  async function boot() {
    syncDocumentI18n(state.lang);
    document.body.classList.add('theme-' + state.theme);
    document.body.classList.remove('mobile-filters-open');
    document.body.classList.toggle('is-mobile', isMobile());
    document.body.classList.toggle('is-rail-drawer', isRailDrawer());
    state.view = 'dashboard';
    document.body.classList.add('view-' + state.view);

    const app = document.getElementById('app');
    app.replaceChildren(el('div', { class: 'boot' }, [
      el('div', { class: 'wordmark' }, [t('app.name', state.lang), el('span', { class: 'dot', text: '·' })]),
      el('div', { class: 'label', text: t('boot.loading_registry', state.lang) }),
    ]));

    const loadStarted = performance.now();
    try {
      await loadData();
    } catch (err) {
      app.replaceChildren(el('div', { class: 'boot' }, [
        el('div', { class: 'label', text: t('boot.load_data_error', state.lang) }),
      ]));
      console.error(err);
      return;
    }
    window.havcUsage?.('data_loaded', '', performance.now() - loadStarted);
    window.havcUsage?.('session_start', state.lang + '|' + state.theme);

    readSharedState();
    document.body.classList.remove('view-dashboard', 'view-about', 'view-process');
    document.body.classList.add('view-' + state.view);

    // No year seeding: the full span IS the unnarrowed state, so it needs no
    // token. The slider reads its own bounds from DATA.facets.years.

    app.className = 'app';
    app.replaceChildren(
      el('header', { class: 'topbar', id: 'topbar' }),
      el('div', { class: 'view-root', id: 'view-root' }, [
        el('div', { class: 'workspace', id: 'view-dashboard' }, [
          el('aside', { class: 'filter-rail', id: 'rail' }),
          el('div', {
            class: 'filter-drawer-backdrop',
            id: 'filter-drawer-backdrop',
            onclick: () => setMobileFiltersOpen(false),
          }),
          // Three bands, not six. #scope-row, #pivot and #year-pills merged into
          // #viewbar, and .statusbar is gone — its count moved up into the bar,
          // beside the tokens that produce it.
          el('main', { class: 'main' }, [
            el('section', { class: 'headline', id: 'headline' }),
            el('section', { class: 'insights', id: 'insights' }),
            el('section', { class: 'viewbar', id: 'viewbar' }),
            el('section', { class: 'list-wrap', id: 'listwrap' }),
          ]),
        ]),
        el('section', { class: 'about-host', id: 'view-about' }),
        el('section', { class: 'process-host', id: 'view-process' }),
      ]),
    );

    mountTopbar(document.getElementById('topbar'));
    mountFilterRail(document.getElementById('rail'));
    installMobileFilterViewportGuard();
    mountHeadline(document.getElementById('headline'));
    mountInsights(document.getElementById('insights'));
    // Mount the list before the view bar so the bar's first render already has a
    // readout to show instead of 0.
    mountList(document.getElementById('listwrap'));
    mountViewBar(document.getElementById('viewbar'));
    mountAbout(document.getElementById('view-about'));
    mountProcess(document.getElementById('view-process'));
    mountAnalyticsModal();
    mountUnfundedModal();
    mountPdfPreviewModal();
    mountKeyboard();

    applyViewVisibility();
    on('view', applyViewVisibility);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
