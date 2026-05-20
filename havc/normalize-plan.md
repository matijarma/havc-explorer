# Normalize pass plan

- Total results_table records: 542
- With source_url: 524
- Without source_url: 18
  - drop_doc (all rows duplicate): 3
  - partial (some rows duplicate): 5
  - flag_doc (no rows duplicate): 10
  - total duplicate rows to drop: 49
  - total orphan rows to flag: 78

## Per-doc breakdown

| classification | matched/rows | extractor | filename |
|---|---|---|---|
| **partial** | 18/33 (0.545) | claude-code-inline-subagent | `30_AV_proizvodnja_%E2%80%93%20kratkometra%C5%BEni%20igrani%20film-%201.%20ROK%20-%2007.%20travnja%202020..pdf` |
| **flag_doc** | 0/15 (0.0) | claude-code-inline-subagent | `FESTIVALI_I%20KAT_DUGI_2014_web.pdf` |
| **flag_doc** | 0/2 (0.0) | missing-results-backfill | `2013 Razvoj scenarija TV pojedina_na djela.pdf` |
| **flag_doc** | 0/3 (0.0) | claude-code-inline-subagent | `Poticanje_koprodukcija_s_manjinskim_udjelom_rok_19_07_2013.pdf` |
| **drop_doc** | 1/1 (1.0) | claude-code-inline-subagent | `30_%20AV_-%20Ostavi%20vrata%20otvorena_15072020_DR.pdf` |
| **flag_doc** | 0/6 (0.0) | missing-results-backfill | `preba_eno u razvoj projekta dugi igrani .pdf` |
| **drop_doc** | 3/3 (1.0) | claude-code-inline-subagent | `Rezultati%20JP%20koprodukcije%20rok%203110.pdf` |
| **drop_doc** | 1/1 (1.0) | claude-code-inline-subagent | `30_%20AV_-%20Po%C4%8Dinje%20bitka_15072020_DR.pdf` |
| **partial** | 15/16 (0.938) | claude-code-inline-subagent | `30_AV_komplementarnih%20djelatnosti%20u%202020.%20%E2%80%93%20programi%20me%C4%91unarodne%20suradnje%20%E2%80%9321.04.2020..pdf` |
| **partial** | 1/6 (0.167) | missing-results-backfill | `rezultati kratkometraz_ni igrani 2. rok 2025..pdf` |
| **flag_doc** | 0/1 (0.0) | missing-results-backfill | `preba_eno u razvoj projekta dokumentarni .pdf` |
| **flag_doc** | 0/1 (0.0) | claude-code-inline-subagent | `odluka_av_06072015_komplementarne_vanroka.pdf` |
| **flag_doc** | 0/3 (0.0) | claude-code-inline-subagent | `Razvoj_projekata_2013_21062013.pdf` |
| **flag_doc** | 0/3 (0.0) | missing-results-backfill | `preba_eno u razvoj scenarija dugi igrani .pdf` |
| **partial** | 1/2 (0.5) | missing-results-backfill | `4 rezultati AV MIKROPRORAC_UNSKI 2022.pdf` |
| **partial** | 9/17 (0.529) | claude-code-inline-subagent | `30_AV_RS_RP_%20dugometra%C5%BEnih%20dokumentarnih%20filmova,%201.%20rok%20-%2006.%20travnja%202020.%20g..pdf` |
| **flag_doc** | 0/1 (0.0) | missing-results-backfill | `2013 Razvoj projekata TV pojedina_na djela.pdf` |
| **flag_doc** | 0/13 (0.0) | claude-code-inline-subagent | `Razvoj_projekata_FF.pdf` |
