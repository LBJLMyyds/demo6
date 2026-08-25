#!/usr/bin/env python3
"""
export_frontend_data.py

Converts database/accessibility.sqlite into small, static JSON files that the
frontend (frontend/index.html + assets/app.js) can fetch directly on GitHub
Pages, with no server and no WebAssembly SQLite runtime required.

Usage:
    python3 export_frontend_data.py

Reads:
    database/accessibility.sqlite

Writes:
    frontend/data/places.json
    frontend/data/toilets.json
    frontend/data/tgsi.json
    frontend/data/conflicts.json
    frontend/data/meta.json

Run this again any time the pipeline (src/pipeline/build.py) regenerates the
database, so the map on GitHub Pages stays in sync. The GitHub Actions
workflow in .github/workflows/deploy-pages.yml also runs it automatically on
every push to main.
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "database" / "accessibility.sqlite"
OUT_DIR = ROOT / "frontend" / "data"

# Roughly the state of Victoria plus a little margin. A handful of source
# rows carry coordinates for venues outside Australia (likely reference /
# test rows picked up from the raw export); this map is scoped to Melbourne
# and Victoria, so those are excluded here and reported in meta.json rather
# than silently dropped.
VIC_BOUNDS = {"lat_min": -39.5, "lat_max": -33.5, "lng_min": 140.0, "lng_max": 150.5}

FEATURE_TYPES = ["ramp", "bathroom", "seating", "parking"]

# Ordered category buckets shown as filter chips in the UI. Order matters:
# first matching rule wins. Each rule checks category_tags tokens first,
# then falls back to the more granular primary_type column.
CATEGORY_RULES = [
    ("cafe", "Cafe & Coffee", {"cafe", "coffee_shop", "tea_house", "bakery", "dessert_shop",
                                "dessert_restaurant", "ice_cream_shop", "bagel_shop", "chocolate_shop"}),
    ("bar", "Bar & Pub", {"bar", "pub", "wine_bar"}),
    ("restaurant", "Restaurant & Dining", {"restaurant", "food"}),
    ("culture", "Culture & Entertainment", {"event_venue", "tourist_attraction", "museum", "art_gallery",
                                             "performing_arts_theater", "movie_theater", "concert_hall",
                                             "cultural_center", "wedding_venue", "sports_complex", "sports_club"}),
    ("shopping", "Shops & Services", {"shopping_mall", "store", "market", "supermarket", "grocery_store",
                                       "convenience_store", "liquor_store", "health_food_store",
                                       "home_improvement_store", "wholesaler", "finance", "consultant",
                                       "food_store", "asian_grocery_store"}),
    ("health", "Health & Wellness", {"hospital", "doctor", "dental_clinic", "physiotherapist",
                                      "veterinary_care", "gym", "fitness_center"}),
    ("civic", "Library & Civic", {"library", "park", "hotel"}),
]
RESTAURANT_SUFFIXES = "_restaurant"


def bucket_category(category_tags: str | None, primary_type: str | None) -> tuple[str, str]:
    tokens = set()
    if category_tags:
        tokens |= {t.strip().lower() for t in category_tags.split("|") if t.strip()}
    if primary_type:
        tokens.add(primary_type.strip().lower())

    for key, label, members in CATEGORY_RULES:
        if tokens & members:
            return key, label
        if key == "restaurant" and any(t.endswith(RESTAURANT_SUFFIXES) or t in {"meal_takeaway", "food_court"} for t in tokens):
            return key, label
    return "other", "Other"


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def in_vic_bounds(lat, lng) -> bool:
    if lat is None or lng is None:
        return False
    return (VIC_BOUNDS["lat_min"] <= lat <= VIC_BOUNDS["lat_max"]
            and VIC_BOUNDS["lng_min"] <= lng <= VIC_BOUNDS["lng_max"])


def has_encoding_artifact(text: str | None) -> bool:
    return bool(text) and "?" in text


def round6(v):
    return round(v, 6) if isinstance(v, (int, float)) else v


def export():
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found at {DB_PATH}. Run src/pipeline/build.py first.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ---- accessibility_features: one summary row per place+feature_type (review_id IS NULL) ----
    cur.execute("""
        SELECT place_id, feature_type, value, confidence, evidence_count
        FROM accessibility_features
        WHERE review_id IS NULL
    """)
    feature_map: dict[str, dict[str, dict]] = {}
    for row in cur.fetchall():
        feature_map.setdefault(row["place_id"], {})[row["feature_type"]] = {
            "value": row["value"],
            "confidence": round(row["confidence"], 2) if row["confidence"] is not None else None,
            "evidence_count": row["evidence_count"],
        }

    # ---- conflict candidates, keyed by place_id ----
    cur.execute("SELECT * FROM conflict_candidates")
    conflict_rows = [dict(r) for r in cur.fetchall()]
    # Only conflicts the resolution engine couldn't safely auto-resolve should make a
    # venue show a "needs review" banner on the map. Auto-resolved conflicts still
    # appear in full on the Data Quality page (for audit purposes) but shouldn't
    # alarm someone just trying to find an accessible venue.
    flagged_place_ids = {r["place_id"] for r in conflict_rows if r["status"] == "needs_human_review"}

    # ---- toilets ----
    cur.execute("SELECT * FROM toilets")
    toilet_rows = [dict(r) for r in cur.fetchall()]
    toilets_out = []
    excluded_toilets_oob = 0
    for t in toilet_rows:
        if not in_vic_bounds(t["lat"], t["lng"]):
            excluded_toilets_oob += 1
            continue
        toilets_out.append({
            "id": t["toilet_id"],
            "name": t["name"] or "Public toilet",
            "address": t["address"],
            "town": t["town"],
            "council": t["council"],
            "lat": round6(t["lat"]),
            "lng": round6(t["lng"]),
            "accessible": bool(t["accessible"]),
            "parkingAccessible": bool(t["parking_accessible"]),
            "hours": t["opening_hours"],
        })

    accessible_toilets_for_distance = [t for t in toilets_out if t["accessible"]]

    # ---- places ----
    cur.execute("SELECT * FROM places")
    place_rows = [dict(r) for r in cur.fetchall()]

    places_out = []
    excluded_place_oob = []
    encoding_flagged = 0
    category_counts: dict[str, dict] = {}

    for p in place_rows:
        if not in_vic_bounds(p["lat"], p["lng"]):
            excluded_place_oob.append({"id": p["place_id"], "name": p["name"], "lat": p["lat"], "lng": p["lng"]})
            continue

        cat_key, cat_label = bucket_category(p["category_tags"], p["primary_type"])
        category_counts.setdefault(cat_key, {"key": cat_key, "label": cat_label, "count": 0})
        category_counts[cat_key]["count"] += 1

        feats = feature_map.get(p["place_id"], {})
        features_out = {}
        for ft in FEATURE_TYPES:
            f = feats.get(ft)
            features_out[ft] = f if f else {"value": "unsure", "confidence": None, "evidence_count": 0}

        nearest_toilet = None
        if accessible_toilets_for_distance and p["lat"] is not None and p["lng"] is not None:
            best = None
            best_d = None
            for t in accessible_toilets_for_distance:
                d = haversine_m(p["lat"], p["lng"], t["lat"], t["lng"])
                if best_d is None or d < best_d:
                    best_d, best = d, t
            if best is not None:
                nearest_toilet = {"id": best["id"], "name": best["name"], "distanceM": round(best_d)}

        name_flag = has_encoding_artifact(p["name"])
        if name_flag:
            encoding_flagged += 1

        places_out.append({
            "id": p["place_id"],
            "name": p["name"] or "Unnamed venue",
            "address": p["address"],
            "category": cat_key,
            "categoryLabel": cat_label,
            "primaryType": p["primary_type"],
            "lat": round6(p["lat"]),
            "lng": round6(p["lng"]),
            "rating": p["avg_rating"],
            "reviewCount": p["review_count"] or 0,
            "features": features_out,
            "nearestToilet": nearest_toilet,
            "flagged": p["place_id"] in flagged_place_ids,
            "nameEncodingIssue": name_flag,
        })

    # ---- tactile ground surface indicators ----
    cur.execute("SELECT * FROM tactile_indicators")
    tgsi_rows = [dict(r) for r in cur.fetchall()]
    tgsi_out = []
    for t in tgsi_rows:
        if not in_vic_bounds(t["lat"], t["lng"]):
            continue
        tgsi_out.append({
            "id": t["asset_id"],
            "description": t["description"],
            "roadSegment": t["road_segment"],
            "lat": round6(t["lat"]),
            "lng": round6(t["lng"]),
        })

    # ---- conflicts, enriched with place info for the Data Quality view + map ----
    place_by_id = {p["id"]: p for p in places_out}
    conflicts_out = []
    for c in conflict_rows:
        place = place_by_id.get(c["place_id"])
        conflicts_out.append({
            "id": c["candidate_id"],
            "placeId": c["place_id"],
            "placeName": place["name"] if place else "(place outside map bounds)",
            "placeAddress": place["address"] if place else None,
            "lat": place["lat"] if place else None,
            "lng": place["lng"] if place else None,
            "featureType": c["feature_type"],
            "conflictType": c["conflict_type"],
            "yesCount": c["yes_count"],
            "noCount": c["no_count"],
            "unsureCount": c["unsure_count"],
            "status": c["status"],
            "notes": c["notes"],
        })

    # ---- data sources ----
    cur.execute("SELECT * FROM data_sources")
    sources_out = [{
        "id": r["source_id"],
        "filename": r["filename"],
        "description": r["description"],
        "license": r["license"],
        "origin": r["origin"],
    } for r in cur.fetchall()]

    # ---- councils represented in the toilet dataset ----
    councils = sorted({t["council"] for t in toilets_out if t["council"]})

    # ---- conflict resolution engine summary (coverage / human-review-rate; see
    # src/pipeline/resolve.py — these two metrics don't need ground truth, unlike
    # precision/recall/accuracy which do) ----
    status_counts: dict[str, int] = {}
    for c in conflict_rows:
        status_counts[c["status"]] = status_counts.get(c["status"], 0) + 1
    total_conflicts = len(conflict_rows)
    needs_review = status_counts.get("needs_human_review", 0)
    resolution_out = {
        "totalConflicts": total_conflicts,
        "byStatus": status_counts,
        "coverage": round((total_conflicts - needs_review) / total_conflicts, 4) if total_conflicts else None,
        "humanReviewRate": round(needs_review / total_conflicts, 4) if total_conflicts else None,
    }

    meta_out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": {
            "places": len(places_out),
            "toilets": len(toilets_out),
            "toiletsAccessible": len(accessible_toilets_for_distance),
            "tgsi": len(tgsi_out),
            "conflicts": len(conflicts_out),
        },
        "categories": sorted(category_counts.values(), key=lambda c: -c["count"]),
        "councils": councils,
        "dataSources": sources_out,
        "conflictResolution": resolution_out,
        "dataQuality": {
            "placesExcludedOutsideVictoria": len(excluded_place_oob),
            "excludedPlaces": excluded_place_oob,
            "toiletsExcludedOutsideVictoria": excluded_toilets_oob,
            "placeNamesWithEncodingIssue": encoding_flagged,
        },
        "bounds": VIC_BOUNDS,
    }

    (OUT_DIR / "places.json").write_text(json.dumps(places_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "toilets.json").write_text(json.dumps(toilets_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "tgsi.json").write_text(json.dumps(tgsi_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "conflicts.json").write_text(json.dumps(conflicts_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "meta.json").write_text(json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {len(places_out)} places, {len(toilets_out)} toilets, "
          f"{len(tgsi_out)} TGSI points, {len(conflicts_out)} conflict candidates -> {OUT_DIR}")
    print(f"Excluded {len(excluded_place_oob)} places and {excluded_toilets_oob} toilets outside the Victoria bounding box.")
    print(f"Flagged {encoding_flagged} place names with likely CSV encoding issues (contain '?').")


if __name__ == "__main__":
    export()
