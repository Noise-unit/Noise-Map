// scripts/appdata.js
// ----------------------------------------------------
// Application Data Panel
// - Loads Google Sheets (published CSV) datasets
// - Plots as clustered points
// - Provides basic styling controls (single color or category-based)
// - Provides opacity control (marker opacity)
// - Stores parsed features for future Filters / Analysis tools
// ----------------------------------------------------

console.log("✅ appdata.js loaded");

// ----------------------------------------------------
// 1) Dataset Registry (edit here when any new datasets have to be added. 
// Based on the direction this may have to be altered for the database)
// ----------------------------------------------------

const APPDATA_DATASETS = [
  {
    id: "event_variations",
    name: "Event Variations",
    source: "Google Sheets",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vST9jFDozBD98GDTjeMAI5g_TL2-3YgPLjlvo4FhmtlV7GsnIrRayqJYuG8kOk1ZA3czA9qrfoZcomy/pub?gid=0&single=true&output=csv",
    geometry: "utm_points",
    eastingField: "Easting",
    northingField: "Northing",
    defaultColor: "#3b82f6",
    // metaUrl: "https://drive.google.com/....pdf",
  },
  /*{
    id: "noise_emitter_register",
    name: "Noise Emitter Register",
    source: "Google Sheets",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQtblKPdhMkE9JFaWIM6Us4eW009Qu3420todjnDvMQ_EvChZXoTnsKDtwpXohhytnPUaioi3jFa2Qj/pub?gid=0&single=true&output=csv",
    geometry: "utm_points",
    eastingField: "Easting",
    northingField: "Northing",
    defaultColor: "#3b82f6",
    // metaUrl: "",
  },*/
];

// ----------------------------------------------------
// 2) Small utilities
// ----------------------------------------------------

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeGoogleSheetsUrlToCsv(url) {
  if (!url) return url;

  const hasOutputCsv = /[?&]output=csv/i.test(url);
  if (hasOutputCsv) return url;

  if (url.includes("/pubhtml")) {
    const next = url.replace("/pubhtml", "/pub");
    const joiner = next.includes("?") ? "&" : "?";
    return `${next}${joiner}output=csv`;
  }

  return url;
}

// Haversine distance (meters) for picking best UTM zone conversion
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

function utmToLatLon(zoneNumber, easting, northing) {
  if (typeof proj4 === "undefined") {
    console.warn("proj4 not found. Make sure proj4.js loads before appdata.js");
    return null;
  }

  const epsgUTM = `+proj=utm +zone=${zoneNumber} +datum=WGS84 +units=m +no_defs`;
  const epsg4326 = "+proj=longlat +datum=WGS84 +no_defs";

  try {
    const [lon, lat] = proj4(epsgUTM, epsg4326, [easting, northing]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch (e) {
    return null;
  }
}

function utmToLatLonWithZoneFallback(easting, northing) {
  const ref = { lat: 10.55, lon: -61.25 }; // Trinidad center-ish
  const candidateZones = [20, 19, 21];

  const candidates = candidateZones
    .map((z) => {
      const ll = utmToLatLon(z, easting, northing);
      if (!ll) return null;

      const sane =
        ll.lat >= -5 &&
        ll.lat <= 25 &&
        ll.lon >= -80 &&
        ll.lon <= -45;

      const distance = haversineMeters(ref, ll);

      return { zone: z, ...ll, distance, sane };
    })
    .filter(Boolean);

  const saneCandidates = candidates.filter((c) => c.sane);
  const pool = saneCandidates.length ? saneCandidates : candidates;

  pool.sort((a, b) => a.distance - b.distance);

  return pool[0]
    ? { lat: pool[0].lat, lon: pool[0].lon, zone: pool[0].zone }
    : null;
}

function buildPopupHTML(datasetName, row) {
  const entries = Object.entries(row || {});
  const title = datasetName;

  const rowsHTML = entries
    .filter(([k]) => k && String(k).trim() !== "")
    .map(([key, val]) => {
      return `
        <tr>
          <td class="key">${escapeHTML(key)}</td>
          <td class="val">${escapeHTML(val)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="ema-popup">
      <h3>${escapeHTML(title)}</h3>
      <table>
        <tbody>
          ${rowsHTML}
        </tbody>
      </table>
    </div>
  `;
}

function createDivIcon(color, opacity = 1) {
  const safeOpacity = Math.max(0, Math.min(1, Number(opacity) || 1));
  return L.divIcon({
    className: "",
    html: `<div class="ema-marker" style="background:${escapeHTML(
      color
    )};opacity:${safeOpacity};"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

// Palette for category coloring 
// (up to 10 unique values for deciding on how the data is displayed)
const CATEGORY_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#22c55e",
  "#e11d48",
  "#64748b",
];

function getEligibleCategoryFields(rows, excludedFields = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const fields = Object.keys(rows[0] || {});
  const excluded = new Set(excludedFields.map((f) => String(f)));

  const eligible = [];

  for (const field of fields) {
    if (!field) continue;
    if (excluded.has(field)) continue;

    const uniques = new Set();

    for (const r of rows) {
      const raw = r[field];
      if (raw === undefined || raw === null) continue;

      const v = String(raw).trim();
      if (!v) continue;

      uniques.add(v);
      if (uniques.size > 10) break;
    }

    if (uniques.size >= 2 && uniques.size <= 10) {
      eligible.push({ field, uniqueCount: uniques.size });
    }
  }

  eligible.sort((a, b) => a.uniqueCount - b.uniqueCount);
  return eligible;
}

// ----------------------------------------------------
// 3) AppData Manager
// ----------------------------------------------------

class AppDataManager {
  constructor(mapInstance) {
    this.map = mapInstance;
    this.datasets = new Map();

    for (const config of APPDATA_DATASETS) {
      const normalized = {
        ...config,
        url: normalizeGoogleSheetsUrlToCsv(config.url),
      };

      this.datasets.set(config.id, {
        config: normalized,
        active: false,
        loaded: false,
        loading: false,
        error: null,

        rows: [],
        featuresGeoJSON: null,
        cluster: null,
        markers: [],

        // Filtering support
        isFiltered: false,
        filteredMarkers: [],
        filteredRows: [],
        filterSpec: null,

        eligibleCategoryFields: [],
        categoryField: null,
        categoryColorMap: new Map(),

        opacity: 1,
      });
    }
  }

  getDataset(id) {
    return this.datasets.get(id);
  }

  getAllDatasets() {
    return Array.from(this.datasets.values());
  }

  async loadDataset(id) {
    const ds = this.datasets.get(id);
    if (!ds) return;
    if (ds.loaded || ds.loading) return;

    ds.loading = true;
    ds.error = null;

    try {
      const rows = await this.fetchAndParseCSV(ds.config.url);

      const { markers, geojson } = this.buildMarkersAndGeoJSON(ds.config, rows);

      ds.rows = rows;
      ds.markers = markers;
      ds.featuresGeoJSON = geojson;

      ds.eligibleCategoryFields = getEligibleCategoryFields(rows, [
        ds.config.eastingField,
        ds.config.northingField,
      ]);

      if (!L.markerClusterGroup) {
        throw new Error(
          "Leaflet.markercluster not loaded. Please include markercluster scripts."
        );
      }

      ds.cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 16,
      });

      for (const m of markers) {
        ds.cluster.addLayer(m);
      }

      ds.loaded = true;
      ds.loading = false;
    } catch (err) {
      console.error("Dataset load failed:", err);
      ds.error = err?.message || "Failed to load dataset";
      ds.loading = false;
      ds.loaded = false;
    }
  }

  async setDatasetActive(id, active) {
    const ds = this.datasets.get(id);
    if (!ds) return;

    if (active && !ds.loaded) {
      await this.loadDataset(id);
    }

    if (active && ds.loaded && ds.cluster) {
      if (!this.map.hasLayer(ds.cluster)) {
        this.map.addLayer(ds.cluster);
      }
    }

    if (!active && ds.cluster && this.map.hasLayer(ds.cluster)) {
      this.map.removeLayer(ds.cluster);
    }

    ds.active = !!active;

    document.dispatchEvent(
      new CustomEvent("appdata:datasetActiveChanged", {
        detail: { id, active: !!active },
      })
    );
  }

  setDatasetOpacity(id, opacity) {
    const ds = this.datasets.get(id);
    if (!ds || !ds.loaded) return;

    const val = Math.max(0, Math.min(1, Number(opacity)));
    ds.opacity = val;

    // Apply opacity to markers (works for DivIcon markers)
    ds.markers.forEach((m) => {
      if (typeof m.setOpacity === "function") {
        m.setOpacity(val);
      } else {

        m.setIcon(createDivIcon(ds.config.defaultColor, val));
      }
    });
  }

  setCategoryField(id, fieldOrNull) {
    const ds = this.datasets.get(id);
    if (!ds || !ds.loaded) return;

    ds.categoryField = fieldOrNull || null;
    ds.categoryColorMap.clear();

    if (ds.categoryField) {
      const uniques = new Set();
      for (const r of ds.rows) {
        const raw = r[ds.categoryField];
        const v = String(raw ?? "").trim();
        if (!v) continue;
        uniques.add(v);
        if (uniques.size > 10) break;
      }

      const values = Array.from(uniques).slice(0, 10);
      values.forEach((val, idx) => {
        ds.categoryColorMap.set(
          val,
          CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length]
        );
      });
    }

    // update icon colors while preserving opacity
    ds.markers.forEach((marker) => {
      const row = marker.__appdataRow;
      let color = ds.config.defaultColor;

      if (ds.categoryField) {
        const raw = row?.[ds.categoryField];
        const v = String(raw ?? "").trim();
        if (v && ds.categoryColorMap.has(v)) {
          color = ds.categoryColorMap.get(v);
        }
      }

      marker.setIcon(createDivIcon(color, ds.opacity));
      if (typeof marker.setOpacity === "function") marker.setOpacity(ds.opacity);
    });
  }

  fetchAndParseCSV(url) {
    return new Promise((resolve, reject) => {
      if (typeof Papa === "undefined") {
        reject(new Error("PapaParse not found. Ensure papaparse is loaded."));
        return;
      }

      Papa.parse(url, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length) {
            console.warn("PapaParse errors:", results.errors);
          }
          resolve(results.data || []);
        },
        error: (err) => reject(err),
      });
    });
  }

  buildMarkersAndGeoJSON(config, rows) {
    const markers = [];
    const features = [];

    const eastField = config.eastingField;
    const northField = config.northingField;

    for (const row of rows) {
      const eRaw = row?.[eastField];
      const nRaw = row?.[northField];

      const easting = parseFloat(String(eRaw ?? "").replace(/,/g, ""));
      const northing = parseFloat(String(nRaw ?? "").replace(/,/g, ""));

      if (!Number.isFinite(easting) || !Number.isFinite(northing)) continue;

      const ll = utmToLatLonWithZoneFallback(easting, northing);
      if (!ll) continue;

      const latlng = L.latLng(ll.lat, ll.lon);

      const marker = L.marker(latlng, {
        icon: createDivIcon(config.defaultColor, 1),
        title: config.name,
      });

      marker.__appdataRow = row;
      marker.__appdataDatasetId = config.id;

      marker.bindPopup(buildPopupHTML(config.name, row), {
        maxWidth: 360,
        closeButton: true,
        autoPan: true,
      });

        const feature = {
          type: "Feature",
          geometry: { type: "Point", coordinates: [ll.lon, ll.lat] },
          properties: { ...row, __utm_zone_used: ll.zone },
        };

        // To Bind feature to marker for spatial checks + results table linking
        marker.__appdataFeature = feature;

        markers.push(marker);
        features.push(feature);
    }

    return {
      markers,
      geojson: {
        type: "FeatureCollection",
        name: config.name,
        features,
      },
    };
  }
      // FILTERING SUPPORT (Google Sheet datasets)

      clearDatasetFilter(id) {
        const ds = this.datasets.get(id);
        if (!ds || !ds.loaded || !ds.cluster) return;

        ds.isFiltered = false;
        ds.filteredMarkers = [];
        ds.filteredRows = [];
        ds.filterSpec = null;

        // Restore full dataset markers
        ds.cluster.clearLayers();
        ds.markers.forEach((m) => ds.cluster.addLayer(m));

        // If dataset is active, ensure it's visible on map
        if (ds.active && !this.map.hasLayer(ds.cluster)) {
          this.map.addLayer(ds.cluster);
        }

        document.dispatchEvent(
          new CustomEvent("appdata:datasetFilterChanged", {
            detail: { id, isFiltered: false, matchCount: ds.markers.length },
          })
        );
      }

      applyDatasetFilter(id, filterSpec, predicateFn) {
        const ds = this.datasets.get(id);
        if (!ds || !ds.loaded || !ds.cluster) return { matchCount: 0, matchedRows: [] };

        const matchedMarkers = [];
        const matchedRows = [];

        for (const m of ds.markers) {
          const row = m.__appdataRow || {};
          const feature = m.__appdataFeature || null;

          let ok = true;
          try {
            ok = predicateFn(row, feature, m);
          } catch (e) {
            ok = false;
          }

          if (ok) {
            matchedMarkers.push(m);
            matchedRows.push(row);
          }
        }

        ds.isFiltered = true;
        ds.filteredMarkers = matchedMarkers;
        ds.filteredRows = matchedRows;
        ds.filterSpec = filterSpec || null;

        // Show ONLY matching markers
        ds.cluster.clearLayers();
        matchedMarkers.forEach((m) => ds.cluster.addLayer(m));

        if (ds.active && !this.map.hasLayer(ds.cluster)) {
          this.map.addLayer(ds.cluster);
        }

        document.dispatchEvent(
          new CustomEvent("appdata:datasetFilterChanged", {
            detail: { id, isFiltered: true, matchCount: matchedMarkers.length },
          })
        );

        return {
          matchCount: matchedMarkers.length,
          matchedRows,
          matchedMarkers,
        };
      }

      getDatasetVisibleRows(id) {
        const ds = this.datasets.get(id);
        if (!ds || !ds.loaded) return [];

        return ds.isFiltered ? ds.filteredRows : ds.rows;
      }

      getDatasetVisibleMarkers(id) {
        const ds = this.datasets.get(id);
        if (!ds || !ds.loaded) return [];

        return ds.isFiltered ? ds.filteredMarkers : ds.markers;
      } 
}

// ----------------------------------------------------
// 4) Build the Application Data panel UI
// ----------------------------------------------------

function buildAppDataPanel(manager) {
  const root = document.getElementById("appdata-root");
  if (!root) {
    console.warn("❌ appdata.js: #appdata-root not found in HTML");
    return null;
  }

  root.innerHTML = "";

  const refreshers = new Map();

  const help = document.createElement("div");
  help.className = "appdata-help";
  help.innerHTML = `
    <div><strong>Datasets</strong></div>
    <div>Toggle each dataset ON/OFF.</div>
  `;

  const list = document.createElement("div");
  list.className = "appdata-datasets";

  root.appendChild(help);
  root.appendChild(list);

  manager.getAllDatasets().forEach((ds) => {
    const cfg = ds.config;

    const card = document.createElement("div");
    card.className = "dataset-card";

    // Title header
    const header = document.createElement("div");
    header.className = "dataset-card-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "dataset-title";

    const title = document.createElement("strong");
    title.textContent = cfg.name;
    titleWrap.appendChild(title);

    header.appendChild(titleWrap);
    card.appendChild(header);

    // Toggle row BELOW the title
    const toggleRow = document.createElement("div");
    toggleRow.className = "dataset-toggle-row";

    const status = document.createElement("span");
    status.className = "dataset-status";
    status.textContent = "Off";

    const toggleWrap = document.createElement("label");
    toggleWrap.className = "mini-toggle";
    toggleWrap.title = "Toggle dataset";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";

    toggleWrap.appendChild(toggle);

    toggleRow.appendChild(status);
    toggleRow.appendChild(toggleWrap);
    card.appendChild(toggleRow);

    // Opacity slider BELOW the toggle
    const opacityRow = document.createElement("div");
    opacityRow.className = "layer-opacity-row";
    opacityRow.innerHTML = `
      <div class="layer-opacity-label">Opacity</div>
      <input class="opacity-slider" type="range" min="0" max="1" step="0.05" value="1">
    `;
    const opacitySlider = opacityRow.querySelector(".opacity-slider");
    card.appendChild(opacityRow);

    // Metadata link BELOW the opacity slider (probably won't be applicable here but just in case we hneed it later on)
    const metaRow = document.createElement("div");
    metaRow.className = "layer-meta-row";

    if (cfg.metaUrl) {
      const link = document.createElement("a");
      link.className = "layer-meta-link";
      link.href = cfg.metaUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = "Open metadata document";
      link.innerHTML = `📄 <span>Metadata</span>`;
      metaRow.appendChild(link);
    } else {
      metaRow.style.display = "none";
    }

    card.appendChild(metaRow);

    // Controls
    const controls = document.createElement("div");
    controls.className = "dataset-controls";

    // Records
    const countRow = document.createElement("div");
    countRow.className = "dataset-row";

    const countLabel = document.createElement("div");
    countLabel.textContent = "Records";

    const countVal = document.createElement("div");
    countVal.className = "dataset-meta";
    countVal.textContent = "0";

    countRow.appendChild(countLabel);
    countRow.appendChild(countVal);

    // Display by
    const styleRow = document.createElement("div");
    styleRow.className = "dataset-row";

    const styleLabel = document.createElement("label");
    styleLabel.textContent = "Display by";

    const styleSelect = document.createElement("select");
    styleSelect.disabled = true;

    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "None (single color)";
    styleSelect.appendChild(optNone);

    styleRow.appendChild(styleLabel);
    styleRow.appendChild(styleSelect);

    controls.appendChild(countRow);
    controls.appendChild(styleRow);

    card.appendChild(controls);
    list.appendChild(card);

    // ---------- UI behavior ----------

    function setStatus(text, mode) {
      status.classList.remove("is-loading", "is-error");
      if (mode) status.classList.add(mode);
      status.textContent = text;
    }

    async function refreshCard() {
      const live = manager.getDataset(cfg.id);
      if (!live) return;

      if (live.loading) {
        setStatus("Loading…", "is-loading");
      } else if (live.error) {
        setStatus("Error", "is-error");
      } else if (live.active) {
        setStatus("On", "");
      } else {
        setStatus("Off", "");
      }

      // updates EVEN WHEN OFF if preloaded
      const recordCount = live.loaded ? live.markers.length : 0;
      countVal.textContent = String(recordCount);

      styleSelect.disabled = !live.loaded;

      // Populate style fields (once loaded)
      if (live.loaded) {
        // Clear existing options except first
        while (styleSelect.options.length > 1) {
          styleSelect.remove(1);
        }

        live.eligibleCategoryFields.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.field;
          opt.textContent = `${f.field} (${f.uniqueCount})`;
          styleSelect.appendChild(opt);
        });

        // Keep selection
        styleSelect.value = live.categoryField || "";

        // Keep opacity slider in sync
        opacitySlider.value = String(live.opacity ?? 1);
      }
    }

    // Register refresher so preload can refresh counts later
    refreshers.set(cfg.id, refreshCard);

    toggle.addEventListener("change", async () => {
      const wantOn = toggle.checked;

      // Nice UX: reopen tool panel if user clicks inside
      if (typeof window.openToolPanel === "function") {
        window.openToolPanel();
      }

      setStatus("Loading…", "is-loading");

      await manager.setDatasetActive(cfg.id, wantOn);
      await refreshCard();

      const live = manager.getDataset(cfg.id);
      if (wantOn && live?.error) {
        toggle.checked = false;
        await manager.setDatasetActive(cfg.id, false);
        await refreshCard();
      }
    });

    styleSelect.addEventListener("change", () => {
      const field = styleSelect.value || null;
      manager.setCategoryField(cfg.id, field);
    });

    opacitySlider.addEventListener("input", () => {
      const val = parseFloat(opacitySlider.value);
      manager.setDatasetOpacity(cfg.id, val);
    });

    // Initial render
    refreshCard();
  });

  // Return a UI controller so init/preload can refresh counts later
  return {
    refreshOne(id) {
      const fn = refreshers.get(id);
      if (fn) fn();
    },
    refreshAll() {
      refreshers.forEach((fn) => fn());
    },
  };
}

// ----------------------------------------------------
// 5) Initiation
// ----------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  if (typeof map === "undefined") {
    console.warn("❌ appdata.js: 'map' not found. Ensure main.js loads first.");
    return;
  }

  const manager = new AppDataManager(map);
  window.AppDataManager = manager;

  const ui = buildAppDataPanel(manager);

  // Preload all datasets in the background
  const preloadPromises = manager.getAllDatasets().map((ds) => {
    return manager.loadDataset(ds.config.id);
  });

  Promise.allSettled(preloadPromises).then(() => {
    // Refresh counts EVEN WHEN OFF
    if (ui) ui.refreshAll();
    console.log("✅ AppData preload finished + card counts refreshed");
  });

  console.log("✅ Application Data panel initialized.");
});
