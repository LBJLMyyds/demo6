"""One-command entrypoint for the MVP accessibility data pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from src.pipeline.clean import (
    build_accessibility_features,
    build_conflict_candidates,
    build_walking_nodes,
    clean_council_reference,
    clean_places,
    clean_reference_map_points,
    clean_reviews,
    clean_tactile_indicators,
    clean_toilets,
    empty_walking_edges,
)
from src.pipeline.config import DATABASE_PATH, PROCESSED_DIR, VALIDATION_REPORT_PATH
from src.pipeline.ingest import build_data_sources, load_raw_datasets
from src.pipeline.load import load_tables, recreate_database
from src.pipeline.resolve import resolve_conflict_candidates, resolution_summary
from src.pipeline.validate import validate_relationships, validate_tables, write_validation_report


def build_clean_tables() -> dict[str, object]:
    """Run ingestion, cleaning, feature extraction, and placeholder network setup."""
    raw = load_raw_datasets()
    places = clean_places(raw["enaccess_places"])
    reviews = clean_reviews(raw["enaccess_reviews"])
    toilets = clean_toilets(raw["accessible_toilets_15_councils"], raw["melbourne_public_toilets"])
    tactile_indicators = clean_tactile_indicators(raw["tactile_ground_surface_indicators"])
    council_reference = clean_council_reference(raw["council_data_reference"])
    reference_map_points = clean_reference_map_points(raw["mountalexander_reference_points"])
    accessibility_features = build_accessibility_features(places, reviews)
    conflict_candidates = build_conflict_candidates(accessibility_features)
    conflict_candidates = resolve_conflict_candidates(conflict_candidates, accessibility_features, reviews)
    walking_nodes = build_walking_nodes(tactile_indicators)
    walking_edges = empty_walking_edges()

    return {
        "data_sources": build_data_sources(),
        "places": places,
        "reviews": reviews,
        "toilets": toilets,
        "tactile_indicators": tactile_indicators,
        "council_data_reference": council_reference,
        "reference_map_points": reference_map_points,
        "accessibility_features": accessibility_features,
        "conflict_candidates": conflict_candidates,
        "walking_nodes": walking_nodes,
        "walking_edges": walking_edges,
    }


def write_processed_snapshots(tables: dict[str, object]) -> None:
    """Write cleaned CSV snapshots for easier debugging and handoff."""
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    for table_name, df in tables.items():
        df.to_csv(PROCESSED_DIR / f"{table_name}.csv", index=False)


def main() -> None:
    """Build the SQLite database and validation report."""
    tables = build_clean_tables()
    table_results = validate_tables(tables)
    relationship_results = validate_relationships(tables)
    write_processed_snapshots(tables)
    connection = recreate_database()
    try:
        load_tables(tables, connection)
    finally:
        connection.close()
    write_validation_report(table_results, relationship_results)
    print(f"Built database: {DATABASE_PATH}")
    print(f"Wrote validation report: {VALIDATION_REPORT_PATH}")
    summary = resolution_summary(tables["conflict_candidates"])
    if summary.get("total_conflicts"):
        print(
            f"Conflict resolution: {summary['total_conflicts']} conflicts — "
            f"coverage {summary['coverage']:.0%}, human review rate {summary['human_review_rate']:.0%} "
            f"({summary['by_status']})"
        )


if __name__ == "__main__":
    main()

