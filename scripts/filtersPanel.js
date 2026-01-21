// scripts/filtersPanel.js
// ----------------------------------------------------
// Filters Panel
// Collapsible panels per ACTIVE dataset
// Multi-parameter filtering (year + date range + status + keywords + spatial + DA + proximity)
// ONLY filtered markers remain visible on map
// Results modal scrolls both ways + PDF captures full table
// Date fields only show REAL date formats (no serials/time-only/year-only)
// Spatial boundary sources list ALL repo layers (even OFF), exclude Roads
// Boundary Feature names use styling labelField (meta.labelField)
// Includes uploaded + drawn boundaries
// ----------------------------------------------------

console.log("✅ filtersPanel.js loaded");

(function () {
  // ----------------------------------------------------
  // Persistent state (survives panel switching)
  // ----------------------------------------------------
  window.FiltersPanelState = window.FiltersPanelState || {}; // datasetId -> state

  function getState(datasetId) {
    window.FiltersPanelState[datasetId] = window.FiltersPanelState[datasetId] || {};
    return window.FiltersPanelState[datasetId];
  }

  // ----------------------------------------------------
  // Helpers
  // ----------------------------------------------------
  function el(tag, className, html) {
    const d = document.createElement(tag);
    if (className) d.className = className;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function escapeHTML(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeKeywordList(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return [];
    const parts = text
      .split(/[,]+|[\n]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((chunk) => chunk.split(/\s+/g));
    return Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean)));
  }

  // ----------------------------------------------------
  // Reference matching helpers
  // - Allows "8806" to match "VR8806"
  // - Ignores case + whitespace
  // ----------------------------------------------------
  function normalizeRefValue(v) {
    return String(v ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function extractDigits(s) {
    const txt = String(s ?? "");
    const hits = txt.match(/\d+/g);
    return hits ? hits.join("") : "";
  }

  function isRefMatch(cellValue, queryValue) {
    const cellNorm = normalizeRefValue(cellValue);
    const qNorm = normalizeRefValue(queryValue);

    if (!cellNorm || !qNorm) return false;

    // Exact match (case/space insensitive)
    if (cellNorm === qNorm) return true;

    // Digit-only match: allow "8806" to match "VR8806"
    const qDigits = extractDigits(qNorm);
    if (qDigits && /^\d+$/.test(qDigits)) {
      const cellDigits = extractDigits(cellNorm);
      if (cellDigits === qDigits) return true;
      if (cellNorm.endsWith(qDigits)) return true;
    }

    return false;
  }

  // ----------------------------------------------------
  // Filter summary helpers (for table title/subtitle + PDF)
  // ----------------------------------------------------
  function buildFilterSummaryParts(spec) {
    if (!spec) return [];

    const parts = [];

    // Year
    if (spec.year?.selected?.length) {
      parts.push(`Year: ${spec.year.selected.join(", ")}`);
    }

    // Date Range
    if (spec.dateField && (spec.dateFrom || spec.dateTo)) {
      const from = spec.dateFrom || "Any";
      const to = spec.dateTo || "Any";
      parts.push(`Date: ${from} → ${to}`);
    }

    // Status
    if (spec.statusField && spec.statusSelected?.length) {
      parts.push(`Status: ${spec.statusSelected.join(", ")}`);
    }

    // Designated Activity (CEC)
    if (spec.designatedActivity?.selected?.length) {
      parts.push(`DA: ${spec.designatedActivity.selected.join(", ")}`);
    }

    // Keywords
    if (spec.keywords?.list?.length) {
      parts.push(`Keywords (${(spec.keywords.mode || "all").toUpperCase()}): ${spec.keywords.list.join(" ")}`);
    }

    // Proximity
    if (spec.nearby?.enabled) {
      const df = spec.nearby.dateField || "(date field not set)";
      parts.push(
        `Proximity: Ref ${spec.nearby.refQuery} | ${spec.nearby.radiusMeters}m | ±${spec.nearby.daysWindow} days | Date: ${df}`
      );
    }

    // Spatial
    if (spec.spatial?.enabled) {
      const buff = Number(spec.spatial.bufferMeters || 0);
      const mode = spec.spatial.mode === "ring" ? "Buffer only" : "Buffer + inside";
      parts.push(`Spatial: ${buff}m (${mode})`);
    }

    return parts;
  }

  function buildFilterSummaryText(spec) {
    const parts = buildFilterSummaryParts(spec);
    return parts.length ? parts.join(" | ") : "No filters applied (showing all records)";
  }

  // Short title version (prevents super long titles)
  function buildShortTitleFromSpec(datasetName, spec, maxLen = 85) {
    const summary = buildFilterSummaryText(spec);
    const title = `${datasetName} — ${summary}`;
    if (title.length <= maxLen) return title;
    return `${datasetName} — ${summary.slice(0, maxLen - datasetName.length - 5)}…`;
  }

  // ----------------------------------------------------
  // STRICT Date Validation + MULTI-DATE extraction
  //
  // Allowed date formats found anywhere inside a cell:
  // - dd/mm/yyyy
  // - yyyy-mm-dd
  // - dd-mmm-yyyy (14-Jan-2025)
  //
  // Reject:
  // - time-only
  // - year-only
  // - excel serials like 34565
  // ----------------------------------------------------
  function isTimeOnlyString(s) {
    const t = String(s ?? "").trim().toLowerCase();
    if (!t) return false;
    return /(\b\d{1,2}:\d{2}\b)\s*(a\.?m\.?|p\.?m\.?)?/i.test(t);
  }

  function isYearOnlyString(s) {
    const t = String(s ?? "").trim();
    return /^\d{4}$/.test(t);
  }

  function isExcelSerialNumber(s) {
    const t = String(s ?? "").trim();
    if (!/^\d+$/.test(t)) return false;
    if (t.length === 4) return false; // year-like
    return t.length >= 5 && t.length <= 6;
  }

  // Extract ALL recognizable date timestamps from any messy cell text
  function extractAllDatesFromCell(value) {
    if (value === null || value === undefined) return [];
    const raw = String(value).trim();
    if (!raw) return [];

    // reject obvious non-date cells
    if (isYearOnlyString(raw)) return [];
    if (isExcelSerialNumber(raw)) return [];
    if (isTimeOnlyString(raw)) return [];

    const out = [];

    // dd/mm/yyyy
    const reDMY = /\b([0-3]?\d)\/([0-1]?\d)\/(\d{4})\b/g;

    // yyyy-mm-dd
    const reISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

    // dd-mmm-yyyy (or dd mmm yyyy, dd/mmm/yyyy, etc.)
    const reDMonY = /\b([0-3]?\d)[\-\/\s]([A-Za-z]{3,})[\-\/\s](\d{4})\b/g;

    let m;

    while ((m = reISO.exec(raw)) !== null) {
      const year = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10) - 1;
      const dd = parseInt(m[3], 10);
      const dt = new Date(year, mm, dd);
      if (dt && dt.getFullYear() === year) out.push(dt.getTime());
    }

    while ((m = reDMY.exec(raw)) !== null) {
      const dd = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10) - 1;
      const year = parseInt(m[3], 10);
      const dt = new Date(year, mm, dd);
      if (dt && dt.getFullYear() === year) out.push(dt.getTime());
    }

    const monthMap = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };

    while ((m = reDMonY.exec(raw)) !== null) {
      const dd = parseInt(m[1], 10);
      const monRaw = String(m[2] || "").slice(0, 3).toLowerCase();
      const year = parseInt(m[3], 10);
      if (monthMap[monRaw] === undefined) continue;
      const dt = new Date(year, monthMap[monRaw], dd);
      if (dt && dt.getFullYear() === year) out.push(dt.getTime());
    }

    // dedupe + sort
    const unique = Array.from(new Set(out)).sort((a, b) => a - b);
    return unique;
  }

  // For old code compatibility: return FIRST date in a cell, or null
  function parseStrictDate(value) {
    const dates = extractAllDatesFromCell(value);
    return dates.length ? dates[0] : null;
  }

  // Detect date fields: a field qualifies if most sampled rows contain at least 1 recognizable date
  function detectDateFields(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const keys = Object.keys(rows[0] || {});
    const out = [];

    for (const k of keys) {
      if (!k) continue;

      let tested = 0;
      let validCells = 0;

      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        const raw = rows[i]?.[k];
        const s = String(raw ?? "").trim();
        if (!s) continue;

        // skip pure year/time/serial
        if (isYearOnlyString(s) || isExcelSerialNumber(s) || isTimeOnlyString(s)) continue;

        tested++;

        const dates = extractAllDatesFromCell(s);
        if (dates.length) validCells++;
      }

      const ratio = tested ? validCells / tested : 0;

      // ✅ Require: at least 5 tested values AND ≥ 65% contain recognizable date(s)
      if (tested >= 5 && ratio >= 0.65) {
        out.push(k);
      }
    }

    return out;
  }

  function buildSearchableTextFields(rows, dateFields, ignoreFields = []) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const keys = Object.keys(rows[0] || {});
    const dateSet = new Set(dateFields.map(String));
    const ignoreSet = new Set(ignoreFields.map(String));

    return keys.filter((k) => {
      if (!k) return false;
      if (dateSet.has(k)) return false;
      if (ignoreSet.has(k)) return false;

      const n = String(k).toLowerCase();

      // exclude coordinate fields
      if (n.includes("easting") || n.includes("northing") || n.includes("lat") || n.includes("lon")) return false;

      // exclude time/year/date labeled fields
      if (n.includes("time") || n.includes("date") || n.includes("year")) return false;

      return true;
    });
  }

  function uniqueValues(rows, field, limit = 500) {
    const set = new Set();
    for (const r of rows || []) {
      const v = String(r?.[field] ?? "").trim();
      if (!v) continue;
      set.add(v);
      if (set.size >= limit) break;
    }
    return Array.from(set);
  }

  // ----------------------------------------------------
  // Year helpers (unique values from "Year" column)
  // ----------------------------------------------------
  function findYearField(rows) {
    if (!rows?.length) return null;
    const keys = Object.keys(rows[0] || {});
    return keys.find((k) => String(k).trim().toLowerCase() === "year") || null;
  }

  function uniqueYears(rows, yearField) {
    if (!yearField) return [];
    const set = new Set();

    for (const r of rows || []) {
      const v = String(r?.[yearField] ?? "").trim();
      if (!v) continue;
      set.add(v);
    }

    const arr = Array.from(set);

    const numeric = arr.every((x) => /^\d{4}$/.test(x));
    if (numeric) arr.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    else arr.sort((a, b) => a.localeCompare(b));

    return arr;
  }

  // ✅ Status fields:
  // - name contains determination/status/decision/outcome
  // - AND unique values <= 10
  function buildStatusFieldList(rows) {
    const keys = Object.keys(rows[0] || {});
    const candidates = keys.filter((k) => {
      const n = String(k).toLowerCase();
      return n.includes("determ") || n.includes("status") || n.includes("decision") || n.includes("outcome");
    });

    return candidates.filter((k) => uniqueValues(rows, k, 80).length <= 10);
  }

  // ----------------------------------------------------
  // Checkbox Checklist (multi-select with checkmarks)
  // ----------------------------------------------------
  function createChecklist(container, options, selectedSet, onChange) {
    container.innerHTML = "";
    const box = el("div", "checklist-box");

    for (const opt of options) {
      const row = el("label", "checklist-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = opt;
      cb.checked = selectedSet.has(opt);

      cb.addEventListener("change", () => {
        if (cb.checked) selectedSet.add(opt);
        else selectedSet.delete(opt);
        onChange?.(Array.from(selectedSet));
      });

      row.appendChild(cb);
      row.appendChild(el("span", "", escapeHTML(opt)));
      box.appendChild(row);
    }

    container.appendChild(box);
  }

  // ----------------------------------------------------
  // ✅ Boundary Sources (Repo + Uploaded + Drawn)
  // - includes layers even if OFF
  // - excludes Roads layer
  // - feature names use meta.labelField if available
  // ----------------------------------------------------
  function isRoadsLayer(obj, id) {
    const name = String(obj?.name || "").toLowerCase();
    const lid = String(id || "").toLowerCase();
    if (name.includes("road") || lid.includes("road")) return true;
    if (obj?.meta?.isRoads === true) return true;
    return false;
  }

  function listBoundarySources() {
    const choices = [];
    const mgr = window.UserLayerManager;

    // Repo layers
    if (mgr?.repo) {
      for (const id in mgr.repo) {
        const obj = mgr.repo[id];
        if (!obj?.features?.length) continue;
        if (isRoadsLayer(obj, id)) continue;

        const geomType = obj.features[0]?.geometry?.type;
        const supported =
          geomType === "Polygon" ||
          geomType === "MultiPolygon" ||
          geomType === "LineString" ||
          geomType === "MultiLineString" ||
          geomType === "Point" ||
          geomType === "MultiPoint";

        if (!supported) continue;

        choices.push({
          sourceType: "repo",
          layerId: id,
          layerName: obj.name || id,
          features: obj.features,
          meta: obj.meta || {},
        });
      }
    }

    // Uploaded layers
    if (mgr?.uploaded) {
      for (const id in mgr.uploaded) {
        const obj = mgr.uploaded[id];
        if (!obj?.features?.length) continue;

        const geomType = obj.features[0]?.geometry?.type;
        const supported =
          geomType === "Polygon" ||
          geomType === "MultiPolygon" ||
          geomType === "LineString" ||
          geomType === "MultiLineString" ||
          geomType === "Point" ||
          geomType === "MultiPoint";

        if (!supported) continue;

        choices.push({
          sourceType: "uploaded",
          layerId: id,
          layerName: obj.name || id,
          features: obj.features,
          meta: obj.meta || {},
        });
      }
    }

    // Drawn shapes (active only)
    const draw = window.DrawShapeManager;
    if (draw?.items) {
      const items = Object.values(draw.items).filter((x) => x?.active && x.geojson?.features?.length);
      for (const it of items) {
        choices.push({
          sourceType: "drawn",
          layerId: it.id,
          layerName: it.name || it.id,
          features: it.geojson.features,
          meta: it.meta || {},
        });
      }
    }

    const order = { repo: 1, uploaded: 2, drawn: 3 };
    choices.sort((a, b) => (order[a.sourceType] || 9) - (order[b.sourceType] || 9));

    return choices;
  }

  function buildBoundaryKey(choice) {
    return `${choice.sourceType}:${choice.layerId}`;
  }

  function featureNameFromProps(f, labelField, fallback = "Feature") {
    if (!f?.properties) return fallback;
    if (labelField && f.properties[labelField] != null) return String(f.properties[labelField]);
    if (f.properties.NAME != null) return String(f.properties.NAME);
    if (f.properties.Name != null) return String(f.properties.Name);
    if (f.properties.name != null) return String(f.properties.name);
    return fallback;
  }

  // ----------------------------------------------------
  // FAST Spatial matcher (precomputes buffers ONCE)
  // ----------------------------------------------------
  function createSpatialMatcher(boundaryFeature, bufferMeters, includeInsidePolygon) {
    if (!boundaryFeature || typeof turf === "undefined") return () => true;

    const bType = boundaryFeature?.geometry?.type;
    const buff = Math.max(0, Number(bufferMeters || 0));

    let bufferGeom = null;
    if (buff > 0) bufferGeom = turf.buffer(boundaryFeature, buff, { units: "meters" });

    if (bType === "Polygon" || bType === "MultiPolygon") {
      return (featurePoint) => {
        if (!featurePoint || featurePoint.geometry?.type !== "Point") return false;

        const coords = featurePoint.geometry.coordinates;
        if (!coords || coords.length < 2) return false;

        const pt = turf.point([coords[0], coords[1]]);
        const inside = turf.booleanPointInPolygon(pt, boundaryFeature);

        if (!bufferGeom) return inside;

        const insideBuff = turf.booleanPointInPolygon(pt, bufferGeom);

        if (includeInsidePolygon) return inside || insideBuff;
        return insideBuff && !inside;
      };
    }

    if (bType === "LineString" || bType === "MultiLineString" || bType === "Point" || bType === "MultiPoint") {
      return (featurePoint) => {
        if (!featurePoint || featurePoint.geometry?.type !== "Point") return false;
        if (!bufferGeom) return false;

        const coords = featurePoint.geometry.coordinates;
        if (!coords || coords.length < 2) return false;

        const pt = turf.point([coords[0], coords[1]]);
        return turf.booleanPointInPolygon(pt, bufferGeom);
      };
    }

    return () => true;
  }

  // ----------------------------------------------------
  // Results modal + FULL PDF export
  // ----------------------------------------------------
  function openResultsModal(datasetName, filterSummary, rows, filterSpec) {
    const overlay = el("div", "ema-results-overlay");
    const modal = el("div", "ema-results-modal");

    modal.innerHTML = `
      <div class="ema-results-header">
        <div class="ema-results-title">
          <div class="t1">${escapeHTML(buildShortTitleFromSpec(datasetName, filterSpec))}</div>
          <div class="t2">${escapeHTML(filterSummary)}</div>
        </div>

        <div class="ema-results-actions">
          <button type="button" class="ema-btn ghost" id="ema-results-download">Download PDF</button>
          <button type="button" class="ema-btn ghost" id="ema-results-close">✕</button>
        </div>
      </div>

      <div class="ema-results-body">
          <div class="ema-results-count">
            <strong>${rows.length}</strong> record(s)
          </div>

          <div class="ema-results-summarybox">
            <div class="ema-results-summarytitle">Filter Summary</div>
            <div class="ema-results-summarytext">${escapeHTML(filterSummary)}</div>
          </div>

        <div class="ema-scroll-controls">
          <button type="button" class="ema-btn ghost" id="ema-scroll-left">◀</button>
          <div class="ema-scroll-hint">Scroll sideways to view all columns</div>
          <button type="button" class="ema-btn ghost" id="ema-scroll-right">▶</button>
        </div>

        <div class="ema-results-tablewrap">
          <table class="ema-results-table" id="ema-results-table">
            <thead></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector("#ema-results-close").addEventListener("click", () => overlay.remove());

    const tableEl = modal.querySelector("#ema-results-table");
    const wrapEl = modal.querySelector(".ema-results-tablewrap");

    const thead = tableEl.querySelector("thead");
    const tbody = tableEl.querySelector("tbody");

    const keys = rows.length ? Object.keys(rows[0] || {}) : [];

    thead.innerHTML = `<tr>${keys.map((k) => `<th>${escapeHTML(k)}</th>`).join("")}</tr>`;

    const maxRowsRender = Math.min(rows.length, 1000);
    tbody.innerHTML = Array.from({ length: maxRowsRender })
      .map((_, i) => {
        const r = rows[i];
        return `<tr>${keys.map((k) => `<td>${escapeHTML(r?.[k])}</td>`).join("")}</tr>`;
      })
      .join("");

    modal.querySelector("#ema-scroll-left").addEventListener("click", () => {
      wrapEl.scrollBy({ left: -400, top: 0, behavior: "smooth" });
    });
    modal.querySelector("#ema-scroll-right").addEventListener("click", () => {
      wrapEl.scrollBy({ left: 400, top: 0, behavior: "smooth" });
    });

    modal.querySelector("#ema-results-download").addEventListener("click", async () => {
      try {
        const jsPDF = window.jspdf?.jsPDF;
        if (!jsPDF) {
          alert("jsPDF not loaded.");
          return;
        }

        const testDoc = new jsPDF();
        if (typeof testDoc.autoTable !== "function") {
          alert("jsPDF AutoTable not loaded. (Check script include in index.html)");
          return;
        }

        const doc = new jsPDF({
          orientation: "landscape",
          unit: "pt",
          format: "a3",
        });

        const pageW = doc.internal.pageSize.getWidth();

        doc.setFontSize(13);
        doc.text(buildShortTitleFromSpec(datasetName, filterSpec), 40, 35);

        doc.setFontSize(9);
        const summaryLines = doc.splitTextToSize(filterSummary || "", pageW - 80);
        doc.text(summaryLines, 40, 55);

        const startY = 70 + summaryLines.length * 10;

        const body = rows.map((r) => keys.map((k) => String(r?.[k] ?? "")));

        const colCount = keys.length;
        const maxFont = 8;
        const minFont = 5;
        const computedFont = Math.max(
          minFont,
          Math.min(maxFont, Math.round((180 / Math.max(colCount, 10)) * 10) / 10)
        );

        doc.autoTable({
          head: [keys],
          body,
          startY,
          theme: "grid",
          tableWidth: "auto",
          styles: {
            fontSize: computedFont,
            cellPadding: 2,
            overflow: "linebreak",
            valign: "top",
            cellWidth: "wrap",
            minCellWidth: 40,
          },
          headStyles: {
            fontSize: computedFont,
            fontStyle: "bold",
          },
          margin: { left: 20, right: 20 },
          horizontalPageBreak: true,
          showHead: "everyPage",
        });

        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.text(`Page ${i} of ${pageCount}`, pageW - 90, doc.internal.pageSize.getHeight() - 20);
        }

        doc.save(`${datasetName}_filter_results.pdf`);
      } catch (e) {
        console.error(e);
        alert("Failed to export PDF. Check console for details.");
      }
    });
  }

  // ----------------------------------------------------
  // CEC Designated Activity fixed list
  // ----------------------------------------------------
  const CEC_DA_VALUES = [
    "N/A", "TBD", "1 (a)", "1 (b)", "2", "3", "4", "5 (a)", "5 (b)", "5 (c)", "6", "7",
    "8 (a)", "8 (b)", "8 (c)", "9", "10 (a)", "10 (b)", "11", "12", "13 (a)", "13 (b)",
    "13 (c)", "14 (a)", "14 (b)", "15", "16", "17", "18 (a)", "18 (b)", "19", "20 (a)",
    "20 (b)", "20 (c)", "20 (d)", "21", "22", "23", "24", "25", "26 (a)", "26 (b)",
    "27", "28", "29", "30", "31 (a)", "31 (b)", "32", "33 (a)", "33 (b)", "34", "35",
    "36", "37", "38 (a)", "38 (b)", "38 (c)", "39", "40 (a)", "40 (b)", "41 (a)",
    "41 (b)", "41 (c)", "42", "43 (a)", "43 (b)", "43 (c)", "43 (d)", "44 (a)", "44 (b)"
  ];

  function findDesignatedActivityField(rows) {
    if (!rows?.length) return null;
    const keys = Object.keys(rows[0] || {});
    const match = keys.find((k) => String(k).toLowerCase().includes("designated activity"));
    if (match) return match;

    const alt = keys.find((k) => {
      const n = String(k).toLowerCase();
      return n.includes("designated") && n.includes("activity");
    });
    return alt || null;
  }

  function parseDATokens(cellValue) {
    return String(cellValue || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  // ----------------------------------------------------
  // Filters Panel Builder
  // ----------------------------------------------------
  function buildFiltersPanel(appManager) {
    const root = document.getElementById("filters-root");
    if (!root) return;

    root.innerHTML = "";
    root.appendChild(
      el(
        "div",
        "filters-help",
        `<div><strong>Dataset Filters</strong></div>
         <div>Filters show ONLY for datasets toggled <b>ON</b>.</div>`
      )
    );

    const datasets = appManager.getAllDatasets().filter((ds) => ds.active && ds.loaded && ds.cluster);

    if (!datasets.length) {
      root.appendChild(
        el("div", "filters-empty", `No active datasets.<br/>Turn ON a dataset in <strong>Application Data</strong>.`)
      );
      return;
    }

    for (const ds of datasets) {
      const cfg = ds.config;
      const rows = ds.rows || [];
      const state = getState(cfg.id);

      const dateFields = detectDateFields(rows);
      const textFields = buildSearchableTextFields(rows, dateFields, [cfg.eastingField, cfg.northingField]);

      const statusFields = buildStatusFieldList(rows);

      const yearField = findYearField(rows);
      const yearOptions = yearField ? uniqueYears(rows, yearField) : [];

      // Persist defaults
      state.yearSelected = new Set(state.yearSelected || []);

      // Reference field
      const possibleRefFields = Object.keys(rows[0] || {}).filter((k) => {
        const n = String(k).toLowerCase();
        if (n.includes("applicant")) return false;

        const isRef =
          n.includes("ref") ||
          n.includes("reference") ||
          n.includes("file no") ||
          n.includes("file number") ||
          n.includes("application no") ||
          n.includes("application number");

        return isRef;
      });

      // Noise Applications dataset: reference-only
      if (cfg.id === "noise_emitter_register") {
        const onlyReference = possibleRefFields.filter((k) => String(k).toLowerCase().includes("reference"));
        const exactRefNo = onlyReference.find((k) => String(k).toLowerCase().includes("reference no"));
        if (exactRefNo) {
          possibleRefFields.length = 0;
          possibleRefFields.push(exactRefNo);
        } else if (onlyReference.length) {
          possibleRefFields.length = 0;
          possibleRefFields.push(...onlyReference);
        }
      }

      const daField = cfg.id === "cec_applications" ? findDesignatedActivityField(rows) : null;

      // Persist defaults
      state.open = state.open !== false;

      state.refField = state.refField ?? possibleRefFields[0] ?? "";
      state.refQuery = state.refQuery ?? "";

      // Proximity defaults
      state.nearbyRef = state.nearbyRef ?? "";
      state.nearbyRadius = Number.isFinite(state.nearbyRadius) ? state.nearbyRadius : 1000;
      state.nearbyDays = Number.isFinite(state.nearbyDays) ? state.nearbyDays : 14;
      state.nearbyDateField = state.nearbyDateField ?? ""; // ✅ NEW

      // Date range defaults
      state.dateField = state.dateField ?? dateFields[0] ?? "";
      state.dateFrom = state.dateFrom ?? "";
      state.dateTo = state.dateTo ?? "";

      state.kwMode = state.kwMode ?? "all";
      state.keywords = state.keywords ?? "";

      state.statusField = state.statusField ?? (statusFields[0] ?? "");
      state.statusSelected = new Set(state.statusSelected || []);

      state.daSelected = new Set(state.daSelected || []);

      state.spatialEnabled = !!state.spatialEnabled;
      state.spatialBoundaryKey = state.spatialBoundaryKey ?? "";
      state.spatialFeatureIndex = Number.isFinite(state.spatialFeatureIndex) ? state.spatialFeatureIndex : 0;
      state.bufferMeters = Number.isFinite(state.bufferMeters) ? state.bufferMeters : 0;
      state.bufferMode = state.bufferMode ?? "union";

      // Build details
      const details = document.createElement("details");
      details.className = "filter-dataset-details";
      details.open = state.open;

      const summary = document.createElement("summary");
      summary.className = "filter-dataset-summary";
      summary.innerHTML = `
        <div class="name">${escapeHTML(cfg.name)}</div>
        <div class="meta">${ds.isFiltered ? "Filtered" : "All records"}</div>
      `;
      details.appendChild(summary);

      summary.addEventListener("click", () => {
        setTimeout(() => (state.open = details.open), 0);
      });

      const card = el("div", "filter-dataset-card");
      details.appendChild(card);
      root.appendChild(details);

      card.innerHTML = `
        <div class="filter-block">

          <div class="filter-subtitle">Quick Search (Reference / ID)</div>

          <div class="filter-row">
            <label>Reference Field</label>
            <select class="ref-field"></select>
          </div>

          <div class="filter-row">
            <label>Find Entry</label>
            <input class="ref-search" type="text" placeholder="Enter reference number..." />
            <button class="ema-btn ghost ref-find-btn" type="button">Find</button>
          </div>

          <hr class="filter-divider" />

          <div class="filter-subtitle">Year</div>

          <div class="filter-row">
            <label>Year Value(s)</label>
            <div class="year-values"></div>
          </div>

          <hr class="filter-divider" />

          <div class="filter-subtitle">Date Range</div>

          <div class="filter-row">
            <label>Date Field</label>
            <select class="date-field"></select>
          </div>

          <div class="filter-row">
            <label>From</label>
            <input class="date-from" type="date" />
          </div>

          <div class="filter-row">
            <label>To</label>
            <input class="date-to" type="date" />
          </div>

          <hr class="filter-divider" />

          <div class="filter-subtitle">Determination / Status</div>

          <div class="filter-row">
            <label>Status Field</label>
            <select class="status-field"></select>
          </div>

          <div class="filter-row">
            <label>Status Value(s)</label>
            <div class="status-values"></div>
          </div>

          ${
            cfg.id === "cec_applications"
              ? `
          <hr class="filter-divider" />
          <div class="filter-subtitle">Designated Activity (CEC Applications)</div>
          <div class="filter-row">
            <label>Activity Value(s)</label>
            <div class="da-values"></div>
          </div>
          `
              : ""
          }

          <hr class="filter-divider" />

          <div class="filter-subtitle">Keyword Search</div>

          <div class="filter-row">
            <label>Keywords</label>
            <input class="kw-input" type="text" placeholder="e.g. fete music speaker" />
          </div>

          <div class="filter-row">
            <label>Match Mode</label>
            <div class="inline-radio">
              <label><input type="radio" name="kwmode_${cfg.id}" value="all" /> ALL keywords</label>
              <label><input type="radio" name="kwmode_${cfg.id}" value="any" /> ANY keyword</label>
            </div>
          </div>

          <hr class="filter-divider" />

          <div class="filter-subtitle">Proximity Events</div>

          <div class="filter-row">
            <label>Reference No. of Interest</label>
            <input class="nearby-ref" type="text" placeholder="e.g. 8715 or VR8715" />
          </div>

          <div class="filter-row">
            <label>Radius (metres)</label>
            <input class="nearby-radius" type="number" min="0" step="50" placeholder="e.g. 1000" />
          </div>

          <div class="filter-row">
            <label>Period (± days)</label>
            <input class="nearby-days" type="number" min="0" step="1" placeholder="e.g. 14" />
          </div>

          <div class="filter-row">
            <label>Proximity Date Field</label>
            <select class="nearby-date-field"></select>
          </div>

          <div class="filters-note">
            Finds applications within the radius AND within ± days of the selected reference application's date(s).
          </div>

          <hr class="filter-divider" />

          <div class="filter-subtitle">Spatial Filter</div>

          <div class="filter-row">
            <label>Enable</label>
            <label class="toggle-switch">
              <input class="spatial-enable" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="filter-row">
            <label>Boundary Source</label>
            <select class="spatial-boundary"></select>
          </div>

          <div class="filter-row spatial-feature-row">
            <label>Boundary Feature (multi-polygons)</label>
            <select class="spatial-feature"></select>
          </div>

          <div class="filter-row">
            <label>Buffer (metres)</label>
            <input class="spatial-buffer" type="number" min="0" step="10" />
          </div>

          <div class="filter-row spatial-mode-row">
            <label>Parameter</label>
            <div class="inline-radio">
              <label><input type="radio" name="bufmode_${cfg.id}" value="union" /> Buffer and Inside</label>
              <label><input type="radio" name="bufmode_${cfg.id}" value="ring" /> Buffer ONLY</label>
            </div>
          </div>

          <hr class="filter-divider" />

          <div class="filter-actions">
            <button class="ema-btn primary apply-btn" type="button">Apply Filter</button>
            <button class="ema-btn ghost clear-btn" type="button">Clear</button>
            <button class="ema-btn ghost results-btn" type="button">Show Results</button>
          </div>

          <div class="filter-status">
            <span class="status-text"></span>
          </div>

        </div>
      `;

      // UI refs
      const refFieldSel = card.querySelector(".ref-field");
      const refSearch = card.querySelector(".ref-search");
      const refFindBtn = card.querySelector(".ref-find-btn");

      const yearValuesWrap = card.querySelector(".year-values");

      const dateFieldSel = card.querySelector(".date-field");
      const dateFrom = card.querySelector(".date-from");
      const dateTo = card.querySelector(".date-to");

      const statusFieldSel = card.querySelector(".status-field");
      const statusValuesWrap = card.querySelector(".status-values");
      const daValuesWrap = card.querySelector(".da-values");

      const kwInput = card.querySelector(".kw-input");
      const kwAll = card.querySelector(`input[name="kwmode_${cfg.id}"][value="all"]`);
      const kwAny = card.querySelector(`input[name="kwmode_${cfg.id}"][value="any"]`);

      const nearbyRefInput = card.querySelector(".nearby-ref");
      const nearbyRadiusInput = card.querySelector(".nearby-radius");
      const nearbyDaysInput = card.querySelector(".nearby-days");
      const nearbyDateFieldSel = card.querySelector(".nearby-date-field");

      const spatialEnable = card.querySelector(".spatial-enable");
      const spatialBoundarySel = card.querySelector(".spatial-boundary");
      const spatialFeatureRow = card.querySelector(".spatial-feature-row");
      const spatialFeatureSel = card.querySelector(".spatial-feature");
      const spatialBuffer = card.querySelector(".spatial-buffer");
      const spatialModeRow = card.querySelector(".spatial-mode-row");

      const applyBtn = card.querySelector(".apply-btn");
      const clearBtn = card.querySelector(".clear-btn");
      const resultsBtn = card.querySelector(".results-btn");
      const statusText = card.querySelector(".status-text");

      // Year checklist
      function refreshYearChecklist() {
        if (!yearValuesWrap) return;
        yearValuesWrap.innerHTML = "";

        if (!yearField || !yearOptions.length) {
          yearValuesWrap.innerHTML = `<div class="filters-empty">(No Year column found)</div>`;
          state.yearSelected = new Set();
          return;
        }

        const selected = new Set(state.yearSelected || []);
        createChecklist(yearValuesWrap, yearOptions, selected, (arr) => {
          state.yearSelected = new Set(arr);
        });
      }
      refreshYearChecklist();

      // Populate reference fields
      refFieldSel.innerHTML =
        `<option value="">(select field)</option>` +
        possibleRefFields.map((f) => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join("");
      refFieldSel.value = state.refField;
      refSearch.value = state.refQuery;

      refFieldSel.addEventListener("change", () => (state.refField = refFieldSel.value));
      refSearch.addEventListener("input", () => (state.refQuery = refSearch.value));

      // Find entry (supports VR8806 or 8806)
      refFindBtn.addEventListener("click", () => {
        const refField = refFieldSel.value;
        const query = String(refSearch.value || "").trim();
        if (!refField || !query) {
          alert("Select a Reference Field and enter a value to search.");
          return;
        }

        const target = ds.markers.find((m) => {
          const row = m.__appdataRow || {};
          return isRefMatch(row?.[refField], query);
        });

        if (!target) {
          alert("No matching entry found.");
          return;
        }

        const ll = target.getLatLng();
        if (ll) {
          map.setView(ll, 16, { animate: true });
          target.openPopup();
        }
      });

      // Date fields (multi-date capable)
      dateFieldSel.innerHTML =
        `<option value="">(no date filter)</option>` +
        dateFields.map((f) => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join("");
      dateFieldSel.value = state.dateField || "";

      dateFrom.value = state.dateFrom || "";
      dateTo.value = state.dateTo || "";

      dateFieldSel.addEventListener("change", () => (state.dateField = dateFieldSel.value));
      dateFrom.addEventListener("change", () => (state.dateFrom = dateFrom.value));
      dateTo.addEventListener("change", () => (state.dateTo = dateTo.value));

      // Proximity date field selector
      nearbyDateFieldSel.innerHTML =
        `<option value="">(select date field)</option>` +
        dateFields.map((f) => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join("");
      nearbyDateFieldSel.value = state.nearbyDateField || "";

      nearbyRefInput.value = state.nearbyRef || "";
      nearbyRadiusInput.value = String(state.nearbyRadius ?? 1000);
      nearbyDaysInput.value = String(state.nearbyDays ?? 14);

      nearbyRefInput.addEventListener("input", () => (state.nearbyRef = nearbyRefInput.value));
      nearbyRadiusInput.addEventListener("input", () => (state.nearbyRadius = Number(nearbyRadiusInput.value || 0)));
      nearbyDaysInput.addEventListener("input", () => (state.nearbyDays = Number(nearbyDaysInput.value || 0)));
      nearbyDateFieldSel.addEventListener("change", () => (state.nearbyDateField = nearbyDateFieldSel.value));

      // Status fields
      statusFieldSel.innerHTML =
        `<option value="">(no status filter)</option>` +
        statusFields.map((f) => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join("");
      statusFieldSel.value = state.statusField || "";

      function refreshStatusChecklist() {
        statusValuesWrap.innerHTML = "";
        const field = statusFieldSel.value;
        state.statusField = field;

        if (!field) {
          state.statusSelected = new Set();
          return;
        }

        const values = uniqueValues(rows, field, 250).sort((a, b) => a.localeCompare(b));
        const selected = new Set(state.statusSelected || []);
        createChecklist(statusValuesWrap, values, selected, (arr) => {
          state.statusSelected = new Set(arr);
        });
      }

      statusFieldSel.addEventListener("change", refreshStatusChecklist);
      refreshStatusChecklist();

      // CEC Designated Activity fixed list
      if (cfg.id === "cec_applications" && daValuesWrap) {
        daValuesWrap.innerHTML = "";
        const selected = new Set(state.daSelected || []);
        createChecklist(daValuesWrap, CEC_DA_VALUES, selected, (arr) => {
          state.daSelected = new Set(arr);
        });
      }

      // Keywords
      kwInput.value = state.keywords || "";
      kwAll.checked = state.kwMode === "all";
      kwAny.checked = state.kwMode === "any";

      kwInput.addEventListener("input", () => (state.keywords = kwInput.value));
      kwAll.addEventListener("change", () => (state.kwMode = "all"));
      kwAny.addEventListener("change", () => (state.kwMode = "any"));

      // Spatial dropdowns
      function refreshSpatialDropdowns() {
        const choices = listBoundarySources();

        spatialBoundarySel.innerHTML =
          `<option value="">(none)</option>` +
          choices
            .map((c) => {
              const label =
                c.sourceType === "repo"
                  ? `Repo: ${c.layerName}`
                  : c.sourceType === "uploaded"
                  ? `Upload: ${c.layerName}`
                  : `Drawn: ${c.layerName}`;
              const key = buildBoundaryKey(c);
              return `<option value="${escapeHTML(key)}">${escapeHTML(label)}</option>`;
            })
            .join("");

        spatialBoundarySel.value = state.spatialBoundaryKey || "";

        spatialFeatureSel.innerHTML = `<option value="0">(default)</option>`;
        spatialFeatureRow.style.display = "none";

        const selectedKey = spatialBoundarySel.value;
        const choice = choices.find((c) => buildBoundaryKey(c) === selectedKey);
        if (!choice || !choice.features?.length) return;

        const geomType = choice.features[0]?.geometry?.type;
        const isPolygon = geomType === "Polygon" || geomType === "MultiPolygon";
        const isMultiFeature = choice.features.length > 1;

        const labelField = choice.meta?.labelField || null;

        if (isPolygon && isMultiFeature) {
          spatialFeatureRow.style.display = "";
          spatialFeatureSel.innerHTML =
            `<option value="0">(select feature)</option>` +
            choice.features
              .map((f, idx) => {
                const nm = featureNameFromProps(f, labelField, `Feature ${idx + 1}`);
                return `<option value="${idx}">${escapeHTML(nm)}</option>`;
              })
              .join("");
          spatialFeatureSel.value = String(state.spatialFeatureIndex || 0);
        } else {
          spatialFeatureRow.style.display = "none";
          state.spatialFeatureIndex = 0;
        }

        spatialModeRow.style.display = isPolygon ? "" : "none";
      }

      spatialEnable.checked = !!state.spatialEnabled;
      spatialBuffer.value = String(state.bufferMeters || 0);

      const bufUnion = card.querySelector(`input[name="bufmode_${cfg.id}"][value="union"]`);
      const bufRing = card.querySelector(`input[name="bufmode_${cfg.id}"][value="ring"]`);
      bufUnion.checked = state.bufferMode === "union";
      bufRing.checked = state.bufferMode === "ring";

      function setSpatialEnabledUI(on) {
        spatialBoundarySel.disabled = !on;
        spatialFeatureSel.disabled = !on;
        spatialBuffer.disabled = !on;
      }
      setSpatialEnabledUI(state.spatialEnabled);

      spatialEnable.addEventListener("change", () => {
        state.spatialEnabled = spatialEnable.checked;
        setSpatialEnabledUI(state.spatialEnabled);
      });

      spatialBoundarySel.addEventListener("change", () => {
        state.spatialBoundaryKey = spatialBoundarySel.value;
        refreshSpatialDropdowns();
      });

      spatialFeatureSel.addEventListener("change", () => {
        state.spatialFeatureIndex = Number(spatialFeatureSel.value || 0);
      });

      spatialBuffer.addEventListener("input", () => {
        state.bufferMeters = Number(spatialBuffer.value || 0);
      });

      bufUnion.addEventListener("change", () => (state.bufferMode = "union"));
      bufRing.addEventListener("change", () => (state.bufferMode = "ring"));

      refreshSpatialDropdowns();

      // Status line
      function updateStatusLine() {
        const showing = ds.isFiltered ? ds.filteredMarkers.length : ds.markers.length;
        statusText.innerHTML = `Showing: <strong>${showing}</strong> / ${ds.markers.length}`;
        summary.querySelector(".meta").textContent = ds.isFiltered ? "Filtered" : "All records";
      }
      updateStatusLine();

      // Apply Filter (AND logic)
      applyBtn.addEventListener("click", () => {
        const keywords = normalizeKeywordList(state.keywords || "");
        const statusSelected = Array.from(state.statusSelected || []);
        const daSelected = Array.from(state.daSelected || []);

        // Spatial boundary feature
        let boundaryFeature = null;
        if (state.spatialEnabled && state.spatialBoundaryKey) {
          const choices = listBoundarySources();
          const choice = choices.find((c) => buildBoundaryKey(c) === state.spatialBoundaryKey);
          if (choice?.features?.length) {
            boundaryFeature = choice.features[state.spatialFeatureIndex || 0] || choice.features[0];
          }
        }

        const spatialMatcher =
          state.spatialEnabled && boundaryFeature
            ? createSpatialMatcher(boundaryFeature, state.bufferMeters, state.bufferMode === "union")
            : () => true;

        const filterSpec = {
          datasetId: cfg.id,
          datasetName: cfg.name,

          year: {
            field: yearField,
            selected: Array.from(state.yearSelected || []),
          },

          dateField: state.dateField || null,
          dateFrom: state.dateFrom || null,
          dateTo: state.dateTo || null,

          statusField: state.statusField || null,
          statusSelected,

          keywords: { list: keywords, mode: state.kwMode || "all" },

          nearby: {
            enabled: !!(state.nearbyRef && String(state.nearbyRef).trim()),
            refQuery: String(state.nearbyRef || "").trim(),
            radiusMeters: Number(state.nearbyRadius || 0),
            daysWindow: Number(state.nearbyDays || 0),
            refField: state.refField || (possibleRefFields[0] ?? null),
            dateField: state.nearbyDateField || null, // ✅ NEW
          },

          spatial: {
            enabled: !!state.spatialEnabled,
            boundaryKey: state.spatialBoundaryKey,
            boundaryFeatureIndex: state.spatialFeatureIndex,
            bufferMeters: Number(state.bufferMeters || 0),
            mode: state.bufferMode,
          },

          designatedActivity:
            cfg.id === "cec_applications"
              ? {
                  field: daField,
                  selected: daSelected,
                }
              : null,
        };

        // ----------------------------------------------------
        // Proximity matcher (precomputed ONCE)
        // ----------------------------------------------------
        let nearbyMatcher = () => true;

        if (filterSpec.nearby?.enabled) {
          const refField = filterSpec.nearby.refField;
          const refQuery = filterSpec.nearby.refQuery;
          const radius = Math.max(0, Number(filterSpec.nearby.radiusMeters || 0));
          const days = Math.max(0, Number(filterSpec.nearby.daysWindow || 0));
          const dateField = filterSpec.nearby.dateField;

          if (!refField) {
            alert("Proximity Events: No Reference field is available for this dataset.");
            return;
          }
          if (!radius || !days) {
            alert("Proximity Events: Radius and Days must be greater than 0.");
            return;
          }
          if (!dateField) {
            alert("Proximity Events: Select the Proximity Date Field.");
            return;
          }

          // Find the reference marker
          const refMarker = ds.markers.find((m) => {
            const r = m.__appdataRow || {};
            return isRefMatch(r?.[refField], refQuery);
          });

          if (!refMarker) {
            alert(`Proximity Events: Could not find an application with Reference "${refQuery}".`);
            return;
          }

          const refLatLng = refMarker.getLatLng();
          const refRow = refMarker.__appdataRow || {};
          const refDates = extractAllDatesFromCell(refRow?.[dateField]);

          if (!refLatLng) {
            alert("Proximity Events: Reference application location is missing.");
            return;
          }
          if (!refDates.length) {
            alert(`Proximity Events: Reference application has no valid date(s) in "${dateField}".`);
            return;
          }

          const refDigits = extractDigits(refRow?.[refField]);
          const dayMs = 24 * 60 * 60 * 1000;
          const windowMs = days * dayMs;

          nearbyMatcher = (row, featurePoint) => {
            if (!featurePoint || featurePoint.geometry?.type !== "Point") return false;

            // Exclude the reference application itself
            const rowDigits = extractDigits(row?.[refField]);
            if (rowDigits && refDigits && rowDigits === refDigits) return false;

            const coords = featurePoint.geometry.coordinates;
            if (!coords || coords.length < 2) return false;

            // Distance check
            const ptLL = L.latLng(coords[1], coords[0]);
            const dist = map.distance(ptLL, refLatLng);
            if (dist > radius) return false;

            // Date window check (supports multiple dates in cell)
            const rowDates = extractAllDatesFromCell(row?.[dateField]);
            if (!rowDates.length) return false;

            // Pass if ANY row date is within ±days of ANY ref date
            for (const rd of rowDates) {
              for (const refd of refDates) {
                if (Math.abs(rd - refd) <= windowMs) return true;
              }
            }

            return false;
          };
        }

        // ----------------------------------------------------
        // Record predicate (AND logic)
        // ----------------------------------------------------
        function predicate(row, featurePoint) {
          // Year filter
          if (filterSpec.year?.field && filterSpec.year?.selected?.length) {
            const y = String(row?.[filterSpec.year.field] ?? "").trim();
            if (!filterSpec.year.selected.includes(y)) return false;
          }

          // Proximity filter
          if (!nearbyMatcher(row, featurePoint)) return false;

          // Date range filter (supports multiple dates)
          if (filterSpec.dateField && (filterSpec.dateFrom || filterSpec.dateTo)) {
            const dates = extractAllDatesFromCell(row?.[filterSpec.dateField]);
            if (!dates.length) return false;

            let fromTs = null;
            let toTs = null;

            if (filterSpec.dateFrom) {
              const p = Date.parse(filterSpec.dateFrom);
              if (Number.isFinite(p)) fromTs = p;
            }
            if (filterSpec.dateTo) {
              const p = Date.parse(filterSpec.dateTo);
              if (Number.isFinite(p)) toTs = p + 24 * 60 * 60 * 1000 - 1;
            }

            // Pass if ANY date in the cell lies within range
            const ok = dates.some((ts) => {
              if (fromTs != null && ts < fromTs) return false;
              if (toTs != null && ts > toTs) return false;
              return true;
            });

            if (!ok) return false;
          }

          // Status filter
          if (filterSpec.statusField && filterSpec.statusSelected.length) {
            const v = String(row?.[filterSpec.statusField] ?? "").trim();
            if (!filterSpec.statusSelected.includes(v)) return false;
          }

          // Designated Activity filter (CEC)
          if (filterSpec.designatedActivity?.field && filterSpec.designatedActivity.selected?.length) {
            const cell = String(row?.[filterSpec.designatedActivity.field] ?? "");
            const tokens = parseDATokens(cell);
            const wanted = new Set(filterSpec.designatedActivity.selected);
            const hit = tokens.some((t) => wanted.has(t));
            if (!hit) return false;
          }

          // Keywords
          if (filterSpec.keywords.list.length) {
            const blob = textFields.map((f) => String(row?.[f] ?? "").toLowerCase()).join(" ");
            const tests = filterSpec.keywords.list.map((kw) => blob.includes(String(kw).toLowerCase()));
            if (filterSpec.keywords.mode === "all") {
              if (!tests.every(Boolean)) return false;
            } else {
              if (!tests.some(Boolean)) return false;
            }
          }

          // Spatial
          if (!spatialMatcher(featurePoint)) return false;

          return true;
        }

        appManager.applyDatasetFilter(cfg.id, filterSpec, predicate);
        state.lastFilterSpec = filterSpec;
        updateStatusLine();
      });

      // Clear filter + reset UI state
      clearBtn.addEventListener("click", () => {
        appManager.clearDatasetFilter(cfg.id);

        state.yearSelected = new Set();

        state.dateFrom = "";
        state.dateTo = "";
        state.dateField = dateFields[0] ?? "";

        state.keywords = "";
        state.kwMode = "all";

        state.statusSelected = new Set();

        state.spatialEnabled = false;
        state.spatialBoundaryKey = "";
        state.spatialFeatureIndex = 0;
        state.bufferMeters = 0;
        state.bufferMode = "union";

        state.refQuery = "";

        // Proximity reset
        state.nearbyRef = "";
        state.nearbyRadius = 1000;
        state.nearbyDays = 14;
        state.nearbyDateField = "";

        if (cfg.id === "cec_applications") {
          state.daSelected = new Set();
        }

        buildFiltersPanel(appManager);
      });

      // Results modal
      resultsBtn.addEventListener("click", () => {
        const visibleRows = appManager.getDatasetVisibleRows(cfg.id);
        const spec = state.lastFilterSpec || null;
        const summaryText = buildFilterSummaryText(spec);
        openResultsModal(cfg.name, summaryText, visibleRows, spec);
      });
    }
  }

  // ----------------------------------------------------
  // Init
  // ----------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.AppDataManager) return;

    buildFiltersPanel(window.AppDataManager);

    document.addEventListener("appdata:datasetActiveChanged", () => {
      buildFiltersPanel(window.AppDataManager);
    });

    document.addEventListener("layers:repoPreloaded", () => {
      buildFiltersPanel(window.AppDataManager);
    });

    console.log("✅ Filters panel initialized (multi-date support + proximity date selector).");
  });
})();
