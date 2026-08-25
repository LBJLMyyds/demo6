"""Conflict resolution engine.

`clean.build_conflict_candidates()` only *detects* yes/no disagreements — every
row it produces starts out with status="open" and stays there forever. That
was intentional (see its docstring: "for the future conflict resolution
engine"), but it means nothing in the database or the frontend can currently
tell a genuine, still-unresolved disagreement apart from one a human already
looked at.

This module is that missing piece. For every detected conflict it decides one
of three outcomes and records *why* in `notes`, so every decision is auditable
rather than a black box:

- ``resolved_recent_evidence`` — a cluster of recent, mutually-agreeing
  reports overrides older conflicting evidence. Accessibility features
  genuinely change over time (a ramp gets installed, a bathroom gets
  renovated), so recent independent agreement is meaningful signal.
- ``resolved_majority`` — a well-evidenced, lopsided majority (>= 75% of a
  sample of at least 4 reports). Deliberately not triggered by a bare 2-1
  split; see docs/metric_validation_plan.md section 4, which explicitly
  treats "coverage" as unsafe to optimise for on its own.
- ``needs_human_review`` — evidence is too sparse or too evenly split to
  trust an automatic call. This is the conservative default, and on the
  current dataset it's where most conflicts land — that's the engine
  behaving safely, not underperforming.

Design follows docs/metric_validation_plan.md section 4 directly: "a
conservative system with lower coverage and higher accuracy may be safer than
one that resolves every conflict," and "all low-confidence or tied cases are
sent to human review."

Resolution *accuracy* (does an auto-resolved case actually match verified
ground truth?) cannot be measured yet — that needs the labelled
`data/validation/ground_truth_places.csv` described in the same plan, which
doesn't exist yet. `coverage` and `human_review_rate` (see
`resolution_summary()` below) don't need ground truth and are safe to report
today.
"""

from __future__ import annotations

from datetime import timedelta

import pandas as pd

STATUS_NEEDS_REVIEW = "needs_human_review"
STATUS_RESOLVED_RECENT = "resolved_recent_evidence"
STATUS_RESOLVED_MAJORITY = "resolved_majority"

# A report only counts as "recent" evidence if it falls within this many days
# of the newest report for that place+feature. Chosen from the data itself:
# among conflicts with usable timestamps, ~1/3 have all reports submitted the
# same day (no real time signal — recency must not fire there) while the
# median gap between oldest and newest report is ~119 days. 14 days
# conservatively separates same-batch noise from a genuine time gap.
RECENT_WINDOW_DAYS = 14

# A count-based majority is only trusted with a reasonably sized sample, so a
# single extra reviewer can't flip a 2-report venue on raw count alone.
MAJORITY_MIN_EVIDENCE = 4
MAJORITY_THRESHOLD = 0.75


def _parse_timestamp(value: object) -> pd.Timestamp | None:
    """Parse a reviewed_at value, or return None if it isn't a real timestamp.

    A small number of reviewed_at values are corrupted upstream (literal
    "yes" / "no" / "unsure" strings landing in this column — almost
    certainly a CSV column shift in the same family of issues as the
    encoding artifacts already logged in frontend/data/meta.json). Those
    rows are treated as "timestamp unknown" here rather than raising or,
    worse, silently sorting as if they were valid dates.
    """
    try:
        parsed = pd.to_datetime(value, utc=True, errors="raise")
    except (ValueError, TypeError):
        return None
    if pd.isna(parsed):
        return None
    return parsed


def _review_evidence(accessibility_features: pd.DataFrame, reviews: pd.DataFrame) -> pd.DataFrame:
    """Individual review-level accessibility_features rows with parsed timestamps attached."""
    review_level = accessibility_features[accessibility_features["review_id"].notna()].copy()
    timestamp_by_review = reviews.set_index("review_id")["reviewed_at"].apply(_parse_timestamp)
    review_level["reviewed_at"] = review_level["review_id"].map(timestamp_by_review)
    return review_level


def _resolve_one(candidate: pd.Series, place_feature_evidence: pd.DataFrame) -> tuple[str, str]:
    """Decide the status + human-readable rationale for one conflict candidate."""
    total = int(candidate["yes_count"] + candidate["no_count"] + candidate["unsure_count"])

    # Rule 1 — recent, corroborated evidence overrides older conflicting evidence.
    dated = place_feature_evidence.dropna(subset=["reviewed_at"]).sort_values("reviewed_at", ascending=False)
    if len(dated) >= 2:
        newest_time = dated.iloc[0]["reviewed_at"]
        cutoff = newest_time - timedelta(days=RECENT_WINDOW_DAYS)
        recent = dated[dated["reviewed_at"] >= cutoff]
        older = dated[dated["reviewed_at"] < cutoff]
        recent_values = set(recent["value"])
        if len(recent) >= 2 and len(recent_values) == 1 and not older.empty:
            recent_value = recent_values.pop()
            if recent_value in ("yes", "no") and (older["value"] != recent_value).any():
                return (
                    STATUS_RESOLVED_RECENT,
                    f"{len(recent)} reports since {cutoff.date()} agree on '{recent_value}', "
                    f"overriding evidence older than that — accessibility features can change "
                    f"over time, so recent agreement outweighs a stale conflicting report.",
                )

    # Rule 2 — a strong, well-evidenced majority.
    if total >= MAJORITY_MIN_EVIDENCE:
        for value, count in (("yes", candidate["yes_count"]), ("no", candidate["no_count"])):
            share = count / total
            if share >= MAJORITY_THRESHOLD:
                return (
                    STATUS_RESOLVED_MAJORITY,
                    f"{count}/{total} reports ({share:.0%}) agree on '{value}' — evidence is "
                    f"clear enough to resolve without a human reviewer.",
                )

    # Otherwise: too sparse or too evenly split to trust an automatic call.
    return (
        STATUS_NEEDS_REVIEW,
        f"{candidate['yes_count']} yes / {candidate['no_count']} no / {candidate['unsure_count']} unsure "
        f"({total} total, no decisive recent cluster) — left for a human reviewer rather than guessing.",
    )


def resolve_conflict_candidates(
    conflict_candidates: pd.DataFrame,
    accessibility_features: pd.DataFrame,
    reviews: pd.DataFrame,
) -> pd.DataFrame:
    """Return conflict_candidates with a real status and an auditable rationale in notes.

    Every row keeps its original candidate_id/place_id/feature_type/counts;
    only `status` and `notes` are replaced.
    """
    if conflict_candidates.empty:
        return conflict_candidates

    evidence = _review_evidence(accessibility_features, reviews)
    statuses: list[str] = []
    notes: list[str] = []

    for _, candidate in conflict_candidates.iterrows():
        place_feature_evidence = evidence[
            (evidence["place_id"] == candidate["place_id"]) & (evidence["feature_type"] == candidate["feature_type"])
        ]
        status, note = _resolve_one(candidate, place_feature_evidence)
        statuses.append(status)
        notes.append(note)

    resolved = conflict_candidates.copy()
    resolved["status"] = statuses
    resolved["notes"] = notes
    return resolved


def resolution_summary(conflict_candidates: pd.DataFrame) -> dict[str, object]:
    """Coverage and human-review-rate — the two conflict-engine metrics that
    don't require a labelled ground-truth set (see docs/metric_validation_plan.md
    section 4). Precision/recall/resolution-accuracy/calibration need
    data/validation/ground_truth_places.csv, which doesn't exist yet.
    """
    total = int(len(conflict_candidates))
    if total == 0:
        return {"total_conflicts": 0}
    by_status = conflict_candidates["status"].value_counts().to_dict()
    resolved = total - by_status.get(STATUS_NEEDS_REVIEW, 0)
    return {
        "total_conflicts": total,
        "by_status": by_status,
        "coverage": round(resolved / total, 4),
        "human_review_rate": round(by_status.get(STATUS_NEEDS_REVIEW, 0) / total, 4),
    }
