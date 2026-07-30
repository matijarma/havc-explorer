"""Curate HAVC extraction records into verified awards and project families.

The input remains the public ``data.json`` record array. This script:

1. Removes extraction artifacts already identified by previous audits.
2. Deduplicates non-idempotent parity additions within each source document.
3. Imports usable evidence from the legacy parity decisions.
4. Uses Claude Haiku for unresolved row adjudication and recurring-family review.
5. Adds explicit funding status, stable row IDs, family IDs, and provenance.

Dry-run is the default. Use ``--review`` to populate the Haiku decision cache and
``--apply`` to write the curated data and audit files.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "data.json"
CACHE_PATH = HERE / "data-curation-decisions.json"
AUDIT_PATH = HERE / "data-curation-audit.json"
LEGACY_RESULTS_PATH = HERE.parent.parent / "dataset" / "_parity_results"

CURATION_VERSION = "2.0"
HRK_PER_EUR = 7.5345
ARTIFACT_FLAGS = {"parity_drop", "phantom_row", "bogus_row"}
VALID_STATUSES = {"awarded", "not_awarded", "unresolved"}
HEADER_TITLES = {
    "stavka",
    "naslov",
    "naziv",
    "naziv programa",
    "projekt",
    "program",
    "producent",
    "podnositelj",
    "odobreno",
    "iznos",
    "kategorija",
    "ukupno",
    "sveukupno",
    "grand total",
}
GENERIC_FAMILY_BASES = {
    "program rada",
    "redovna djelatnost",
    "godisnji program",
    "filmski program",
    "skola animacije",
    "radionice",
    "festival",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha12(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def norm_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("đ", "d")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def token_set(value: Any) -> set[str]:
    return {tok for tok in norm_text(value).split() if len(tok) >= 2}


def jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def core_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "row_number": row.get("row_number"),
        "project_title": row.get("project_title"),
        "applicant": row.get("applicant"),
        "production_company": row.get("production_company"),
        "director": row.get("director"),
        "writer": row.get("writer"),
        "original_author": row.get("original_author"),
        "category": row.get("category"),
        "approved_amount": row.get("approved_amount"),
        "approved_amount_text": row.get("approved_amount_text"),
        "currency": row.get("currency"),
    }


def row_signature(section_index: int, row: dict[str, Any]) -> str:
    return canonical_json({"section_index": section_index, **core_row(row)})


def stable_row_id(
    source_sha: str,
    section_index: int,
    row: dict[str, Any],
    occurrence: int,
) -> str:
    existing = row.get("row_id")
    if isinstance(existing, str) and existing:
        return existing
    digest = sha12(row_signature(section_index, row))
    suffix = f"-{occurrence}" if occurrence else ""
    return f"{source_sha[:8]}:s{section_index}:{digest}{suffix}"


def record_source_name(record: dict[str, Any]) -> str:
    source = record.get("source") or {}
    return source.get("filename_decoded") or source.get("filename") or ""


def record_sha(record: dict[str, Any], record_index: int) -> str:
    source = record.get("source") or {}
    return source.get("sha256") or hashlib.sha256(
        f"{record_index}|{record_source_name(record)}".encode("utf-8")
    ).hexdigest()


def row_amount(row: dict[str, Any]) -> float | None:
    value = row.get("approved_amount")
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def format_amount_text(amount: float, currency: str | None) -> str:
    grouped = f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{grouped} {'€' if currency == 'EUR' else 'kn'}"


def clean_bullet_prefix(title: Any) -> Any:
    if not isinstance(title, str):
        return title
    return re.sub(r"^[\u2010\u2011\u2012\u2013\u2014\u2212]\s+", "", title).strip()


def title_is_amount_like(title: Any) -> bool:
    value = str(title or "").strip()
    return bool(value) and bool(re.fullmatch(r"[\s€$£]*[\d.,\s]+(?:kn|eur)?", value, re.I))


def title_is_fragment_like(title: Any) -> bool:
    value = str(title or "").strip()
    if not value:
        return False
    if norm_text(value) in HEADER_TITLES:
        return True
    if title_is_amount_like(value):
        return True
    if re.match(r"^[.\-–—]+\s*[.,\d]", value):
        return True
    if not any(ch.isalpha() for ch in value):
        return True
    return False


def review_reasons(row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    status = row.get("funding_status")
    title = str(row.get("project_title") or "").strip()
    amount = row_amount(row)
    curation = row.get("curation") or {}
    if status == "unresolved":
        reasons.append("unresolved_status")
    if not title:
        reasons.append("missing_title")
    if amount is None:
        reasons.append("missing_amount")
    elif amount <= 0:
        reasons.append("non_positive_amount")
    if title_is_fragment_like(title):
        reasons.append("fragment_or_artifact_title")
    if curation.get("legacy_raw_content"):
        reasons.append("legacy_raw_content_needs_mapping")
    return sorted(set(reasons))


def load_legacy_results(path: Path) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return results
    for item in sorted(path.glob("*.json")):
        try:
            payload = load_json(item, {})
        except (OSError, json.JSONDecodeError):
            continue
        sha = payload.get("sha256")
        if isinstance(sha, str) and sha:
            results[sha] = payload
    return results


def legacy_drop_locations(
    record: dict[str, Any],
    legacy: dict[str, Any] | None,
) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    if not legacy:
        return out
    sections = record.get("sections") or []
    for decision in legacy.get("decisions") or []:
        if decision.get("action") != "drop":
            continue
        section_index = decision.get("section_idx")
        row_index = decision.get("row_idx")
        if not isinstance(row_index, int):
            continue
        if isinstance(section_index, int):
            out.add((section_index, row_index))
            continue
        offset = 0
        for candidate_section, section in enumerate(sections):
            count = len(section.get("rows") or [])
            if offset <= row_index < offset + count:
                out.add((candidate_section, row_index - offset))
                break
            offset += count
    return out


def legacy_addition_indexes(
    legacy: dict[str, Any] | None,
) -> tuple[dict[str, list[dict[str, Any]]], dict[tuple[Any, ...], dict[str, Any]]]:
    by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
    raw_content: dict[tuple[Any, ...], dict[str, Any]] = {}
    if not legacy:
        return by_title, raw_content
    for addition in legacy.get("additions") or []:
        title = addition.get("project_title")
        if title:
            by_title[norm_text(title)].append(addition)
        raw = addition.get("raw_content")
        if raw:
            key = (
                addition.get("row_number"),
                addition.get("approved_amount"),
                norm_text(addition.get("category")),
            )
            raw_content[key] = addition
    return by_title, raw_content


def choose_legacy_addition(
    row: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not candidates:
        return None
    row_number = row.get("row_number")
    category = norm_text(row.get("category"))
    for candidate in candidates:
        if (
            candidate.get("row_number") == row_number
            and norm_text(candidate.get("category")) == category
        ):
            return candidate
    return candidates[0]


def mark_change(
    row: dict[str, Any],
    field: str,
    value: Any,
    reason: str,
    method: str = "machine",
) -> bool:
    if row.get(field) == value:
        return False
    curation = row.setdefault("curation", {})
    changes = curation.setdefault("changes", [])
    changes.append(
        {
            "field": field,
            "from": row.get(field),
            "to": value,
            "reason": reason,
            "method": method,
        }
    )
    row[field] = value
    return True


def deterministic_cleanup(
    source_records: list[dict[str, Any]],
    legacy_results: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records = copy.deepcopy(source_records)
    audit: dict[str, Any] = {
        "version": CURATION_VERSION,
        "generated_at": utc_now(),
        "input_records": len(records),
        "removed": [],
        "counts": Counter(),
    }

    for record_index, record in enumerate(records):
        if record.get("doc_type") != "results_table":
            continue
        sha = record_sha(record, record_index)
        legacy = legacy_results.get(sha)
        existing_record_curation = record.get("curation") or {}
        already_curated = existing_record_curation.get("version") == CURATION_VERSION
        drop_locations = set() if already_curated else legacy_drop_locations(record, legacy)
        additions_by_title, raw_additions = legacy_addition_indexes(legacy)
        seen: set[str] = set()
        id_occurrences: Counter[str] = Counter()
        kept_count = 0

        for section_index, section in enumerate(record.get("sections") or []):
            new_rows: list[dict[str, Any]] = []
            for row_index, row in enumerate(section.get("rows") or []):
                original_signature = row_signature(section_index, row)
                occurrence = id_occurrences[original_signature]
                id_occurrences[original_signature] += 1
                row["row_id"] = stable_row_id(sha, section_index, row, occurrence)

                extras = row.get("extras") or {}
                flag = extras.get("flag")
                action = extras.get("parity_action")
                removal_reason = None
                if action == "drop" or flag in ARTIFACT_FLAGS:
                    removal_reason = f"existing_marker:{action or flag}"
                elif (section_index, row_index) in drop_locations:
                    removal_reason = "legacy_parity_drop"
                if removal_reason:
                    audit["removed"].append(
                        {
                            "source_sha": sha,
                            "source_file": record_source_name(record),
                            "row_id": row["row_id"],
                            "reason": removal_reason,
                            "row": core_row(row),
                        }
                    )
                    audit["counts"]["removed_artifact"] += 1
                    continue

                cleaned_title = clean_bullet_prefix(row.get("project_title"))
                if cleaned_title != row.get("project_title"):
                    if mark_change(
                        row,
                        "project_title",
                        cleaned_title,
                        "strip_table_bullet_prefix",
                    ):
                        audit["counts"]["titles_cleaned"] += 1

                title_key = norm_text(row.get("project_title"))
                legacy_addition = choose_legacy_addition(
                    row, additions_by_title.get(title_key, [])
                )
                if legacy_addition:
                    amount = legacy_addition.get("approved_amount")
                    currency = legacy_addition.get("currency")
                    if amount is None:
                        amount = legacy_addition.get("approved_amount_original")
                        currency = legacy_addition.get("currency_original") or currency
                    if row_amount(row) is None and isinstance(amount, (int, float)) and amount > 0:
                        mark_change(
                            row,
                            "approved_amount",
                            float(amount),
                            "recover_legacy_addition_amount",
                        )
                        if not row.get("approved_amount_text"):
                            mark_change(
                                row,
                                "approved_amount_text",
                                legacy_addition.get("approved_amount_text")
                                or format_amount_text(float(amount), currency),
                                "recover_legacy_addition_amount_text",
                            )
                        if currency:
                            mark_change(
                                row,
                                "currency",
                                currency,
                                "recover_legacy_addition_currency",
                            )
                        audit["counts"]["legacy_amounts_recovered"] += 1
                    for field in ("applicant", "production_company"):
                        value = legacy_addition.get(field)
                        if value and not row.get(field):
                            mark_change(
                                row,
                                field,
                                value,
                                f"recover_legacy_addition_{field}",
                            )

                raw_key = (
                    row.get("row_number"),
                    row.get("approved_amount"),
                    norm_text(row.get("category")),
                )
                raw_addition = raw_additions.get(raw_key)
                if raw_addition and not row.get("project_title"):
                    row.setdefault("curation", {})["legacy_raw_content"] = raw_addition.get(
                        "raw_content"
                    )

                signature = row_signature(section_index, row)
                if signature in seen:
                    audit["removed"].append(
                        {
                            "source_sha": sha,
                            "source_file": record_source_name(record),
                            "row_id": row["row_id"],
                            "reason": "duplicate_row_signature",
                            "row": core_row(row),
                        }
                    )
                    audit["counts"]["removed_duplicate"] += 1
                    continue
                seen.add(signature)

                amount = row_amount(row)
                title = str(row.get("project_title") or "").strip()
                row["funding_status"] = (
                    "awarded" if amount is not None and amount > 0 and title else "unresolved"
                )
                curation = row.setdefault("curation", {})
                curation["version"] = CURATION_VERSION
                curation.setdefault("method", "machine")
                curation.setdefault("confidence", "high" if row["funding_status"] == "awarded" else "low")
                kept_count += 1
                new_rows.append(row)
            section["rows"] = new_rows

        record["schema_version"] = "1.1"
        record["curation"] = {
            "version": CURATION_VERSION,
            "reviewed_at": existing_record_curation.get("reviewed_at") or utc_now(),
            "result_rows": kept_count,
        }

    audit["counts"] = dict(audit["counts"])
    audit["output_records"] = len(records)
    return records, audit


def compact_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "row_id": row.get("row_id"),
        "row_number": row.get("row_number"),
        "project_title": row.get("project_title"),
        "applicant": row.get("applicant"),
        "production_company": row.get("production_company"),
        "category": row.get("category"),
        "approved_amount": row.get("approved_amount"),
        "approved_amount_text": row.get("approved_amount_text"),
        "currency": row.get("currency"),
        "funding_status": row.get("funding_status"),
        "reasons": review_reasons(row),
        "legacy_raw_content": (row.get("curation") or {}).get("legacy_raw_content"),
    }


def row_review_candidates(
    records: list[dict[str, Any]],
) -> list[tuple[int, dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]]:
    out = []
    for record_index, record in enumerate(records):
        if record.get("doc_type") != "results_table":
            continue
        flat: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        candidate_positions: set[int] = set()
        for section_index, section in enumerate(record.get("sections") or []):
            for row_index, row in enumerate(section.get("rows") or []):
                item = compact_row(row)
                item["section_index"] = section_index
                item["row_index"] = row_index
                flat.append(item)
                if review_reasons(row):
                    candidates.append(item)
                    candidate_positions.add(len(flat) - 1)
        if not candidates:
            continue
        context_positions: set[int] = set(candidate_positions)
        for position in candidate_positions:
            context_positions.update(
                p for p in range(max(0, position - 2), min(len(flat), position + 3))
            )
        context = [flat[p] for p in sorted(context_positions)]
        out.append((record_index, record, candidates, context))
    return out


ROW_REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "doc_sha": {"type": "string"},
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "row_id": {"type": "string"},
                    "action": {
                        "type": "string",
                        "enum": [
                            "keep_award",
                            "repair_award",
                            "artifact",
                            "not_awarded",
                            "unresolved",
                        ],
                    },
                    "canonical_title": {"type": ["string", "null"]},
                    "applicant": {"type": ["string", "null"]},
                    "production_company": {"type": ["string", "null"]},
                    "approved_amount": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"], "enum": ["HRK", "EUR", None]},
                    "merge_row_ids": {"type": "array", "items": {"type": "string"}},
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "evidence": {"type": "string"},
                },
                "required": [
                    "row_id",
                    "action",
                    "canonical_title",
                    "applicant",
                    "production_company",
                    "approved_amount",
                    "currency",
                    "merge_row_ids",
                    "confidence",
                    "evidence",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["doc_sha", "decisions"],
    "additionalProperties": False,
}


def row_review_prompt(
    record_index: int,
    record: dict[str, Any],
    candidates: list[dict[str, Any]],
    context: list[dict[str, Any]],
) -> str:
    doc = record.get("document") or {}
    totals = record.get("totals") or {}
    sha = record_sha(record, record_index)
    raw_text = str(record.get("raw_text") or "")
    if len(raw_text) > 45_000:
        raw_text = raw_text[:45_000]
    payload = {
        "source_sha": sha,
        "source_file": record_source_name(record),
        "document": {
            "program_type": doc.get("program_type"),
            "year": doc.get("year"),
            "rok": doc.get("rok"),
            "currency": doc.get("currency"),
        },
        "totals": totals,
        "candidate_rows": candidates,
        "nearby_rows": context,
        "raw_text": raw_text,
    }
    return (
        "Audit suspect rows from one Croatian HAVC public-funding source. "
        "Use only supplied source text and table context. A strange, numeric, quoted, "
        "or short creative title can be legitimate and must never be rejected by shape alone. "
        "Classify every candidate row. Use repair_award only when title and positive amount "
        "are supported by the source. Use artifact for headers, totals, duplicated fragments, "
        "addresses, or extraction debris. Use not_awarded only when the source explicitly "
        "shows rejection/non-award. Use unresolved when evidence is insufficient. "
        "If fragments are merged, select one target row_id and list all superseded row IDs in "
        "merge_row_ids. Currency and amount must be source currency, not converted EUR. "
        "Return only schema-compliant JSON.\n\n"
        + canonical_json(payload)
    )


def run_claude_structured(
    prompt: str,
    schema: dict[str, Any],
    timeout: int = 240,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    command = [
        "claude",
        "-p",
        prompt,
        "--model",
        "haiku",
        "--tools",
        "",
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(schema, separators=(",", ":")),
    ]
    last_error = ""
    for attempt in range(2):
        try:
            proc = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            last_error = str(exc)
            continue
        if proc.returncode != 0:
            last_error = proc.stderr.strip() or f"claude exit {proc.returncode}"
            continue
        try:
            envelope = json.loads(proc.stdout)
            structured = envelope.get("structured_output")
            if isinstance(structured, dict):
                return structured, {
                    "model": next(iter((envelope.get("modelUsage") or {}).keys()), "haiku"),
                    "cost_usd": envelope.get("total_cost_usd"),
                    "duration_ms": envelope.get("duration_ms"),
                    "attempt": attempt + 1,
                }
            last_error = "missing structured_output"
        except json.JSONDecodeError as exc:
            last_error = f"invalid claude envelope: {exc}"
    return None, {"error": last_error}


def load_cache(path: Path) -> dict[str, Any]:
    cache = load_json(
        path,
        {
            "version": CURATION_VERSION,
            "row_reviews": {},
            "family_reviews": {},
            "calls": [],
        },
    )
    cache.setdefault("version", CURATION_VERSION)
    cache.setdefault("row_reviews", {})
    cache.setdefault("family_reviews", {})
    cache.setdefault("calls", [])
    for sha, entry in list(cache["row_reviews"].items()):
        if not isinstance(entry, dict) or "batches" in entry:
            continue
        prompt_hash = entry.get("prompt_hash")
        if prompt_hash and entry.get("decision"):
            cache["row_reviews"][sha] = {
                "batches": {
                    prompt_hash: {
                        "decision": entry.get("decision"),
                        "reviewed_at": entry.get("reviewed_at"),
                    }
                }
            }
        else:
            cache["row_reviews"][sha] = {"batches": {}}
    return cache


def review_rows_with_haiku(
    records: list[dict[str, Any]],
    cache: dict[str, Any],
    cache_path: Path,
    jobs: int,
    limit: int | None,
) -> int:
    candidates = row_review_candidates(records)
    pending = []
    for record_index, record, rows, context in candidates:
        sha = record_sha(record, record_index)
        prompt = row_review_prompt(record_index, record, rows, context)
        prompt_hash = sha12(prompt)
        cached = cache["row_reviews"].get(sha)
        if cached and prompt_hash in (cached.get("batches") or {}):
            continue
        if cached and len(cached.get("batches") or {}) >= 3:
            continue
        pending.append((sha, prompt_hash, prompt))
    if limit is not None:
        pending = pending[:limit]
    if not pending:
        return 0

    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        futures = {
            pool.submit(run_claude_structured, prompt, ROW_REVIEW_SCHEMA): (
                sha,
                prompt_hash,
            )
            for sha, prompt_hash, prompt in pending
        }
        for future in as_completed(futures):
            sha, prompt_hash = futures[future]
            decision, meta = future.result()
            cache["calls"].append(
                {
                    "kind": "row_review",
                    "source_sha": sha,
                    "prompt_hash": prompt_hash,
                    "at": utc_now(),
                    **meta,
                }
            )
            if decision:
                entry = cache["row_reviews"].setdefault(sha, {"batches": {}})
                entry.setdefault("batches", {})[prompt_hash] = {
                    "decision": decision,
                    "reviewed_at": utc_now(),
                }
            completed += 1
            write_json(cache_path, cache)
            print(f"row review {completed}/{len(pending)}: {sha[:8]}", flush=True)
    return completed


def amount_supported_by_raw(amount: float, raw_text: str) -> bool:
    variants = {
        f"{amount:.2f}",
        f"{amount:,.2f}",
        f"{amount:,.2f}".replace(",", "."),
        f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", "."),
    }
    if float(amount).is_integer():
        variants.add(str(int(amount)))
    folded = raw_text.replace("\xa0", " ")
    return any(value in folded for value in variants)


def title_supported_by_raw(title: str, raw_text: str) -> bool:
    title_tokens = list(token_set(title))
    if not title_tokens:
        return False
    raw = norm_text(raw_text)
    meaningful = [tok for tok in title_tokens if len(tok) >= 4]
    if not meaningful:
        meaningful = title_tokens
    hits = sum(1 for tok in meaningful if tok in raw)
    return hits >= max(1, math.ceil(len(meaningful) * 0.7))


def decision_is_applicable(
    decision: dict[str, Any],
    record: dict[str, Any],
) -> bool:
    confidence = decision.get("confidence")
    if confidence == "high":
        return True
    if confidence != "medium" or decision.get("action") != "repair_award":
        return False
    title = decision.get("canonical_title")
    amount = decision.get("approved_amount")
    raw_text = str(record.get("raw_text") or "")
    return (
        isinstance(title, str)
        and isinstance(amount, (int, float))
        and amount > 0
        and title_supported_by_raw(title, raw_text)
        and amount_supported_by_raw(float(amount), raw_text)
    )


def decision_fingerprint(decision: dict[str, Any]) -> str:
    return canonical_json(
        {
            "action": decision.get("action"),
            "canonical_title": norm_text(decision.get("canonical_title")),
            "applicant": norm_text(decision.get("applicant")),
            "production_company": norm_text(decision.get("production_company")),
            "approved_amount": decision.get("approved_amount"),
            "currency": decision.get("currency"),
            "merge_row_ids": sorted(decision.get("merge_row_ids") or []),
        }
    )


def consensus_row_decisions(
    cached: dict[str, Any],
) -> tuple[dict[str, dict[str, Any] | None], set[str]]:
    by_row: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for batch in (cached.get("batches") or {}).values():
        payload = batch.get("decision") or {}
        for item in payload.get("decisions") or []:
            row_id = item.get("row_id")
            if isinstance(row_id, str):
                by_row[row_id].append(item)

    selected: dict[str, dict[str, Any] | None] = {}
    for row_id, decisions in by_row.items():
        high = [item for item in decisions if item.get("confidence") == "high"]
        pool = high or [item for item in decisions if item.get("confidence") == "medium"]
        if not pool:
            selected[row_id] = None
            continue
        counts = Counter(decision_fingerprint(item) for item in pool)
        best_count = max(counts.values())
        winners = [fingerprint for fingerprint, count in counts.items() if count == best_count]
        if len(winners) != 1:
            selected[row_id] = None
            continue
        winner = winners[0]
        selected[row_id] = next(
            item for item in reversed(pool) if decision_fingerprint(item) == winner
        )
    return selected, set(by_row)


def apply_row_reviews(
    records: list[dict[str, Any]],
    cache: dict[str, Any],
    audit: dict[str, Any],
) -> None:
    removed_ids: set[str] = set()
    for record_index, record in enumerate(records):
        if record.get("doc_type") != "results_table":
            continue
        sha = record_sha(record, record_index)
        cached = cache.get("row_reviews", {}).get(sha)
        if not cached:
            continue
        decisions, reviewed_ids = consensus_row_decisions(cached)
        rows_by_id: dict[str, dict[str, Any]] = {}
        for section in record.get("sections") or []:
            for row in section.get("rows") or []:
                if row.get("row_id"):
                    rows_by_id[row["row_id"]] = row

        for row_id in reviewed_ids:
            decision = decisions.get(row_id)
            row = rows_by_id.get(row_id)
            if not row:
                continue
            if decision is None:
                row["funding_status"] = "unresolved"
                row.setdefault("curation", {}).update(
                    {
                        "version": CURATION_VERSION,
                        "method": "claude-haiku-consensus",
                        "confidence": "low",
                        "evidence": "Conflicting or low-confidence Haiku decisions.",
                    }
                )
                continue
            if not decision_is_applicable(decision, record):
                row["funding_status"] = "unresolved"
                continue
            action = decision.get("action")
            curation = row.setdefault("curation", {})
            curation.update(
                {
                    "version": CURATION_VERSION,
                    "method": "claude-haiku",
                    "confidence": decision.get("confidence"),
                    "evidence": decision.get("evidence"),
                }
            )
            if action == "artifact":
                removed_ids.add(row_id)
                audit["counts"]["haiku_artifacts"] = (
                    audit["counts"].get("haiku_artifacts", 0) + 1
                )
            elif action == "repair_award":
                title = decision.get("canonical_title")
                amount = decision.get("approved_amount")
                if not isinstance(title, str) or not title.strip():
                    continue
                if not isinstance(amount, (int, float)) or amount <= 0:
                    continue
                for field in ("project_title", "applicant", "production_company", "currency"):
                    value = decision.get(
                        "canonical_title" if field == "project_title" else field
                    )
                    if value is not None:
                        mark_change(
                            row,
                            field,
                            value,
                            "haiku_source_reconciliation",
                            method="claude-haiku",
                        )
                mark_change(
                    row,
                    "approved_amount",
                    float(amount),
                    "haiku_source_reconciliation",
                    method="claude-haiku",
                )
                if not row.get("approved_amount_text"):
                    mark_change(
                        row,
                        "approved_amount_text",
                        format_amount_text(float(amount), decision.get("currency")),
                        "haiku_source_reconciliation",
                        method="claude-haiku",
                    )
                row["funding_status"] = "awarded"
                for merged_id in decision.get("merge_row_ids") or []:
                    if merged_id != row_id and merged_id in rows_by_id:
                        removed_ids.add(merged_id)
                audit["counts"]["haiku_repairs"] = (
                    audit["counts"].get("haiku_repairs", 0) + 1
                )
            elif action == "keep_award":
                amount = row_amount(row)
                title = str(row.get("project_title") or "").strip()
                if amount is not None and amount > 0 and title:
                    row["funding_status"] = "awarded"
            elif action == "not_awarded":
                row["funding_status"] = "not_awarded"
                audit["counts"]["haiku_not_awarded"] = (
                    audit["counts"].get("haiku_not_awarded", 0) + 1
                )
            else:
                row["funding_status"] = "unresolved"

    if not removed_ids:
        return
    for record in records:
        if record.get("doc_type") != "results_table":
            continue
        for section in record.get("sections") or []:
            kept = []
            for row in section.get("rows") or []:
                if row.get("row_id") in removed_ids:
                    audit["removed"].append(
                        {
                            "source_sha": (record.get("source") or {}).get("sha256"),
                            "source_file": record_source_name(record),
                            "row_id": row.get("row_id"),
                            "reason": "haiku_artifact_or_merge",
                            "row": core_row(row),
                        }
                    )
                    continue
                kept.append(row)
            section["rows"] = kept


def series_base(title: Any) -> str:
    value = norm_text(title)
    value = re.sub(r"^\d{1,3}\s+", "", value)
    value = re.sub(r"\b(?:19|20)\d{2}\b", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def representative_title(rows: list[dict[str, Any]]) -> str:
    titles = [str(row.get("project_title") or "").strip() for row in rows]
    titles = [title for title in titles if title]
    if not titles:
        return ""
    counts = Counter(titles)
    return sorted(
        counts,
        key=lambda title: (
            -counts[title],
            title.isupper(),
            len(title),
            title.casefold(),
        ),
    )[0]


def family_candidates(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record_index, record in enumerate(records):
        if record.get("doc_type") != "results_table":
            continue
        doc = record.get("document") or {}
        for section in record.get("sections") or []:
            for row in section.get("rows") or []:
                if row.get("funding_status") != "awarded":
                    continue
                base = series_base(row.get("project_title"))
                if len(base) < 4 or len(base.split()) < 2:
                    continue
                groups[base].append(
                    {
                        "row_id": row.get("row_id"),
                        "title": row.get("project_title"),
                        "year": doc.get("year"),
                        "program": doc.get("program_type"),
                        "category": row.get("category") or section.get("section_label"),
                        "entity": row.get("entity")
                        or row.get("production_company")
                        or row.get("applicant"),
                    }
                )
    out = []
    for base, rows in groups.items():
        title_norms = {norm_text(row["title"]) for row in rows}
        years = {row["year"] for row in rows if isinstance(row["year"], int)}
        if len(title_norms) < 2 or len(years) < 2:
            continue
        candidate_id = "fc_" + sha12(base + "|" + "|".join(sorted(title_norms)))
        out.append(
            {
                "candidate_id": candidate_id,
                "base": base,
                "rows": rows,
            }
        )
    return sorted(out, key=lambda item: item["candidate_id"])


FAMILY_REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "merge": {"type": "boolean"},
                    "family_title": {"type": ["string", "null"]},
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "reason": {"type": "string"},
                },
                "required": [
                    "candidate_id",
                    "merge",
                    "family_title",
                    "confidence",
                    "reason",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["groups"],
    "additionalProperties": False,
}


def family_review_prompt(groups: list[dict[str, Any]]) -> str:
    return (
        "Decide whether each candidate group represents one recurring creative project "
        "or event across annual/numbered editions. Numbers and years were removed only "
        "to generate candidates; they are not proof of identity. Require consistent "
        "distinctive wording and, when available, organizer/entity/category context. "
        "Do not merge related but distinct programs such as Zagreb Film Festival, "
        "Fantastic Zagreb Film Festival, KinoKino, or Industrija Zagreb Film Festivala. "
        "Use a clean edition-neutral family_title only for a confident merge. Return "
        "schema-compliant JSON only.\n\n"
        + canonical_json({"candidate_groups": groups})
    )


def review_families_with_haiku(
    records: list[dict[str, Any]],
    cache: dict[str, Any],
    cache_path: Path,
    batch_size: int = 20,
) -> int:
    candidates = family_candidates(records)
    pending = []
    for start in range(0, len(candidates), batch_size):
        batch = candidates[start : start + batch_size]
        prompt = family_review_prompt(batch)
        prompt_hash = sha12(prompt)
        if prompt_hash in cache["family_reviews"]:
            continue
        pending.append((prompt_hash, prompt))
    completed = 0
    for prompt_hash, prompt in pending:
        decision, meta = run_claude_structured(prompt, FAMILY_REVIEW_SCHEMA)
        cache["calls"].append(
            {
                "kind": "family_review",
                "prompt_hash": prompt_hash,
                "at": utc_now(),
                **meta,
            }
        )
        if decision:
            cache["family_reviews"][prompt_hash] = {
                "decision": decision,
                "reviewed_at": utc_now(),
            }
        completed += 1
        write_json(cache_path, cache)
        print(f"family review {completed}/{len(pending)}", flush=True)
    return completed


def family_review_decisions(cache: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out = {}
    for cached in cache.get("family_reviews", {}).values():
        for group in (cached.get("decision") or {}).get("groups") or []:
            candidate_id = group.get("candidate_id")
            if candidate_id:
                out[candidate_id] = group
    return out


def assign_families(
    records: list[dict[str, Any]],
    cache: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    rows_by_norm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    all_rows: dict[str, dict[str, Any]] = {}
    for record in records:
        if record.get("doc_type") != "results_table":
            continue
        for section in record.get("sections") or []:
            for row in section.get("rows") or []:
                row_id = row.get("row_id")
                if row_id:
                    all_rows[row_id] = row
                if row.get("funding_status") == "awarded":
                    rows_by_norm[norm_text(row.get("project_title"))].append(row)

    family_meta: dict[str, dict[str, Any]] = {}
    for title_norm, rows in rows_by_norm.items():
        family_id = "pf_" + sha12("exact|" + title_norm)
        title = representative_title(rows)
        family_meta[family_id] = {"title": title, "awarded": True}
        for row in rows:
            row["project_family_id"] = family_id
            row["project_family_title"] = title

    decisions = family_review_decisions(cache)
    for candidate in family_candidates(records):
        decision = decisions.get(candidate["candidate_id"])
        if not decision:
            continue
        if not decision.get("merge") or decision.get("confidence") != "high":
            continue
        title = str(decision.get("family_title") or "").strip()
        if not title:
            continue
        family_id = "pf_" + sha12("series|" + candidate["candidate_id"])
        family_meta[family_id] = {"title": title, "awarded": True}
        for item in candidate["rows"]:
            row = all_rows.get(item.get("row_id"))
            if not row:
                continue
            row["project_family_id"] = family_id
            row["project_family_title"] = title
            row.setdefault("curation", {})["family"] = {
                "method": "claude-haiku",
                "confidence": "high",
                "reason": decision.get("reason"),
                "candidate_id": candidate["candidate_id"],
            }

    awarded_aliases: dict[str, set[str]] = defaultdict(set)
    for row in all_rows.values():
        if row.get("funding_status") != "awarded":
            continue
        family_id = row.get("project_family_id")
        if not family_id:
            continue
        awarded_aliases[norm_text(row.get("project_title"))].add(family_id)
        awarded_aliases[norm_text(row.get("project_family_title"))].add(family_id)

    for row in all_rows.values():
        if row.get("funding_status") == "awarded":
            continue
        title_norm = norm_text(row.get("project_title"))
        exact = awarded_aliases.get(title_norm, set())
        if len(exact) == 1:
            family_id = next(iter(exact))
            row["project_family_id"] = family_id
            row["project_family_title"] = family_meta[family_id]["title"]
            continue
        if title_norm:
            family_id = "pf_" + sha12("nonaward|" + title_norm)
            title = str(row.get("project_title") or "").strip()
            family_meta.setdefault(family_id, {"title": title, "awarded": False})
            row["project_family_id"] = family_id
            row["project_family_title"] = title
    return family_meta


def link_event_projects(
    records: list[dict[str, Any]],
    family_meta: dict[str, dict[str, Any]],
) -> None:
    aliases: dict[str, set[str]] = defaultdict(set)
    alias_tokens: dict[str, set[str]] = {}
    for record in records:
        if record.get("doc_type") != "results_table":
            continue
        for section in record.get("sections") or []:
            for row in section.get("rows") or []:
                family_id = row.get("project_family_id")
                if not family_id:
                    continue
                for value in (row.get("project_title"), row.get("project_family_title")):
                    key = norm_text(value)
                    if key:
                        aliases[key].add(family_id)
                        alias_tokens[key] = token_set(value)

    family_aliases: dict[str, set[str]] = defaultdict(set)
    for alias, ids in aliases.items():
        for family_id in ids:
            family_aliases[family_id].add(alias)

    for record in records:
        if record.get("doc_type") not in {"narrative", "decision"}:
            continue
        document = record.get("document") or {}
        links = []
        for source_title in document.get("referenced_projects") or []:
            key = norm_text(source_title)
            family_id = None
            method = "unmatched"
            confidence = "low"
            exact = aliases.get(key, set())
            if len(exact) == 1:
                family_id = next(iter(exact))
                method = "exact_alias"
                confidence = "high"
            if family_id is None:
                base = series_base(source_title)
                base_matches = {
                    candidate_id
                    for alias, ids in aliases.items()
                    if series_base(alias) == base
                    for candidate_id in ids
                }
                if len(base_matches) == 1 and base:
                    family_id = next(iter(base_matches))
                    method = "series_base"
                    confidence = "high"
            if family_id is None:
                source_tokens = token_set(source_title)
                scored = []
                for candidate_id, candidate_aliases in family_aliases.items():
                    score = max(
                        (
                            jaccard(source_tokens, alias_tokens.get(alias, set()))
                            for alias in candidate_aliases
                        ),
                        default=0.0,
                    )
                    if score >= 0.82:
                        scored.append((score, candidate_id))
                scored.sort(reverse=True)
                if scored and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.15):
                    family_id = scored[0][1]
                    method = "token_similarity"
                    confidence = "medium"
            meta = family_meta.get(family_id or "", {})
            links.append(
                {
                    "source_title": source_title,
                    "family_id": family_id,
                    "family_title": meta.get("title"),
                    "match_status": "awarded"
                    if family_id and meta.get("awarded")
                    else "not_awarded"
                    if family_id
                    else "unmatched",
                    "method": method,
                    "confidence": confidence,
                }
            )
        document["project_links"] = links
        record["document"] = document
        record["schema_version"] = "1.1"


def validate_curated_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    summary = Counter()
    errors = []
    for record_index, record in enumerate(records):
        if record.get("doc_type") != "results_table":
            continue
        document = record.get("document") or {}
        awarded_sum = 0.0
        row_ids: set[str] = set()
        signature_seen: set[str] = set()
        for section_index, section in enumerate(record.get("sections") or []):
            for row in section.get("rows") or []:
                status = row.get("funding_status")
                summary[f"status_{status}"] += 1
                row_id = row.get("row_id")
                if not row_id or row_id in row_ids:
                    errors.append(f"duplicate_or_missing_row_id:{record_index}:{row_id}")
                row_ids.add(row_id)
                signature = row_signature(section_index, row)
                if signature in signature_seen:
                    errors.append(f"duplicate_signature:{record_index}:{row_id}")
                signature_seen.add(signature)
                if status not in VALID_STATUSES:
                    errors.append(f"invalid_status:{record_index}:{row_id}:{status}")
                if status == "awarded":
                    amount = row_amount(row)
                    title = str(row.get("project_title") or "").strip()
                    if amount is None or amount <= 0 or not title:
                        errors.append(f"invalid_award:{record_index}:{row_id}")
                    else:
                        awarded_sum += amount
                    if not row.get("project_family_id"):
                        errors.append(f"missing_family:{record_index}:{row_id}")
        totals = record.get("totals") or {}
        target = totals.get("sveukupno")
        if target is None:
            target = totals.get("ukupno")
        match = None
        if isinstance(target, (int, float)) and awarded_sum > 0:
            match = abs(awarded_sum - float(target)) <= 0.02
        record["validation"] = {
            "rows_sum": round(awarded_sum, 2) if awarded_sum else None,
            "ukupno_match": match,
            "row_count": len(row_ids),
            "awarded_count": sum(
                1
                for section in record.get("sections") or []
                for row in section.get("rows") or []
                if row.get("funding_status") == "awarded"
            ),
            "unresolved_count": sum(
                1
                for section in record.get("sections") or []
                for row in section.get("rows") or []
                if row.get("funding_status") == "unresolved"
            ),
            "not_awarded_count": sum(
                1
                for section in record.get("sections") or []
                for row in section.get("rows") or []
                if row.get("funding_status") == "not_awarded"
            ),
            "curation_version": CURATION_VERSION,
        }
        if document.get("currency") == "HRK":
            summary["awarded_eur_equivalent"] += awarded_sum / HRK_PER_EUR
        else:
            summary["awarded_eur_equivalent"] += awarded_sum
    summary["awarded_eur_equivalent"] = round(summary["awarded_eur_equivalent"], 2)
    return {"summary": dict(summary), "errors": errors}


def build_audit(
    base_audit: dict[str, Any],
    validation: dict[str, Any],
    cache: dict[str, Any],
    input_path: Path,
) -> dict[str, Any]:
    return {
        "version": CURATION_VERSION,
        "generated_at": utc_now(),
        "input": str(input_path),
        "input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "counts": base_audit.get("counts", {}),
        "validation": validation,
        "haiku": {
            "row_reviews": len(cache.get("row_reviews", {})),
            "family_review_batches": len(cache.get("family_reviews", {})),
            "calls": cache.get("calls", []),
        },
        "removed": base_audit.get("removed", []),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=DATA_PATH)
    parser.add_argument("--cache", type=Path, default=CACHE_PATH)
    parser.add_argument("--audit", type=Path, default=AUDIT_PATH)
    parser.add_argument("--legacy-results", type=Path, default=LEGACY_RESULTS_PATH)
    parser.add_argument("--review", action="store_true", help="Run missing Haiku reviews.")
    parser.add_argument("--apply", action="store_true", help="Write curated data and audit.")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument(
        "--max-row-docs",
        type=int,
        default=None,
        help="Review at most this many pending row documents in this run.",
    )
    parser.add_argument(
        "--skip-family-review",
        action="store_true",
        help="Do not request missing recurring-family reviews.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_records = load_json(args.data)
    if not isinstance(source_records, list):
        print("data.json must be an array of extraction records", file=sys.stderr)
        return 2
    legacy_results = load_legacy_results(args.legacy_results)
    cache = load_cache(args.cache)

    records, audit = deterministic_cleanup(source_records, legacy_results)
    apply_row_reviews(records, cache, audit)

    if args.review:
        review_rows_with_haiku(
            records,
            cache,
            cache_path=args.cache,
            jobs=args.jobs,
            limit=args.max_row_docs,
        )
        records, audit = deterministic_cleanup(source_records, legacy_results)
        apply_row_reviews(records, cache, audit)
        if not args.skip_family_review:
            review_families_with_haiku(records, cache, cache_path=args.cache)

    family_meta = assign_families(records, cache)
    link_event_projects(records, family_meta)
    validation = validate_curated_records(records)
    final_audit = build_audit(audit, validation, cache, args.data)

    print(json.dumps(final_audit["validation"]["summary"], ensure_ascii=False, indent=2))
    if validation["errors"]:
        print(f"validation errors: {len(validation['errors'])}", file=sys.stderr)
        for error in validation["errors"][:20]:
            print(f"  {error}", file=sys.stderr)
        return 1

    if args.apply:
        write_json(args.data, records)
        write_json(args.cache, cache)
        write_json(args.audit, final_audit)
        print(f"wrote {args.data}")
        print(f"wrote {args.audit}")
    else:
        print("dry run; use --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
