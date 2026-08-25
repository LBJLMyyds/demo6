# EnAccessMap Melbourne — live demo

A community-reported accessibility map of Melbourne venues, public toilets, and tactile paving, with an automatic
conflict resolution engine for when reports about the same venue disagree. Filterable by step-free entry,
accessible bathroom, seating, and accessible parking — the same four criteria used by
[EnAccess Maps](https://www.enaccessmaps.com), the Melbourne not-for-profit this project's data model follows.

**Live site:** *(add your GitHub Pages URL here once Actions finishes deploying)*

> This repo is a demo/snapshot used to test deployment and showcase the conflict resolution engine. The full
> project — raw data, the complete ingestion pipeline, notebooks, and documentation — lives in the team repository:
> [`lilylin-star/MAST90107-accessibility-map`](https://github.com/lilylin-star/MAST90107-accessibility-map)
> (`Lin-Ma` branch), part of University of Melbourne's MAST90107.

## What's here

```text
frontend/                 Static map app — Leaflet + OpenStreetMap, vanilla HTML/CSS/JS, no build step
  index.html
  assets/app.js
  assets/styles.css
  data/*.json              Generated from accessibility.sqlite — do not hand-edit
database/accessibility.sqlite   Snapshot of the project database
export_frontend_data.py   database/accessibility.sqlite -> frontend/data/*.json
src/pipeline/
  resolve.py                The conflict resolution engine (see below)
  build.py                  Pipeline entrypoint that calls it
  validate.py                Validation checks, including the new reviewed_at timestamp check
reports/data_validation_report.md   Latest pipeline validation output
.github/workflows/deploy-pages.yml   Auto-deploys frontend/ to GitHub Pages on every push to main
```

`src/pipeline/` here is intentionally partial — it has the three modules relevant to the conflict resolution
engine, not the full ingestion pipeline (`clean.py`, `config.py`, `ingest.py`, `load.py`, or the raw CSVs). Running
`build.py` standalone in this repo will fail on missing imports; that's expected. `export_frontend_data.py`
doesn't have that problem — it only needs the standard library and the committed `.sqlite` file, so it runs fine on
its own here or in CI.

## Running locally

```bash
cd frontend
python3 -m http.server 8000
# open http://localhost:8000 — don't open index.html by double-clicking, browsers
# block the local fetch() calls that load frontend/data/*.json
```

## Regenerating frontend/data/*.json

```bash
python3 export_frontend_data.py
```

Reads `database/accessibility.sqlite` and rewrites `frontend/data/places.json`, `toilets.json`, `tgsi.json`,
`conflicts.json`, and `meta.json`. The GitHub Actions workflow re-runs this automatically on every push to `main`
if the database is present, and falls back to whatever's already committed if it isn't.

## The conflict resolution engine

Every accessibility feature on the map comes from community reports. When reports about the same venue disagree —
one visitor says there's a ramp, another says there isn't — `src/pipeline/resolve.py` decides one of three
outcomes and records why in `conflict_candidates.notes`, so every decision is auditable:

| Status | Rule | Share of current data |
|---|---|---:|
| `resolved_recent_evidence` | A corroborated cluster of recent reports (≥2, within 14 days of each other) overrides an older conflicting report — accessibility features genuinely change over time | 1% |
| `resolved_majority` | A well-evidenced, lopsided majority: ≥75% agreement across at least 4 reports | 22% |
| `needs_human_review` | Evidence is too sparse or too evenly split to trust an automatic call | 77% |

The high human-review rate is deliberate, not a shortcoming — see `docs/metric_validation_plan.md` in the main
repo: *"a conservative system with lower coverage and higher accuracy may be safer than one that resolves every
conflict."* Only venues with a still-open `needs_human_review` conflict show a review banner on the map; resolved
conflicts stay visible on the Data Quality page for transparency but don't alarm someone just trying to find an
accessible venue.

Resolution *accuracy* (do auto-resolved cases match verified ground truth?) isn't measured yet — that needs a
labelled ground-truth sample this repo doesn't include. Coverage and human-review-rate, shown above, don't require
ground truth and are computed directly from the data.

## Known data quality notes

Logged automatically in `frontend/data/meta.json` rather than silently fixed — visible on the site's Data Quality
page:

- **95 venues** geocoded outside Victoria (other states, occasionally overseas) — present in the source export
  itself, excluded from the map rather than shown at the wrong location.
- **53 venue names** contain literal `?` characters from a charset mismatch upstream.
- **13 review timestamps** contain a stray `yes`/`no`/`unsure` string instead of a date — a likely CSV
  column-shift, caught by the validation check added alongside the resolution engine.

## Credits

Data model and filter criteria inspired by [EnAccess Maps](https://www.enaccessmaps.com). Map tiles ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
