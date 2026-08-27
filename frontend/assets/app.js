/* =========================================================================
   EnAccessMap Melbourne — app.js
   Vanilla JS, no build step. Fetches static JSON (exported from
   accessibility.sqlite by export_frontend_data.py) and renders an
   interactive Leaflet map with search, category + accessibility filters,
   a venue detail panel, and a data-quality view.
   ========================================================================= */
(() => {
  "use strict";

  const DATA_BASE = "data/";
  const MELBOURNE_CENTER = [-37.8136, 144.9631];

  const FEATURES = [
    { key: "ramp",     label: "Step-free entry",     short: "Step-free",  icon: "ramp" },
    { key: "bathroom", label: "Accessible bathroom",  short: "Bathroom",   icon: "toilet" },
    { key: "seating",  label: "Seating",              short: "Seating",   icon: "chair" },
    { key: "parking",  label: "Accessible parking",   short: "Parking",   icon: "parking" },
  ];
  const FEATURE_BY_KEY = Object.fromEntries(FEATURES.map(f => [f.key, f]));

  const CATEGORY_ICONS = {
    cafe: "cup", bar: "glass", restaurant: "fork", culture: "ticket",
    shopping: "bag", health: "cross", civic: "building", other: "dot",
  };

  /* ----------------------------- tiny icon set ---------------------------- */
  const ICON_PATHS = {
    ramp:     '<path d="M4 19h16M4 19 14 6h3v13M8 19l6-9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    toilet:   '<path d="M8 4v6a3 3 0 1 0 6 0V4M11 10v10M8 20h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="6" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M17 9v4l2.4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    chair:    '<path d="M6 4v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4M6 12H4v8M18 12h2v8M8 20v-3h8v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    parking:  '<rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 16V8h3.2a2.4 2.4 0 0 1 0 4.8H9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    cup:      '<path d="M5 8h11v6a5.5 5.5 0 0 1-11 0V8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16M4 21h13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    glass:    '<path d="M7 4h10l-1 8.5a4 4 0 0 1-8 0L7 4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 16.5V20M8.5 20h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    fork:     '<path d="M8 3v6a2 2 0 0 0 4 0V3M10 9v12M16 3c-1.4 0-2.5 2-2.5 5s1.1 4 2.5 4 2.5-1 2.5-4-1.1-5-2.5-5Zm0 9v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    ticket:   '<path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 6 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 7.5v9" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/>',
    bag:      '<path d="M6 8h12l-1 12H7L6 8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.6"/>',
    cross:    '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    building: '<path d="M5 21V6l7-3 7 3v15M5 21h14M9 10h2M13 10h2M9 14h2M13 14h2M9 21v-4h6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    dot:      '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
    warning:  '<path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4M12 17v.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    locate:   '<path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/>',
    star:     '<path d="m12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7 2.6-5.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    check:    '<path d="M5 12.5 9.5 17 19 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  function svg(name, extraClass) {
    return `<svg class="${extraClass || ""}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
  }

  /* --------------------------------- state -------------------------------- */
  const state = {
    places: [], toilets: [], tgsi: [], conflicts: [], meta: null, heatmap: [],
    filters: { search: "", categories: new Set(), features: new Set() },
    layers: { venues: true, toilets: true, tgsi: false, flagged: false, heatmap: false },
    selectedPlaceId: null,
    qualityFilters: { search: "", feature: null },
  };

  let map, venuesCluster, flaggedCluster, toiletsCluster, tgsiLayer, heatmapLayer;
  let placesById = new Map();

  /* -------------------------------- helpers -------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function haversineM(lat1, lng1, lat2, lng2) {
    const r = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  function fmtDistance(m) {
    if (m == null) return "";
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  function animateCount(el, to, duration = 650) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = to.toLocaleString(); return;
    }
    const from = 0, start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function valueLabel(v) { return v === "yes" ? "Yes" : v === "no" ? "No" : "Unsure"; }

  // Interpolates the same red -> yellow -> green scale used in
  // notebooks/accessibility_score_heatmap.ipynb (#B3282D -> #F2C744 -> #2E7D46), so the
  // live map and the offline notebook analysis read as the same visual language.
  function scoreToColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [[0, [0xB3, 0x28, 0x2D]], [0.5, [0xF2, 0xC7, 0x44]], [1, [0x2E, 0x7D, 0x46]]];
    let [t0, c0] = stops[0], [t1, c1] = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { [t0, c0] = stops[i]; [t1, c1] = stops[i + 1]; break; }
    }
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const mix = (a, b) => Math.round(a + (b - a) * f);
    return `rgb(${mix(c0[0], c1[0])},${mix(c0[1], c1[1])},${mix(c0[2], c1[2])})`;
  }

  /* --------------------------------- boot ---------------------------------- */
  async function boot() {
    try {
      const [places, toilets, tgsi, conflicts, meta, heatmap] = await Promise.all(
        ["places.json", "toilets.json", "tgsi.json", "conflicts.json", "meta.json", "heatmap.json"].map(f =>
          fetch(DATA_BASE + f).then(r => {
            if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
            return r.json();
          })
        )
      );
      state.places = places; state.toilets = toilets; state.tgsi = tgsi;
      state.conflicts = conflicts; state.meta = meta; state.heatmap = heatmap;
      placesById = new Map(places.map(p => [p.id, p]));

      initMap();
      initSidebar();
      initDetailPanel();
      initNav();
      initQualityView();
      initAboutView();
      applyFilters();

      $("#loading-screen").style.display = "none";
      $("#app").hidden = false;
    } catch (err) {
      console.error("Failed to load EnAccessMap data:", err);
      const ls = $("#loading-screen");
      ls.innerHTML = `<div style="max-width:420px;text-align:center;padding:0 20px;">
        <p style="font-family:var(--font-mono);font-size:13px;">Couldn't load the map data.</p>
        <p style="font-family:var(--font-mono);font-size:12px;opacity:.8;">
          If you opened index.html directly from disk, browsers block local file requests.
          Serve the folder instead, e.g. <code style="background:rgba(255,255,255,.12);color:#F0D9A6;">python3 -m http.server</code>,
          then open http://localhost:8000/frontend/.
        </p></div>`;
    }
  }

  /* --------------------------------- map ------------------------------------ */
  function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 9, maxZoom: 19 })
      .setView(MELBOURNE_CENTER, 13);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);

    const clusterOpts = {
      iconCreateFunction: cluster => L.divIcon({
        html: `<div>${cluster.getChildCount()}</div>`,
        className: "marker-cluster-eam", iconSize: L.point(38, 38),
      }),
      maxClusterRadius: 46, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
    };
    venuesCluster = L.markerClusterGroup(clusterOpts);
    flaggedCluster = L.markerClusterGroup(clusterOpts);
    toiletsCluster = L.markerClusterGroup(clusterOpts);
    tgsiLayer = L.layerGroup();
    heatmapLayer = L.layerGroup();

    venuesCluster.addTo(map);
    flaggedCluster.addTo(map);
    toiletsCluster.addTo(map);

    renderToilets();
    renderTgsi();
    renderHeatmap();
  }

  function renderHeatmap() {
    state.heatmap.forEach(cell => {
      const bounds = [[cell.latMin, cell.lngMin], [cell.latMax, cell.lngMax]];
      const rect = L.rectangle(bounds, {
        color: "#fff", weight: 0.6, opacity: 0.5,
        fillColor: scoreToColor(cell.meanScore), fillOpacity: 0.62,
        interactive: true,
      });
      rect.bindTooltip(
        `Mean score ${cell.meanScore.toFixed(2)} · ${cell.count} venue${cell.count === 1 ? "" : "s"}`,
        { sticky: true }
      );
      heatmapLayer.addLayer(rect);
    });
    const countEl = $("#count-heatmap");
    if (countEl) animateCount(countEl, state.heatmap.length);
  }

  function venueIcon(flagged) {
    return L.divIcon({
      className: "",
      html: `<div class="eam-pin eam-pin--venue${flagged ? " is-flagged" : ""}" style="width:26px;height:26px;">${flagged ? svg("warning") : ""}</div>`,
      iconSize: [26, 26], iconAnchor: [13, 25], popupAnchor: [0, -22],
    });
  }

  function popupHtml(title, sub) {
    return `<div class="eam-popup-title">${escapeHtml(title)}</div><div class="eam-popup-sub">${escapeHtml(sub || "")}</div>
      <button type="button" class="eam-popup-btn" data-open-detail="1">View accessibility details</button>`;
  }

  function makeVenueMarker(place) {
    const m = L.marker([place.lat, place.lng], { icon: venueIcon(place.flagged), keyboard: false });
    m.bindPopup(popupHtml(place.name, place.address || place.categoryLabel), { closeButton: true, closeOnClick: false, autoPan: true });
    m.on("popupopen", (e) => {
      const btn = e.popup.getElement().querySelector("[data-open-detail]");
      if (btn && !btn.dataset.wired) {
        btn.dataset.wired = "1";
        btn.addEventListener("click", (ev) => {
          L.DomEvent.stop(ev);
          openDetail(place.id);
        });
      }
    });
    m.on("click", () => { m.openPopup(); });
    return m;
  }

  function renderVenues() {
    venuesCluster.clearLayers();
    flaggedCluster.clearLayers();
    const filtered = computeFilteredPlaces();
    const nonFlagged = [], flagged = [];
    filtered.forEach(p => (p.flagged ? flagged : nonFlagged).push(p));

    if (state.layers.venues) {
      nonFlagged.forEach(p => venuesCluster.addLayer(makeVenueMarker(p)));
    }
    if (state.layers.flagged) {
      flagged.forEach(p => flaggedCluster.addLayer(makeVenueMarker(p)));
    }
    updateCounts(filtered, nonFlagged, flagged);
    renderResultsList(filtered);
  }

  function renderToilets() {
    state.toilets.forEach(t => {
      let marker;
      if (t.accessible) {
        marker = L.marker([t.lat, t.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="eam-toilet-dot" style="width:20px;height:20px;background:var(--gold-600);display:flex;align-items:center;justify-content:center;color:#fff;">${svg("toilet")}</div>`,
            iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -8],
          }),
        });
      } else {
        marker = L.circleMarker([t.lat, t.lng], {
          radius: 4, color: "#B87F1C", weight: 1.5, fillColor: "#fff", fillOpacity: 0.9,
        });
      }
      const sub = [t.address, t.council ? titleCase(t.council) : null].filter(Boolean).join(" · ");
      marker.bindPopup(`<div class="eam-popup-title">${escapeHtml(t.name)}</div>
        <div class="eam-popup-sub">${escapeHtml(sub)}</div>
        <div class="eam-popup-sub">${t.accessible ? "♿ Wheelchair accessible" : "Standard facility"}${t.parkingAccessible ? " · Accessible parking" : ""}</div>`);
      toiletsCluster.addLayer(marker);
    });
  }

  function renderTgsi() {
    state.tgsi.forEach(t => {
      const marker = L.circleMarker([t.lat, t.lng], {
        radius: 3.5, className: "eam-tgsi-dot", color: "#fff", weight: 1, fillColor: "#C4700B", fillOpacity: 0.85,
      });
      marker.bindPopup(`<div class="eam-popup-title">Tactile paving</div><div class="eam-popup-sub">${escapeHtml(t.description || t.roadSegment || "")}</div>`);
      tgsiLayer.addLayer(marker);
    });
  }

  function updateCounts(filtered, nonFlagged, flagged) {
    animateCount($("#count-venues"), nonFlagged.length);
    animateCount($("#count-toilets"), state.toilets.length);
    animateCount($("#count-tgsi"), state.tgsi.length);
    animateCount($("#count-flagged"), flagged.length);
  }

  /* -------------------------------- sidebar --------------------------------- */
  function initSidebar() {
    // layer toggles
    $$("#layer-list input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        const layer = cb.dataset.layer;
        state.layers[layer] = cb.checked;
        if (layer === "toilets") toggleMapLayer(toiletsCluster, cb.checked);
        if (layer === "tgsi") toggleMapLayer(tgsiLayer, cb.checked);
        if (layer === "heatmap") {
          toggleMapLayer(heatmapLayer, cb.checked);
          const legend = $("#heatmap-legend");
          if (legend) legend.hidden = !cb.checked;
        }
        if (layer === "venues" || layer === "flagged") renderVenues();
        updateActiveFilterCount();
      });
    });

    // category chips
    const catWrap = $("#category-chips");
    state.meta.categories.forEach(cat => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip"; chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `${svg(CATEGORY_ICONS[cat.key] || "dot")} ${cat.label} <span class="chip-n">${cat.count}</span>`;
      chip.addEventListener("click", () => {
        const on = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!on));
        if (on) state.filters.categories.delete(cat.key); else state.filters.categories.add(cat.key);
        applyFilters();
      });
      catWrap.appendChild(chip);
    });

    // feature chips ("must have")
    const featWrap = $("#feature-chips");
    FEATURES.forEach(f => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip"; chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `${svg(f.icon)} ${f.label}`;
      chip.addEventListener("click", () => {
        const on = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!on));
        if (on) state.filters.features.delete(f.key); else state.filters.features.add(f.key);
        applyFilters();
      });
      featWrap.appendChild(chip);
    });

    // search
    const input = $("#search-input");
    const clearBtn = $("#search-clear");
    const searchBox = input.closest(".search-box");
    const onSearch = debounce(() => {
      state.filters.search = input.value.trim().toLowerCase();
      clearBtn.hidden = state.filters.search.length === 0;
      applyFilters();
    }, 160);
    input.addEventListener("input", onSearch);
    clearBtn.addEventListener("click", () => { input.value = ""; state.filters.search = ""; clearBtn.hidden = true; applyFilters(); input.focus(); });

    // pressing Enter (or the search icon) jumps straight to the best-matching venue on the map
    function jumpToSearch() {
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      state.filters.search = q;
      clearBtn.hidden = false;
      applyFilters();
      const top = computeFilteredPlaces()[0];
      if (top) {
        flyToAndOpen(top.id);
        input.blur();
      } else if (searchBox) {
        searchBox.classList.remove("search-box--shake");
        // restart the animation even if triggered twice in a row
        void searchBox.offsetWidth;
        searchBox.classList.add("search-box--shake");
        setTimeout(() => searchBox.classList.remove("search-box--shake"), 420);
      }
    }
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); jumpToSearch(); }
    });
    const searchIcon = $("#search-submit");
    if (searchIcon) searchIcon.addEventListener("click", jumpToSearch);

    // reset
    $("#reset-filters").addEventListener("click", () => {
      state.filters.search = ""; state.filters.categories.clear(); state.filters.features.clear();
      input.value = ""; clearBtn.hidden = true;
      $$("#category-chips .chip, #feature-chips .chip").forEach(c => c.setAttribute("aria-pressed", "false"));
      applyFilters();
    });

    // mobile sidebar toggle
    const toggle = $("#sidebar-toggle"), sidebar = $("#sidebar"), scrim = $("#map-scrim");
    function setSidebarOpen(open) {
      sidebar.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      scrim.hidden = !open;
      if (open) closeDetail();
    }
    toggle.addEventListener("click", () => setSidebarOpen(!sidebar.classList.contains("is-open")));
    scrim.addEventListener("click", () => setSidebarOpen(false));
    window._closeSidebar = () => setSidebarOpen(false);
  }

  function toggleMapLayer(layer, on) {
    if (on) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else if (map.hasLayer(layer)) map.removeLayer(layer);
  }

  function updateActiveFilterCount() {
    const n = state.filters.categories.size + state.filters.features.size + (state.filters.search ? 1 : 0);
    const badge = $("#active-filter-count");
    badge.hidden = n === 0; badge.textContent = String(n);
  }

  function matchScore(place, q) {
    const name = place.name.toLowerCase();
    const addr = (place.address || "").toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if (addr.startsWith(q)) return 3;
    if (addr.includes(q)) return 4;
    return 5;
  }

  function computeFilteredPlaces() {
    const { search, categories, features } = state.filters;
    let results = state.places.filter(p => {
      if (search) {
        const hay = (p.name + " " + (p.address || "")).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (categories.size && !categories.has(p.category)) return false;
      for (const fkey of features) {
        if (!p.features[fkey] || p.features[fkey].value !== "yes") return false;
      }
      return true;
    });
    if (search) {
      // best match first, so "jump to searched place" (Enter / search icon) lands somewhere sensible
      results = results.slice().sort((a, b) => matchScore(a, search) - matchScore(b, search));
    }
    return results;
  }

  function applyFilters() {
    updateActiveFilterCount();
    renderVenues();
  }

  function resultIconFor(place) {
    return place.flagged
      ? `<span class="result-icon" style="background:var(--flag-red)">${svg("warning")}</span>`
      : `<span class="result-icon" style="background:var(--green-600)">${svg(CATEGORY_ICONS[place.category] || "dot")}</span>`;
  }

  function renderResultsList(filtered) {
    const list = $("#results-list");
    $("#results-count").textContent = filtered.length.toLocaleString();
    list.innerHTML = "";
    if (!filtered.length) {
      list.innerHTML = `<li class="results-empty">No venues match these filters yet. Try clearing one.</li>`;
      return;
    }
    const frag = document.createDocumentFragment();
    filtered.slice(0, 150).forEach(p => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "result-item";
      btn.innerHTML = `${resultIconFor(p)}
        <span class="result-body">
          <span class="result-name">${escapeHtml(p.name)}${p.flagged ? '<span class="flag-dot" title="Flagged for review"></span>' : ""}</span>
          <span class="result-meta">${escapeHtml(p.categoryLabel)}${p.address ? " · " + escapeHtml(p.address) : ""}</span>
        </span>`;
      btn.addEventListener("click", () => flyToAndOpen(p.id));
      li.appendChild(btn);
      frag.appendChild(li);
    });
    if (filtered.length > 150) {
      const li = document.createElement("li");
      li.className = "results-empty";
      li.textContent = `+ ${filtered.length - 150} more — refine search to narrow this down.`;
      frag.appendChild(li);
    }
    list.appendChild(frag);
  }

  function flyToAndOpen(placeId) {
    const p = placesById.get(placeId);
    if (!p) return;
    // make sure the matching layer is switched on, so the pin is actually visible at the destination
    const layerKey = p.flagged ? "flagged" : "venues";
    if (!state.layers[layerKey]) {
      state.layers[layerKey] = true;
      const cb = document.querySelector(`#layer-list input[data-layer="${layerKey}"]`);
      if (cb) cb.checked = true;
      renderVenues();
    }
    if (window.innerWidth <= 900 && window._closeSidebar) window._closeSidebar();
    map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
    openDetail(placeId);
  }

  /* ------------------------------ detail panel ------------------------------ */
  function initDetailPanel() {
    $("#detail-close").addEventListener("click", closeDetail);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeDetail(); });
  }

  function stepsOnEntryLabel(steps) {
    if (steps == null) return null;
    const n = Math.round(steps);
    if (n <= 0) return "Step-free entry";
    return `${n} step${n === 1 ? "" : "s"} at entry`;
  }

  function miniStars(rating) {
    if (rating == null) return "";
    const filled = Math.max(0, Math.min(5, Math.round(rating)));
    const stars = Array.from({ length: 5 }, (_, i) => `<svg viewBox="0 0 24 24" fill="none" class="mini-star${i < filled ? " is-filled" : ""}" aria-hidden="true"><path d="m12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7 2.6-5.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`).join("");
    return `<span class="mini-stars" title="${rating} out of 5">${stars}</span>`;
  }

  function renderReviewCard(review, citedIds) {
    const date = review.reviewedAt ? new Date(review.reviewedAt) : null;
    const dateLabel = date && !isNaN(date)
      ? date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
      : "Undated";
    const stepsLabel = stepsOnEntryLabel(review.stepsOnEntry);
    const badges = FEATURES.map(f => {
      const val = review.features[f.key];
      if (!val) return "";
      return `<span class="rev-badge val-${val}">${svg(f.icon)}${valueLabel(val)}</span>`;
    }).join("");
    const isCited = citedIds && citedIds.includes(review.id);
    return `<div class="review-card">
      <div class="review-top">
        <span class="review-date">${dateLabel}</span>
        ${miniStars(review.rating)}
      </div>
      ${stepsLabel ? `<div class="review-steps">${escapeHtml(stepsLabel)}</div>` : ""}
      <div class="review-badges">${badges}</div>
      ${isCited ? `<span class="review-cited">${svg("check")} Most recent evidence cited by the resolution engine</span>` : ""}
    </div>`;
  }

  function openDetail(placeId) {
    const p = placesById.get(placeId);
    if (!p) return;
    state.selectedPlaceId = placeId;

    const featureCards = FEATURES.map(f => {
      const data = p.features[f.key] || { value: "unsure", confidence: null, evidence_count: 0 };
      const filled = data.confidence != null ? Math.round(data.confidence * 5) : 0;
      const dots = Array.from({ length: 5 }, (_, i) =>
        `<span class="dot${i < filled ? " filled" : ""}"></span>`).join("");
      const evidence = data.evidence_count
        ? `${data.evidence_count} report${data.evidence_count === 1 ? "" : "s"}`
        : "No reports yet";
      return `<div class="feature-card">
        <div class="feature-top">
          <span class="feature-name">${svg(f.icon)} ${f.label}</span>
          <span class="feature-value val-${data.value}">${valueLabel(data.value)}</span>
        </div>
        <div class="feature-bottom">
          <span class="confidence-meter" title="Confidence from community reports">${dots}</span>
          <span class="evidence-note">${evidence}</span>
        </div>
      </div>`;
    }).join("");

    const flagBanner = p.flagged ? `<div class="dflag-banner">${svg("warning")}
        <span>Community reports disagree on at least one feature here. Numbers below reflect the majority
        view — check <button type="button" class="link-like" data-goto-quality="1" style="background:none;border:none;padding:0;color:#6B241A;text-decoration:underline;cursor:pointer;font:inherit;">Data quality</button> for the full breakdown.</span>
      </div>` : "";

    const toiletHtml = p.nearestToilet
      ? `<div class="toilet-card">
          <span class="toilet-icon">${svg("toilet")}</span>
          <span class="toilet-info"><strong>${escapeHtml(p.nearestToilet.name)}</strong>
          <span>Nearest accessible toilet · ${fmtDistance(p.nearestToilet.distanceM)} away</span></span>
          <button type="button" class="toilet-locate" data-locate-toilet="1">${svg("locate")} Show</button>
        </div>`
      : `<p class="no-toilet-note">No mapped accessible toilet nearby yet.</p>`;

    const placeConflicts = state.conflicts.filter(c => c.placeId === p.id);
    const citedIds = placeConflicts.flatMap(c => c.latestReviewIds || []);
    const reviews = p.reviews || [];
    const reviewsHtml = reviews.length
      ? `<div class="reviews-section">
          <h3 class="reviews-heading">Community reviews <span>(${reviews.length})</span></h3>
          <div class="reviews-list">${reviews.map(r => renderReviewCard(r, citedIds)).join("")}</div>
        </div>`
      : `<div class="reviews-section"><h3 class="reviews-heading">Community reviews <span>(0)</span></h3>
          <p class="no-toilet-note">No individual review records for this venue yet.</p></div>`;

    $("#detail-content").innerHTML = `
      <span class="dcat">${escapeHtml(p.categoryLabel)}</span>
      <h2 class="dname">${escapeHtml(p.name)}</h2>
      ${p.address ? `<p class="daddr">${escapeHtml(p.address)}</p>` : ""}
      ${p.rating ? `<p class="drating">${svg("star")} <strong>${p.rating.toFixed(1)}</strong> average · ${p.reviewCount} report${p.reviewCount === 1 ? "" : "s"}</p>` : ""}
      ${flagBanner}
      <div class="feature-grid">${featureCards}</div>
      ${toiletHtml}
      ${reviewsHtml}
    `;

    const gotoQ = $("#detail-content [data-goto-quality]");
    if (gotoQ) gotoQ.addEventListener("click", () => {
      switchView("quality");
      $("#quality-search").value = p.name;
      state.qualityFilters.search = p.name.toLowerCase();
      renderQualityTable();
    });
    const locateBtn = $("#detail-content [data-locate-toilet]");
    if (locateBtn) locateBtn.addEventListener("click", () => showToiletPopup(p.nearestToilet));

    $("#detail-panel").classList.add("is-open");
    $("#detail-panel").setAttribute("aria-hidden", "false");
  }

  function showToiletPopup(nearest) {
    const t = state.toilets.find(x => x.id === nearest.id);
    if (!t) return;
    map.flyTo([t.lat, t.lng], 18, { duration: 0.6 });
    setTimeout(() => {
      L.popup({ closeButton: true })
        .setLatLng([t.lat, t.lng])
        .setContent(`<div class="eam-popup-title">${escapeHtml(t.name)}</div><div class="eam-popup-sub">${escapeHtml(t.address || "")}</div>`)
        .openOn(map);
    }, 300);
  }

  function closeDetail() {
    state.selectedPlaceId = null;
    $("#detail-panel").classList.remove("is-open");
    $("#detail-panel").setAttribute("aria-hidden", "true");
  }

  /* ---------------------------------- nav ------------------------------------ */
  function initNav() {
    $$(".nav-tab").forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  }

  function switchView(view) {
    $$(".nav-tab").forEach(t => {
      const active = t.dataset.view === view;
      t.classList.toggle("is-active", active);
      if (active) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    $$(".view").forEach(v => v.hidden = true);
    $(`#view-${view}`).hidden = false;
    if (view === "map" && map) setTimeout(() => map.invalidateSize(), 60);
    if (window.innerWidth <= 900 && window._closeSidebar) window._closeSidebar();
    closeDetail();
  }

  /* ----------------------------- data quality view ---------------------------- */
  const STATUS_META = {
    human_review: { label: "Needs review", cls: "status-human_review" },
    provisional: { label: "Provisional", cls: "status-provisional" },
  };
  const QUALITY_META = {
    high: { label: "High", cls: "quality-high" },
    medium: { label: "Medium", cls: "quality-medium" },
    low: { label: "Low", cls: "quality-low" },
  };

  function initQualityView() {
    const c = state.meta.counts;
    const dq = state.meta.dataQuality;
    const res = state.meta.conflictResolution || {};
    const byStatus = res.byStatus || {};

    const resolutionStats = $("#resolution-stats");
    if (resolutionStats) {
      resolutionStats.innerHTML = [
        { n: res.totalConflicts || 0, l: "Conflicts detected" },
        { n: byStatus.provisional || 0, l: `Provisional (${Math.round((res.coverage || 0) * 100)}% coverage)` },
        { n: byStatus.human_review || 0, l: `Left for human review (${Math.round((res.humanReviewRate || 0) * 100)}%)` },
      ].map(s => `<div class="stat-card"><div class="stat-num" data-count="${s.n}">0</div><div class="stat-lbl">${s.l}</div></div>`).join("");
      $$("#resolution-stats .stat-num").forEach(el => animateCount(el, Number(el.dataset.count)));
    }
    const explainer = $("#resolution-explainer");
    if (explainer) {
      explainer.innerHTML = `Each conflict is scored from <strong>review-only, recency-weighted evidence</strong> —
        the venue-level aggregate is deliberately excluded so it can't be double-counted as an extra "vote".
        Recent reports count more than old ones (180-day half-life), and the score combines how one-sided the
        result is, how much of the evidence has a usable date, and how much of it is decisive (yes/no) rather
        than unsure. A conflict is marked <strong>provisional</strong> only once that score clears 0.60 —
        otherwise it's left for <strong>human review</strong> rather than guessed at. This is a heuristic, not a
        calibrated probability — resolution <em>accuracy</em> against verified ground truth isn't measured yet.`;
    }

    const stats = $("#quality-stats");
    stats.innerHTML = [
      { n: c.conflicts, l: "Total conflicts (all statuses)" },
      { n: c.places, l: "Venues mapped" },
      { n: dq.placesExcludedOutsideVictoria, l: "Rows excluded (outside VIC)" },
      { n: dq.placeNamesWithEncodingIssue, l: "Names with encoding issues" },
    ].map(s => `<div class="stat-card"><div class="stat-num" data-count="${s.n}">0</div><div class="stat-lbl">${s.l}</div></div>`).join("");
    $$("#quality-stats .stat-num").forEach(el => animateCount(el, Number(el.dataset.count)));

    const chipWrap = $("#quality-chips");
    const allChip = document.createElement("button");
    allChip.type = "button"; allChip.className = "chip"; allChip.setAttribute("aria-pressed", "true");
    allChip.textContent = "All features";
    allChip.addEventListener("click", () => setQualityFeature(null));
    chipWrap.appendChild(allChip);
    FEATURES.forEach(f => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip"; chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `${svg(f.icon)} ${f.label}`;
      chip.addEventListener("click", () => setQualityFeature(f.key, chip));
      chipWrap.appendChild(chip);
    });
    function setQualityFeature(key, chipEl) {
      state.qualityFilters.feature = key;
      $$("#quality-chips .chip").forEach(c => c.setAttribute("aria-pressed", "false"));
      (chipEl || allChip).setAttribute("aria-pressed", "true");
      renderQualityTable();
    }

    $("#quality-search").addEventListener("input", debounce(e => {
      state.qualityFilters.search = e.target.value.trim().toLowerCase();
      renderQualityTable();
    }, 160));

    renderQualityTable();

    // known issues cards
    const sample = dq.excludedPlaces.slice(0, 4).map(p => escapeHtml(p.name)).join(", ");
    $("#issue-cards").innerHTML = `
      <div class="issue-card">
        <h3>${svg("locate")} Venues outside Victoria</h3>
        <div class="issue-num">${dq.placesExcludedOutsideVictoria}</div>
        <p>Rows whose coordinates fall outside the Victoria bounding box — mostly venues in other Australian
          states or overseas, present in the source enaccess_places.csv export itself rather than introduced by
          this pipeline. Excluded from the map rather than shown at the wrong location.</p>
        ${sample ? `<div class="issue-sample">e.g. ${sample}…</div>` : ""}
      </div>
      <div class="issue-card">
        <h3>${svg("warning")} Encoding artifacts in names</h3>
        <div class="issue-num">${dq.placeNamesWithEncodingIssue}</div>
        <p>Venue names containing literal "?" characters — accented or non-Latin characters (café, Vietnamese,
          Chinese venue names) that were mangled by a charset mismatch somewhere upstream of
          <code>data/raw/enaccess_places.csv</code>. Shown as-is rather than guessed at.</p>
      </div>`;
  }

  function weightedBar(c) {
    const total = (c.yesWeight || 0) + (c.noWeight || 0) + (c.unsureWeight || 0);
    if (total <= 0) return "";
    const pct = v => (v / total * 100).toFixed(1);
    return `<div class="weight-bar" title="Recency-weighted votes — yes ${(c.yesWeight || 0).toFixed(2)}, no ${(c.noWeight || 0).toFixed(2)}, unsure ${(c.unsureWeight || 0).toFixed(2)}">
      <span class="weight-seg weight-yes" style="width:${pct(c.yesWeight || 0)}%"></span>
      <span class="weight-seg weight-no" style="width:${pct(c.noWeight || 0)}%"></span>
      <span class="weight-seg weight-unsure" style="width:${pct(c.unsureWeight || 0)}%"></span>
    </div>`;
  }

  function renderQualityTable() {
    const { search, feature } = state.qualityFilters;
    const rows = state.conflicts.filter(c => {
      if (feature && c.featureType !== feature) return false;
      if (search && !(c.placeName || "").toLowerCase().includes(search)) return false;
      return true;
    });
    const tbody = $("#quality-tbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr class="qt-empty"><td colspan="5">No conflicts match this filter.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(c => {
      const statusMeta = STATUS_META[c.status] || { label: c.status, cls: "status-human_review" };
      const qualityMeta = QUALITY_META[c.evidenceQuality] || { label: c.evidenceQuality, cls: "quality-low" };
      const scorePct = c.resolutionScore != null ? Math.round(c.resolutionScore * 100) : null;
      const dateShort = c.latestReviewedAt ? new Date(c.latestReviewedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : null;
      return `
      <tr>
        <td class="qt-venue"><strong>${escapeHtml(c.placeName)}</strong>${c.placeAddress ? `<span>${escapeHtml(c.placeAddress)}</span>` : ""}</td>
        <td class="qt-feature">${escapeHtml(FEATURE_BY_KEY[c.featureType]?.short || c.featureType)}</td>
        <td>
          <div class="qt-counts">
            <span class="qt-yes"><b>${c.yesCount}</b> yes</span>
            <span class="qt-no"><b>${c.noCount}</b> no</span>
            <span class="qt-unsure"><b>${c.unsureCount}</b> unsure</span>
          </div>
          ${weightedBar(c)}
          <span class="qt-weighted-label">recency-weighted</span>
        </td>
        <td class="qt-score-cell">
          ${scorePct != null ? `<div class="qt-score-num ${qualityMeta.cls}">${scorePct}%</div>` : "—"}
          <div class="qt-proposed">proposes <b>${escapeHtml(c.proposedValue)}</b></div>
          <div class="qt-quality ${qualityMeta.cls}">${escapeHtml(qualityMeta.label)} evidence</div>
        </td>
        <td>
          <span class="qt-status ${statusMeta.cls}">${escapeHtml(statusMeta.label)}</span>
          ${dateShort ? `<span class="qt-rationale">Latest evidence: ${escapeHtml(dateShort)}</span>` : ""}
        </td>
      </tr>`;
    }).join("");
  }

  /* --------------------------------- about view -------------------------------- */
  function initAboutView() {
    $("#source-list").innerHTML = state.meta.dataSources.map(s => `
      <div class="source-item">
        <strong>${escapeHtml(s.description || s.filename)}</strong>
        <span>${escapeHtml(s.origin || "")}${s.license ? " · " + escapeHtml(s.license) : ""}</span>
      </div>`).join("");
    const footnote = $("#about-footnote");
    if (state.meta.generatedAt) {
      footnote.textContent += ` Data last exported ${new Date(state.meta.generatedAt).toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" })}.`;
    }
  }

  /* --------------------------------- utils -------------------------------------- */
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function titleCase(str) {
    return String(str).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
    bag:      '<path d="M6 8h12l-1 12H7L6 8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.6"/>',
    cross:    '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    building: '<path d="M5 21V6l7-3 7 3v15M5 21h14M9 10h2M13 10h2M9 14h2M13 14h2M9 21v-4h6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    dot:      '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
    warning:  '<path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4M12 17v.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    locate:   '<path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/>',
    star:     '<path d="m12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7 2.6-5.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    check:    '<path d="M5 12.5 9.5 17 19 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  function svg(name, extraClass) {
    return `<svg class="${extraClass || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
  }

  /* --------------------------------- state -------------------------------- */
  const state = {
    places: [], toilets: [], tgsi: [], conflicts: [], meta: null,
    filters: { search: "", categories: new Set(), features: new Set() },
    layers: { venues: true, toilets: true, tgsi: false, flagged: false },
    selectedPlaceId: null,
    qualityFilters: { search: "", feature: null },
  };

  let map, venuesCluster, flaggedCluster, toiletsCluster, tgsiLayer;
  let placesById = new Map();

  /* -------------------------------- helpers -------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function haversineM(lat1, lng1, lat2, lng2) {
    const r = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  function fmtDistance(m) {
    if (m == null) return "";
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  function animateCount(el, to, duration = 650) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = to.toLocaleString(); return;
    }
    const from = 0, start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function valueLabel(v) { return v === "yes" ? "Yes" : v === "no" ? "No" : "Unsure"; }

  /* --------------------------------- boot ---------------------------------- */
  async function boot() {
    try {
      const [places, toilets, tgsi, conflicts, meta] = await Promise.all(
        ["places.json", "toilets.json", "tgsi.json", "conflicts.json", "meta.json"].map(f =>
          fetch(DATA_BASE + f).then(r => {
            if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
            return r.json();
          })
        )
      );
      state.places = places; state.toilets = toilets; state.tgsi = tgsi;
      state.conflicts = conflicts; state.meta = meta;
      placesById = new Map(places.map(p => [p.id, p]));

      initMap();
      initSidebar();
      initDetailPanel();
      initNav();
      initQualityView();
      initAboutView();
      applyFilters();

      $("#loading-screen").style.display = "none";
      $("#app").hidden = false;
    } catch (err) {
      console.error("Failed to load EnAccessMap data:", err);
      const ls = $("#loading-screen");
      ls.innerHTML = `<div style="max-width:420px;text-align:center;padding:0 20px;">
        <p style="font-family:var(--font-mono);font-size:13px;">Couldn't load the map data.</p>
        <p style="font-family:var(--font-mono);font-size:12px;opacity:.8;">
          If you opened index.html directly from disk, browsers block local file requests.
          Serve the folder instead, e.g. <code style="background:rgba(255,255,255,.12);color:#F0D9A6;">python3 -m http.server</code>,
          then open http://localhost:8000/frontend/.
        </p></div>`;
    }
  }

  /* --------------------------------- map ------------------------------------ */
  function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 9, maxZoom: 19 })
      .setView(MELBOURNE_CENTER, 13);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);

    const clusterOpts = {
      iconCreateFunction: cluster => L.divIcon({
        html: `<div>${cluster.getChildCount()}</div>`,
        className: "marker-cluster-eam", iconSize: L.point(38, 38),
      }),
      maxClusterRadius: 46, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
    };
    venuesCluster = L.markerClusterGroup(clusterOpts);
    flaggedCluster = L.markerClusterGroup(clusterOpts);
    toiletsCluster = L.markerClusterGroup(clusterOpts);
    tgsiLayer = L.layerGroup();

    venuesCluster.addTo(map);
    flaggedCluster.addTo(map);
    toiletsCluster.addTo(map);

    renderToilets();
    renderTgsi();

    map.on("click", () => closeDetail());
  }

  function venueIcon(flagged) {
    return L.divIcon({
      className: "",
      html: `<div class="eam-pin eam-pin--venue${flagged ? " is-flagged" : ""}" style="width:26px;height:26px;">${flagged ? svg("warning") : ""}</div>`,
      iconSize: [26, 26], iconAnchor: [13, 25], popupAnchor: [0, -22],
    });
  }

  function popupHtml(title, sub) {
    return `<div class="eam-popup-title">${escapeHtml(title)}</div><div class="eam-popup-sub">${escapeHtml(sub || "")}</div>
      <button type="button" class="eam-popup-btn" data-open-detail="1">View accessibility details</button>`;
  }

  function makeVenueMarker(place) {
    const m = L.marker([place.lat, place.lng], { icon: venueIcon(place.flagged), keyboard: false });
    m.bindPopup(popupHtml(place.name, place.address || place.categoryLabel), { closeButton: true });
    m.on("popupopen", (e) => {
      const btn = e.popup.getElement().querySelector("[data-open-detail]");
      if (btn) btn.addEventListener("click", () => openDetail(place.id));
    });
    m.on("click", () => { m.openPopup(); });
    return m;
  }

  function renderVenues() {
    venuesCluster.clearLayers();
    flaggedCluster.clearLayers();
    const filtered = computeFilteredPlaces();
    const nonFlagged = [], flagged = [];
    filtered.forEach(p => (p.flagged ? flagged : nonFlagged).push(p));

    if (state.layers.venues) {
      nonFlagged.forEach(p => venuesCluster.addLayer(makeVenueMarker(p)));
    }
    if (state.layers.flagged) {
      flagged.forEach(p => flaggedCluster.addLayer(makeVenueMarker(p)));
    }
    updateCounts(filtered, nonFlagged, flagged);
    renderResultsList(filtered);
  }

  function renderToilets() {
    state.toilets.forEach(t => {
      let marker;
      if (t.accessible) {
        marker = L.marker([t.lat, t.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="eam-toilet-dot" style="width:20px;height:20px;background:var(--gold-600);display:flex;align-items:center;justify-content:center;color:#fff;">${svg("toilet")}</div>`,
            iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -8],
          }),
        });
      } else {
        marker = L.circleMarker([t.lat, t.lng], {
          radius: 4, color: "#B87F1C", weight: 1.5, fillColor: "#fff", fillOpacity: 0.9,
        });
      }
      const sub = [t.address, t.council ? titleCase(t.council) : null].filter(Boolean).join(" · ");
      marker.bindPopup(`<div class="eam-popup-title">${escapeHtml(t.name)}</div>
        <div class="eam-popup-sub">${escapeHtml(sub)}</div>
        <div class="eam-popup-sub">${t.accessible ? "♿ Wheelchair accessible" : "Standard facility"}${t.parkingAccessible ? " · Accessible parking" : ""}</div>`);
      toiletsCluster.addLayer(marker);
    });
  }

  function renderTgsi() {
    state.tgsi.forEach(t => {
      const marker = L.circleMarker([t.lat, t.lng], {
        radius: 3.5, className: "eam-tgsi-dot", color: "#fff", weight: 1, fillColor: "#C4700B", fillOpacity: 0.85,
      });
      marker.bindPopup(`<div class="eam-popup-title">Tactile paving</div><div class="eam-popup-sub">${escapeHtml(t.description || t.roadSegment || "")}</div>`);
      tgsiLayer.addLayer(marker);
    });
  }

  function updateCounts(filtered, nonFlagged, flagged) {
    animateCount($("#count-venues"), nonFlagged.length);
    animateCount($("#count-toilets"), state.toilets.length);
    animateCount($("#count-tgsi"), state.tgsi.length);
    animateCount($("#count-flagged"), flagged.length);
  }

  /* -------------------------------- sidebar --------------------------------- */
  function initSidebar() {
    // layer toggles
    $$("#layer-list input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        const layer = cb.dataset.layer;
        state.layers[layer] = cb.checked;
        if (layer === "toilets") toggleMapLayer(toiletsCluster, cb.checked);
        if (layer === "tgsi") toggleMapLayer(tgsiLayer, cb.checked);
        if (layer === "venues" || layer === "flagged") renderVenues();
        updateActiveFilterCount();
      });
    });

    // category chips
    const catWrap = $("#category-chips");
    state.meta.categories.forEach(cat => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip"; chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `${svg(CATEGORY_ICONS[cat.key] || "dot")} ${cat.label} <span class="chip-n">${cat.count}</span>`;
      chip.addEventListener("click", () => {
        const on = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!on));
        if (on) state.filters.categories.delete(cat.key); else state.filters.categories.add(cat.key);
        applyFilters();
      });
      catWrap.appendChild(chip);
    });

    // feature chips ("must have")
    const featWrap = $("#feature-chips");
    FEATURES.forEach(f => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip"; chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `${svg(f.icon)} ${f.label}`;
      chip.addEventListener("click", () => {
        const on = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!on));
        if (on) state.filters.features.delete(f.key); else state.filters.features.add(f.key);
        applyFilters();
      });
      featWrap.appendChild(chip);
    });

    // search
    const input = $("#search-input");
    const clearBtn = $("#search-clear");
    const searchBox = input.closest(".search-box");
    const onSearch = debounce(() => {
      state.filters.search = input.value.trim().toLowerCase();
      clearBtn.hidden = state.filters.search.length === 0;
      applyFilters();
    }, 160);
    input.addEventListener("input", onSearch);
    clearBtn.addEventListener("click", () => { input.value = ""; state.filters.search = ""; clearBtn.hidden = true; applyFilters(); input.focus(); });

    // pressing Enter (or the search icon) jumps straight to the best-matching venue on the map
    function jumpToSearch() {
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      state.filters.search = q;
      clearBtn.hidden = false;
      applyFilters();
      const top = computeFilteredPlaces()[0];
      if (top) {
        flyToAndOpen(top.id);
        input.blur();
      } else if (searchBox) {
        searchBox.classList.remove("search-box--shake");
        // restart the animation even if triggered twice in a row
        void searchBox.offsetWidth;
        searchBox.classList.add("search-box--shake");
        setTimeout(() => searchBox.classList.remove("search-box--shake"), 420);
      }
    }
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); jumpToSearch(); }
    });
    const searchIcon = $("#search-submit");
    if (searchIcon) searchIcon.addEventListener("click", jumpToSearch);

    // reset
    $("#reset-filters").addEventListener("click", () => {
      state.filters.search = ""; state.filters.categories.clear(); state.filters.features.clear();
      input.value = ""; clearBtn.hidden = true;
      $$("#category-chips .chip, #feature-chips .chip").forEach(c => c.setAttribute("aria-pressed", "false"));
      applyFilters();
    });

    // mobile sidebar toggle
    const toggle = $("#sidebar-toggle"), sidebar = $("#sidebar"), scrim = $("#map-scrim");
    function setSidebarOpen(open) {
      sidebar.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      scrim.hidden = !open;
      if (open) closeDetail();
    }
    toggle.addEventListener("click", () => setSidebarOpen(!sidebar.classList.contains("is-open")));
    scrim.addEventListener("click", () => setSidebarOpen(false));
    window._closeSidebar = () => setSidebarOpen(false);
  }

  function toggleMapLayer(layer, on) {
    if (on) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else if (map.hasLayer(layer)) map.removeLayer(layer);
  }

  function updateActiveFilterCount() {
    const n = state.filters.categories.size + state.filters.features.size + (state.filters.search ? 1 : 0);
    const badge = $("#active-filter-count");
    badge.hidden = n === 0; badge.textContent = String(n);
  }

  function matchScore(place, q) {
    const name = place.name.toLowerCase();
    const addr = (place.address || "").toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if (addr.startsWith(q)) return 3;
    if (addr.includes(q)) return 4;
    return 5;
  }

  function computeFilteredPlaces() {
    const { search, categories, features } = state.filters;
    let results = state.places.filter(p => {
      if (search) {
        const hay = (p.name + " " + (p.address || "")).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (categories.size && !categories.has(p.category)) return false;
      for (const fkey of features) {
        if (!p.features[fkey] || p.features[fkey].value !== "yes") return false;
      }
      return true;
    });
    if (search) {
      // best match first, so "jump to searched place" (Enter / search icon) lands somewhere sensible
      results = results.slice().sort((a, b) => matchScore(a, search) - matchScore(b, search));
    }
    return results;
  }

  function applyFilters() {
    updateActiveFilterCount();
    renderVenues();
  }

  function resultIconFor(place) {
    return place.flagged
      ? `<span class="result-icon" style="background:var(--flag-red)">${svg("warning")}</span>`
      : `<span class="result-icon" style="background:var(--green-600)">${svg(CATEGORY_ICONS[place.category] || "dot")}</span>`;
  }

  function renderResultsList(filtered) {
    const list = $("#results-list");
    $("#results-count").textContent = filtered.length.toLocaleString();
    list.innerHTML = "";
    if (!filtered.length) {
      list.innerHTML = `<li class="results-empty">No venues match these filters yet. Try clearing one.</li>`;
      return;
    }
    const frag = document.createDocumentFragment();
    filtered.slice(0, 150).forEach(p => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "result-item";
      btn.innerHTML = `${resultIconFor(p)}
        <span class="result-body">
          <span class="result-name">${escapeHtml(p.name)}${p.flagged ? '<span class="flag-dot" title="Flagged for review"></span>' : ""}</span>
          <span class="result-meta">${escapeHtml(p.categoryLabel)}${p.address ? " · " + escapeHtml(p.address) : ""}</span>
        </span>`;
      btn.addEventListener("click", () => flyToAndOpen(p.id));
      li.appendChild(btn);
      frag.appendChild(li);
    });
    if (filtered.length > 150) {
      const li = document.createElement("li");
      li.className = "results-empty";
      li.textContent = `+ ${filtered.length - 150} more — refine search to narrow this down.`;
      frag.appendChild(li);
    }
    list.appendChild(frag);
  }

  function flyToAndOpen(placeId) {
    const p = placesById.get(placeId);
    if (!p) return;
    // make sure the matching layer is switched on, so the pin is actually visible at the destination
    const layerKey = p.flagged ? "flagged" : "venues";
    if (!state.layers[layerKey]) {
      state.layers[layerKey] = true;
      const cb = document.querySelector(`#layer-list input[data-layer="${layerKey}"]`);
      if (cb) cb.checked = true;
      renderVenues();
    }
    if (window.innerWidth <= 900 && window._closeSidebar) window._closeSidebar();
    map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
    openDetail(placeId);
  }

  /* ------------------------------ detail panel ------------------------------ */
  function initDetailPanel() {
    $("#detail-close").addEventListener("click", closeDetail);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeDetail(); });
  }

  function openDetail(placeId) {
    const p = placesById.get(placeId);
    if (!p) return;
    state.selectedPlaceId = placeId;

    const featureCards = FEATURES.map(f => {
      const data = p.features[f.key] || { value: "unsure", confidence: null, evidence_count: 0 };
      const filled = data.confidence != null ? Math.round(data.confidence * 5) : 0;
      const dots = Array.from({ length: 5 }, (_, i) =>
        `<span class="dot${i < filled ? " filled" : ""}"></span>`).join("");
      const evidence = data.evidence_count
        ? `${data.evidence_count} report${data.evidence_count === 1 ? "" : "s"}`
        : "No reports yet";
      return `<div class="feature-card">
        <div class="feature-top">
          <span class="feature-name">${svg(f.icon)} ${f.label}</span>
          <span class="feature-value val-${data.value}">${valueLabel(data.value)}</span>
        </div>
        <div class="feature-bottom">
          <span class="confidence-meter" title="Confidence from community reports">${dots}</span>
          <span class="evidence-note">${evidence}</span>
        </div>
      </div>`;
    }).join("");

    const flagBanner = p.flagged ? `<div class="dflag-banner">${svg("warning")}
        <span>Community reports disagree on at least one feature here. Numbers below reflect the majority
        view — check <button type="button" class="link-like" data-goto-quality="1" style="background:none;border:none;padding:0;color:#6B241A;text-decoration:underline;cursor:pointer;font:inherit;">Data quality</button> for the full breakdown.</span>
      </div>` : "";

    const toiletHtml = p.nearestToilet
      ? `<div class="toilet-card">
          <span class="toilet-icon">${svg("toilet")}</span>
          <span class="toilet-info"><strong>${escapeHtml(p.nearestToilet.name)}</strong>
          <span>Nearest accessible toilet · ${fmtDistance(p.nearestToilet.distanceM)} away</span></span>
          <button type="button" class="toilet-locate" data-locate-toilet="1">${svg("locate")} Show</button>
        </div>`
      : `<p class="no-toilet-note">No mapped accessible toilet nearby yet.</p>`;

    $("#detail-content").innerHTML = `
      <span class="dcat">${escapeHtml(p.categoryLabel)}</span>
      <h2 class="dname">${escapeHtml(p.name)}</h2>
      ${p.address ? `<p class="daddr">${escapeHtml(p.address)}</p>` : ""}
      ${p.rating ? `<p class="drating">${svg("star")} <strong>${p.rating.toFixed(1)}</strong> average · ${p.reviewCount} report${p.reviewCount === 1 ? "" : "s"}</p>` : ""}
      ${flagBanner}
      <div class="feature-grid">${featureCards}</div>
      ${toiletHtml}
    `;

    const gotoQ = $("#detail-content [data-goto-quality]");
    if (gotoQ) gotoQ.addEventListener("click", () => {
      switchView("quality");
      $("#quality-search").value = p.name;
      state.qualityFilters.search = p.name.toLowerCase();
      renderQualityTable();
    });
    const locateBtn = $("#detail-content [data-locate-toilet]");
    if (locateBtn) locateBtn.addEventListener("click", () => showToiletPopup(p.nearestToilet));

    $("#detail-panel").classList.add("is-open");
    $("#detail-panel").setAttribute("aria-hidden", "false");
  }

  function showToiletPopup(nearest) {
    const t = state.toilets.find(x => x.id === nearest.id);
    if (!t) return;
    map.flyTo([t.lat, t.lng], 18, { duration: 0.6 });
    setTimeout(() => {
      L.popup({ closeButton: true })
        .setLatLng([t.lat, t.lng])
        .setContent(`<div class="eam-popup-title">${escapeHtml(t.name)}</div><div class="eam-popup-sub">${escapeHtml(t.address || "")}</div>`)
        .openOn(map);
    }, 300);
  }

  function closeDetail() {
    state.selectedPlaceId = null;
    $("#detail-panel").classList.remove("is-open");
    $("#detail-panel").setAttribute("aria-hidden", "true");
  }

  /* ---------------------------------- nav ------------------------------------ */
  function initNav() {
    $$(".nav-tab").forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  }

  function switchView(view) {
    $$(".nav-tab").forEach(t => {
      const active = t.dataset.view === view;
      t.classList.toggle("is-active", active);
      if (active) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    $$(".view").forEach(v => v.hidden = true);
    $(`#view-${view}`).hidden = false;
    if (view === "map" && map) setTimeout(() => map.invalidateSize(), 60);
    if (window.innerWidth <= 900 && window._closeSidebar) window._closeSidebar();
    closeDetail();
  }

  /* ----------------------------- data quality view ---------------------------- */
  const STATUS_META = {
    needs_human_review: { label: "Needs review", cls: "status-needs_human_review" },
    resolved_majority: { label: "Resolved · majority", cls: "status-resolved_majority" },
    resolved_recent_evidence: { label: "Resolved · recent evidence", cls: "status-resolved_recent_evidence" },
  };

  function initQualityView() {
    const c = state.meta.counts;
    const dq = state.meta.dataQuality;
    const res = state.meta.conflictResolution || {};
    const byStatus = res.byStatus || {};

    const resolutionStats = $("#resolution-stats");
    if (resolutionStats) {
      resolutionStats.innerHTML = [
        { n: res.totalConflicts || 0, l: "Conflicts detected" },
        { n: (byStatus.resolved_majority || 0) + (byStatus.resolved_recent_evidence || 0), l: `Auto-resolved (${Math.round((res.coverage || 0) * 100)}% coverage)` },
        { n: byStatus.needs_human_review || 0, l: `Left for human review (${Math.round((res.humanReviewRate || 0) * 100)}%)` },
      ].map(s => `<div class="stat-card"><div class="stat-num" data-count="${s.n}">0</div><div class="stat-lbl">${s.l}</div></div>`).join("");
      $$("#resolution-stats .stat-num").forEach(el => animateCount(el, Number(el.dataset.count)));
    }
    const explainer = $("#resolution-explainer");
    if (explainer) {
      explainer.innerHTML = `The engine only auto-resolves a conflict when the evidence is genuinely one-sided: either
        a well-corroborated recent cluster of reports overrides a stale disagreement (accessibility features do
        change over time), or a lopsided majority (≥75% of at least 4 reports). Everything else — small samples,
        near-even splits — is deliberately left as <strong>needs review</strong> rather than guessed at.`;
    }

    const stats = $("#quality-stats");
    stats.innerHTML = [
      { n: c.conflicts, l: "Total conflicts (all statuses)" },
      { n: c.places, l: "Venues mapped" },
      { n: dq.placesExcludedOutsideVictoria, l: "Rows excluded (outside VIC)" },
      { n: dq.placeNamesWithEncodingIssue, l: "Names with encoding issues" },
    ].map(s => `<div class="stat-card"><div class="stat-num" data-count="${s.n}">0</div><div class="stat-lbl">${s.l}</div></div>`).join("");
    $$("#quality-stats .stat-num").forEach(el => animateCount(el, Number(el.dataset.count)));

    const chipWrap = $("#quality-chips");
    const allChip = document.createElement("button");
    allChip.type = "button"; allChip.className = "chip"; allChip.setAttribute("aria-pressed", "true");
    allChip.textContent = "All features";
    allChip.addEventListener("click", () => setQualityFeature(null));
    chipWrap.appendChild(allChip);
    FEATURES.forEach(f => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip"; chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `${svg(f.icon)} ${f.label}`;
      chip.addEventListener("click", () => setQualityFeature(f.key, chip));
      chipWrap.appendChild(chip);
    });
    function setQualityFeature(key, chipEl) {
      state.qualityFilters.feature = key;
      $$("#quality-chips .chip").forEach(c => c.setAttribute("aria-pressed", "false"));
      (chipEl || allChip).setAttribute("aria-pressed", "true");
      renderQualityTable();
    }

    $("#quality-search").addEventListener("input", debounce(e => {
      state.qualityFilters.search = e.target.value.trim().toLowerCase();
      renderQualityTable();
    }, 160));

    renderQualityTable();

    // known issues cards
    const sample = dq.excludedPlaces.slice(0, 4).map(p => escapeHtml(p.name)).join(", ");
    $("#issue-cards").innerHTML = `
      <div class="issue-card">
        <h3>${svg("locate")} Venues outside Victoria</h3>
        <div class="issue-num">${dq.placesExcludedOutsideVictoria}</div>
        <p>Rows whose coordinates fall outside the Victoria bounding box — mostly venues in other Australian
          states or overseas, present in the source enaccess_places.csv export itself rather than introduced by
          this pipeline. Excluded from the map rather than shown at the wrong location.</p>
        ${sample ? `<div class="issue-sample">e.g. ${sample}…</div>` : ""}
      </div>
      <div class="issue-card">
        <h3>${svg("warning")} Encoding artifacts in names</h3>
        <div class="issue-num">${dq.placeNamesWithEncodingIssue}</div>
        <p>Venue names containing literal "?" characters — accented or non-Latin characters (café, Vietnamese,
          Chinese venue names) that were mangled by a charset mismatch somewhere upstream of
          <code>data/raw/enaccess_places.csv</code>. Shown as-is rather than guessed at.</p>
      </div>`;
  }

  function renderQualityTable() {
    const { search, feature } = state.qualityFilters;
    const rows = state.conflicts.filter(c => {
      if (feature && c.featureType !== feature) return false;
      if (search && !(c.placeName || "").toLowerCase().includes(search)) return false;
      return true;
    });
    const tbody = $("#quality-tbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr class="qt-empty"><td colspan="4">No conflicts match this filter.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(c => {
      const meta = STATUS_META[c.status] || { label: c.status, cls: "status-needs_human_review" };
      return `
      <tr>
        <td class="qt-venue"><strong>${escapeHtml(c.placeName)}</strong>${c.placeAddress ? `<span>${escapeHtml(c.placeAddress)}</span>` : ""}</td>
        <td class="qt-feature">${escapeHtml(FEATURE_BY_KEY[c.featureType]?.short || c.featureType)}</td>
        <td><span class="qt-counts">
          <span class="qt-yes"><b>${c.yesCount}</b> yes</span>
          <span class="qt-no"><b>${c.noCount}</b> no</span>
          <span class="qt-unsure"><b>${c.unsureCount}</b> unsure</span>
        </span></td>
        <td>
          <span class="qt-status ${meta.cls}">${escapeHtml(meta.label)}</span>
          ${c.notes ? `<span class="qt-rationale">${escapeHtml(c.notes)}</span>` : ""}
        </td>
      </tr>`;
    }).join("");
  }

  /* --------------------------------- about view -------------------------------- */
  function initAboutView() {
    $("#source-list").innerHTML = state.meta.dataSources.map(s => `
      <div class="source-item">
        <strong>${escapeHtml(s.description || s.filename)}</strong>
        <span>${escapeHtml(s.origin || "")}${s.license ? " · " + escapeHtml(s.license) : ""}</span>
      </div>`).join("");
    const footnote = $("#about-footnote");
    if (state.meta.generatedAt) {
      footnote.textContent += ` Data last exported ${new Date(state.meta.generatedAt).toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" })}.`;
    }
  }

  /* --------------------------------- utils -------------------------------------- */
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function titleCase(str) {
    return String(str).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
