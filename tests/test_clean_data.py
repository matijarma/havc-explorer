from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace


MODULE_PATH = Path(__file__).resolve().parents[1] / "havc" / "clean_data.py"
SPEC = importlib.util.spec_from_file_location("clean_data", MODULE_PATH)
assert SPEC and SPEC.loader
clean_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(clean_data)


def result_record(rows, *, sha="a" * 64, year=2024, program="komplementarne"):
    return {
        "schema_version": "1.0",
        "doc_type": "results_table",
        "source": {"sha256": sha, "filename": "fixture.pdf"},
        "document": {
            "program_type": program,
            "year": year,
            "currency": "EUR",
        },
        "sections": [{"section_label": "fixture", "rows": rows}],
        "totals": {},
    }


def row(title, amount, **extra):
    value = {
        "row_number": extra.pop("row_number", 1),
        "project_title": title,
        "applicant": extra.pop("applicant", None),
        "production_company": extra.pop("production_company", None),
        "category": extra.pop("category", None),
        "approved_amount": amount,
        "approved_amount_text": str(amount) if amount is not None else None,
        "currency": "EUR",
        "extras": extra.pop("extras", {}),
    }
    value.update(extra)
    return value


def test_deterministic_cleanup_removes_markers_and_duplicates_without_title_blacklist():
    records = [
        result_record(
            [
                row("0.00", None, extras={"flag": "phantom_row"}),
                row("1 dan, 365 sati", 1000),
                row("1 dan, 365 sati", 1000),
                row("\u2010 Green Room Cinema 2012", 500, row_number=2),
            ]
        )
    ]

    cleaned, audit = clean_data.deterministic_cleanup(records, {})
    rows = cleaned[0]["sections"][0]["rows"]

    assert [item["project_title"] for item in rows] == [
        "1 dan, 365 sati",
        "Green Room Cinema 2012",
    ]
    assert all(item["funding_status"] == "awarded" for item in rows)
    assert audit["counts"]["removed_artifact"] == 1
    assert audit["counts"]["removed_duplicate"] == 1


def test_legacy_flat_row_drop_and_nonstandard_amount_recovery():
    sha = "b" * 64
    records = [
        result_record(
            [
                row(". broken fragment", 7000),
                row(
                    "Full project title",
                    None,
                    extras={"parity_action": "added"},
                    row_number=None,
                ),
            ],
            sha=sha,
        )
    ]
    legacy = {
        sha: {
            "sha256": sha,
            "decisions": [{"row_idx": 0, "action": "drop"}],
            "additions": [
                {
                    "project_title": "Full project title",
                    "applicant": "Applicant",
                    "approved_amount_original": 7000,
                    "currency_original": "HRK",
                }
            ],
        }
    }

    cleaned, _ = clean_data.deterministic_cleanup(records, legacy)
    rows = cleaned[0]["sections"][0]["rows"]

    assert len(rows) == 1
    assert rows[0]["project_title"] == "Full project title"
    assert rows[0]["approved_amount"] == 7000
    assert rows[0]["currency"] == "HRK"
    assert rows[0]["funding_status"] == "awarded"


def test_deterministic_cleanup_is_stable_after_first_curation():
    records = [result_record([row("Project", 1000)])]
    first, _ = clean_data.deterministic_cleanup(records, {})
    second, _ = clean_data.deterministic_cleanup(first, {})

    assert first == second


def test_existing_curation_change_log_is_deduplicated():
    duplicate = {
        "field": "project_title",
        "from": "F ilm",
        "to": "Film",
        "reason": "haiku_source_reconciliation",
        "method": "claude-haiku",
    }
    source = result_record(
        [
            row(
                "Film",
                1000,
                curation={"changes": [duplicate, duplicate]},
            )
        ]
    )
    source["curation"] = {"version": clean_data.CURATION_VERSION}

    cleaned, _ = clean_data.deterministic_cleanup([source], {})

    assert cleaned[0]["sections"][0]["rows"][0]["curation"]["changes"] == [
        duplicate
    ]


def test_machine_recovers_shifted_project_and_applicant_columns():
    records = [
        result_record(
            [
                row(
                    "Applicant association",
                    15000,
                    extras={"Naziv p rograma": "12. F estival p rava d jece"},
                ),
            ]
        )
    ]
    records[0]["sections"][0]["columns"] = [
        "Naziv p redlagatelja",
        "Naziv p rograma",
        "Odobrena sredstva",
    ]

    cleaned, audit = clean_data.deterministic_cleanup(records, {})
    repaired = cleaned[0]["sections"][0]["rows"][0]

    assert repaired["project_title"] == "12. F estival p rava d jece"
    assert repaired["applicant"] == "Applicant association"
    assert audit["counts"]["titles_recovered"] == 1
    assert "ocr_letter_spacing" in clean_data.review_reasons(repaired)


def test_primary_source_corrections_replace_documents_and_patch_rows():
    replacement_sha = "f" * 64
    patch_sha = "1" * 64
    records = [
        result_record([row("", 2400)], sha=replacement_sha),
        result_record([row("Verified project", None, row_number=8)], sha=patch_sha),
    ]
    corrections = {
        "documents": {
            replacement_sha: {
                "evidence": "Original PDF.",
                "replace_sections": [
                    {
                        "section_label": "verified",
                        "rows": [row("Recovered project", 5000, row_number=1)],
                    }
                ],
                "totals": {"ukupno": 5000},
            },
            patch_sha: {
                "row_patches": [
                    {
                        "section_index": 0,
                        "row_number": 8,
                        "fields": {
                            "approved_amount": 1000,
                            "approved_amount_text": "1.000,00",
                        },
                    }
                ]
            },
        }
    }

    cleaned, audit = clean_data.deterministic_cleanup(records, {}, corrections)

    assert cleaned[0]["sections"][0]["rows"][0]["project_title"] == "Recovered project"
    assert cleaned[0]["totals"]["ukupno"] == 5000
    assert cleaned[1]["sections"][0]["rows"][0]["approved_amount"] == 1000
    assert audit["counts"]["source_documents_reconciled"] == 1
    assert audit["counts"]["source_rows_reconciled"] == 1


def test_structural_review_reasons_do_not_reject_numbered_editions():
    edition = row("17. Zagreb Film Festival", 1000)
    flattened = row("1. - Applicant - Project title - 10.000,00", 10000)

    assert clean_data.review_reasons(edition) == []
    assert "flattened_table_row" in clean_data.review_reasons(flattened)
    assert "embedded_amount_in_title" in clean_data.review_reasons(flattened)


def test_diacritics_are_restored_from_split_source_words():
    repaired = clean_data.restore_evidence_diacritics(
        "Festival prava djece - ostecenjem sluha i vida",
        "Festival p rava d jece - o štećenjem s luha i v ida",
    )

    assert repaired == "Festival prava djece - oštećenjem sluha i vida"


def test_claude_prompt_is_sent_over_stdin(monkeypatch):
    seen = {}

    def fake_run(command, **kwargs):
        seen["command"] = command
        seen["input"] = kwargs.get("input")
        return SimpleNamespace(
            returncode=0,
            stderr="",
            stdout=json.dumps(
                {
                    "structured_output": {"ok": True},
                    "modelUsage": {"claude-haiku": {}},
                }
            ),
        )

    monkeypatch.setattr(clean_data.subprocess, "run", fake_run)
    result, meta = clean_data.run_claude_structured(
        "x" * 50_000,
        {
            "type": "object",
            "properties": {"ok": {"type": "boolean"}},
            "required": ["ok"],
        },
    )

    assert result == {"ok": True}
    assert seen["input"] == "x" * 50_000
    assert "x" * 50_000 not in seen["command"]
    assert meta["attempt"] == 1


def test_claude_api_error_is_read_from_json_stdout(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(
            returncode=1,
            stderr="",
            stdout=json.dumps(
                {
                    "api_error_status": 403,
                    "result": "Subscription access is disabled.",
                }
            ),
        )

    monkeypatch.setattr(clean_data.subprocess, "run", fake_run)
    result, meta = clean_data.run_claude_structured(
        "prompt",
        {"type": "object", "properties": {}},
    )

    assert result is None
    assert meta["error"] == "Claude API 403: Subscription access is disabled."
    assert len(calls) == 1


def test_failed_review_batch_marks_candidates_reviewed_but_unresolved():
    selected, reviewed, reasons = clean_data.consensus_row_decisions(
        {
            "batches": {
                "failed": {
                    "status": "failed",
                    "candidate_reasons": {"row-1": ["flattened_table_row"]},
                }
            }
        }
    )

    assert selected == {"row-1": None}
    assert reviewed == {"row-1"}
    assert reasons["row-1"] == {"flattened_table_row"}


def test_failed_batch_can_be_recovered_from_claude_session(tmp_path):
    source_sha = "e" * 64
    row_ids = ["row-1", "row-2"]

    def decision(row_id):
        return {
            "doc_sha": source_sha,
            "decisions": [
                {
                    "row_id": row_id,
                    "action": "keep_award",
                    "canonical_title": "Project",
                    "applicant": None,
                    "production_company": None,
                    "approved_amount": 1000,
                    "currency": "EUR",
                    "merge_row_ids": [],
                    "confidence": "high",
                    "evidence": "Source row.",
                }
            ],
        }

    for index, row_id in enumerate(row_ids):
        prompt_payload = {
            "source_sha": source_sha,
            "candidate_rows": [{"row_id": row_id}],
        }
        session_lines = [
            json.dumps(
                {
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": "Instructions\r\n\r\n" + json.dumps(prompt_payload),
                    },
                }
            ),
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "StructuredOutput",
                                "input": decision(row_id),
                            }
                        ],
                    },
                }
            ),
        ]
        (tmp_path / f"session-{index}.jsonl").write_bytes(
            "\r\n".join(session_lines).encode("utf-8")
        )

    expected_decision = {
        "doc_sha": source_sha,
        "decisions": [
            {
                "row_id": "row-1",
                "action": "keep_award",
                "canonical_title": "Project",
                "applicant": None,
                "production_company": None,
                "approved_amount": 1000,
                "currency": "EUR",
                "merge_row_ids": [],
                "confidence": "high",
                "evidence": "Source row.",
            },
            {
                "row_id": "row-2",
                "action": "keep_award",
                "canonical_title": "Project",
                "applicant": None,
                "production_company": None,
                "approved_amount": 1000,
                "currency": "EUR",
                "merge_row_ids": [],
                "confidence": "high",
                "evidence": "Source row.",
            },
        ],
    }
    cache = {
        "row_reviews": {
            source_sha: {
                "batches": {
                    "prompt": {
                        "status": "failed",
                        "candidate_reasons": {
                            row_id: ["flattened_table_row"] for row_id in row_ids
                        },
                        "error": "strict coverage failure",
                    }
                }
            }
        }
    }

    recovered = clean_data.recover_row_reviews_from_sessions(cache, tmp_path)
    batch = cache["row_reviews"][source_sha]["batches"]["prompt"]

    assert recovered == 1
    assert batch["status"] == "ok"
    assert batch["decision"] == expected_decision
    assert batch["recovered_from_sessions"] == [
        "session-0.jsonl",
        "session-1.jsonl",
    ]


def test_explicit_withdrawal_is_treated_as_nonaward_evidence():
    assert clean_data.evidence_indicates_explicit_nonaward(
        "Projekt je odustao od sklapanja ugovora o sufinanciranju."
    )
    assert not clean_data.evidence_indicates_explicit_nonaward(
        "Projekt je dobio ugovor o sufinanciranju."
    )


def test_high_confidence_keep_award_repairs_missing_amount():
    record = result_record(
        [
            row(
                "1970",
                None,
                applicant="PomPom Film d.o.o.",
                approved_amount_text="65.000,00 €",
            )
        ]
    )
    cleaned, audit = clean_data.deterministic_cleanup([record], {})
    target = cleaned[0]["sections"][0]["rows"][0]
    cache = {
        "row_reviews": {
            "a" * 64: {
                "batches": {
                    "review": {
                        "candidate_reasons": {
                            target["row_id"]: ["missing_amount"]
                        },
                        "decision": {
                            "doc_sha": "a" * 64,
                            "decisions": [
                                {
                                    "row_id": target["row_id"],
                                    "action": "keep_award",
                                    "canonical_title": "1970",
                                    "applicant": "PomPom Film d.o.o.",
                                    "production_company": "PomPom Film d.o.o.",
                                    "approved_amount": 65000,
                                    "currency": "EUR",
                                    "merge_row_ids": [],
                                    "confidence": "high",
                                    "evidence": "Official award row.",
                                }
                            ],
                        },
                    }
                }
            }
        }
    }

    clean_data.apply_row_reviews(cleaned, cache, audit)

    assert target["approved_amount"] == 65000
    assert target["funding_status"] == "awarded"


def test_family_review_groups_editions_but_not_distinct_festival():
    records = [
        result_record(
            [
                row("17. Zagreb Film Festival", 1000, row_number=1),
                row("18. Zagreb Film Festival", 1200, row_number=2),
                row("13. Fantastic Zagreb Film Festival", 700, row_number=3),
                row("14. Fantastic Zagreb Film Festival", 800, row_number=4),
            ],
            year=2020,
        ),
        result_record(
            [
                row("19. Zagreb Film Festival", 1400, row_number=1),
                row("15. Fantastic Zagreb Film Festival", 900, row_number=2),
            ],
            sha="c" * 64,
            year=2021,
        ),
    ]
    cleaned, _ = clean_data.deterministic_cleanup(records, {})
    candidates = clean_data.family_candidates(cleaned)
    zff = next(item for item in candidates if item["base"] == "zagreb film festival")
    cache = {
        "family_reviews": {
            "fixture": {
                "decision": {
                    "groups": [
                        {
                            "candidate_id": zff["candidate_id"],
                            "merge": True,
                            "family_title": "Zagreb Film Festival",
                            "confidence": "high",
                            "reason": "Same numbered annual event.",
                        }
                    ]
                }
            }
        }
    }

    clean_data.assign_families(cleaned, cache)
    rows = [
        item
        for record in cleaned
        for section in record["sections"]
        for item in section["rows"]
    ]
    zff_ids = {
        item["project_family_id"]
        for item in rows
        if "Fantastic" not in item["project_title"]
    }
    fantastic_ids = {
        item["project_family_id"]
        for item in rows
        if "Fantastic" in item["project_title"]
    }

    assert len(zff_ids) == 1
    assert len(fantastic_ids) == 3
    assert zff_ids.isdisjoint(fantastic_ids)


def test_nonaward_edition_links_to_verified_recurring_family():
    records = [
        result_record(
            [
                row("17. Zagreb Film Festival", 1000, row_number=1),
                row("18. Zagreb Film Festival", 1200, row_number=2),
                row("19. Zagreb Film Festival", 0, row_number=3),
            ]
        ),
        result_record(
            [row("20. Zagreb Film Festival", 1400, row_number=1)],
            sha="d" * 64,
            year=2025,
        ),
    ]
    cleaned, _ = clean_data.deterministic_cleanup(records, {})
    candidates = clean_data.family_candidates(cleaned)
    zff = next(item for item in candidates if item["base"] == "zagreb film festival")
    cache = {
        "family_reviews": {
            "fixture": {
                "decision": {
                    "groups": [
                        {
                            "candidate_id": zff["candidate_id"],
                            "merge": True,
                            "family_title": "Zagreb Film Festival",
                            "confidence": "high",
                            "reason": "Same numbered annual event.",
                        }
                    ]
                }
            }
        }
    }

    clean_data.assign_families(cleaned, cache)
    rows = [
        item
        for record in cleaned
        for section in record["sections"]
        for item in section["rows"]
    ]
    family_ids = {item["project_family_id"] for item in rows}

    assert len(family_ids) == 1
