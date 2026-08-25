"""Validation checks and Markdown report generation."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from src.pipeline.config import VALIDATION_REPORT_PATH


PRIMARY_KEYS = {
    "data_sources": "source_id",
    "places": "place_id",
    "reviews": "review_id",
    "toilets": "toilet_id",
    "tactile_indicators": "asset_id",
    "council_data_reference": "council_id",
    "reference_map_points": "point_id",
    "accessibility_features": "feature_id",
    "conflict_candidates": "candidate_id",
    "walking_nodes": "node_id",
    "walking_edges": "edge_id",
}


COORDINATE_TABLES = {
    "places": ("lat", "lng"),
    "reviews": ("lat", "lng"),
    "toilets": ("lat", "lng"),
    "tactile_indicators": ("lat", "lng"),
    "reference_map_points": ("lat", "lng"),
    "walking_nodes": ("lat", "lng"),
}


def invalid_coordinate_count(df: pd.DataFrame, lat_col: str, lng_col: str) -> int:
    """Count missing or out-of-range WGS84 coordinates."""
    lat = pd.to_numeric(df[lat_col], errors="coerce")
    lng = pd.to_numeric(df[lng_col], errors="coerce")
    invalid = lat.isna() | lng.isna() | ~lat.between(-90, 90) | ~lng.between(-180, 180)
    return int(invalid.sum())


def invalid_timestamp_count(df: pd.DataFrame, column: str) -> int:
    """Count non-null values that don't parse as a real timestamp.

    Added after the conflict resolution engine found reviewed_at values that
    are literal "yes"/"no"/"unsure" strings — a CSV column-shift issue in the
    same family as the encoding artifacts already tracked in
    frontend/data/meta.json. This makes that class of defect visible in the
    validation report instead of only surfacing when something downstream
    tries to sort by date.
    """
    if column not in df.columns or df.empty:
        return 0
    present = df[column].notna()
    parsed = pd.to_datetime(df[column], utc=True, errors="coerce")
    return int((present & parsed.isna()).sum())


def validate_tables(tables: dict[str, pd.DataFrame]) -> dict[str, dict[str, object]]:
    """Run basic table-level checks."""
    results: dict[str, dict[str, object]] = {}
    for table_name, df in tables.items():
        key = PRIMARY_KEYS.get(table_name)
        duplicate_keys = int(df[key].duplicated().sum()) if key and key in df.columns else None
        missing_values = df.isna().sum().sort_values(ascending=False)
        top_missing = {col: int(count) for col, count in missing_values.head(8).items() if int(count) > 0}
        coord_cols = COORDINATE_TABLES.get(table_name)
        invalid_coords = invalid_coordinate_count(df, *coord_cols) if coord_cols and not df.empty else 0
        invalid_timestamps = invalid_timestamp_count(df, "reviewed_at") if table_name == "reviews" else 0
        results[table_name] = {
            "rows": int(len(df)),
            "columns": int(len(df.columns)),
            "primary_key": key,
            "duplicate_primary_keys": duplicate_keys,
            "invalid_coordinates": invalid_coords,
            "invalid_timestamps": invalid_timestamps,
            "top_missing_values": top_missing,
        }
    return results


def validate_relationships(tables: dict[str, pd.DataFrame]) -> dict[str, int]:
    """Check important foreign-key-like relationships before database loading."""
    places = set(tables["places"]["place_id"])
    reviews = tables["reviews"]
    features = tables["accessibility_features"]
    conflicts = tables["conflict_candidates"]
    return {
        "reviews_without_matching_place": int((~reviews["place_id"].isin(places)).sum()),
        "features_without_matching_place": int((~features["place_id"].isin(places)).sum()),
        "conflicts_without_matching_place": int((~conflicts["place_id"].isin(places)).sum()) if not conflicts.empty else 0,
    }


def write_validation_report(
    table_results: dict[str, dict[str, object]],
    relationship_results: dict[str, int],
    output_path: Path = VALIDATION_REPORT_PATH,
) -> None:
    """Write a concise Markdown validation report."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        "# Data Validation Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "## Table Summary",
        "",
        "| Table | Rows | Columns | Primary Key | Duplicate Keys | Invalid Coordinates | Invalid Timestamps |",
        "|---|---:|---:|---|---:|---:|---:|",
    ]
    for table_name, result in table_results.items():
        lines.append(
            "| {table} | {rows} | {columns} | {pk} | {dupes} | {coords} | {timestamps} |".format(
                table=table_name,
                rows=result["rows"],
                columns=result["columns"],
                pk=result["primary_key"] or "",
                dupes="" if result["duplicate_primary_keys"] is None else result["duplicate_primary_keys"],
                coords=result["invalid_coordinates"],
                timestamps=result.get("invalid_timestamps", 0),
            )
        )

    lines.extend(["", "## Relationship Checks", ""])
    for check_name, count in relationship_results.items():
        lines.append(f"- `{check_name}`: {count}")

    lines.extend(["", "## Top Missing Values", ""])
    for table_name, result in table_results.items():
        missing = result["top_missing_values"]
        if not missing:
            lines.append(f"- `{table_name}`: no major missing values in checked columns")
            continue
        formatted = ", ".join(f"`{column}`={count}" for column, count in missing.items())
        lines.append(f"- `{table_name}`: {formatted}")

    output_path.write_text("\n".join(lines) + "\n")

