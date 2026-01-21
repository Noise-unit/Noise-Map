// scripts/drawTools.js
// ----------------------------------------------------
// Draw Tools Panel
// - Draw: polygon, polyline, marker, rectangle, circle
// - Edit mode: move + reshape
// - Cancel edits: revert to original geometry
// - List of user drawn shapes (toggle, opacity, style click, delete X)
// - Clear all
// - Download: GeoJSON or Shapefile ZIP
// ----------------------------------------------------
console.log("✅ drawTools.js loaded");

(function () {
  // ----------------------------------------------------
  // Guards
  // ----------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof map === "undefined" || !map) {
      console.warn("❌ drawTools.js: map not found. Ensure main.js loads first.");
      return;
    }

    if (typeof L === "undefined") {
      console.warn("❌ drawTools.js: Leaflet not found.");
      return;
    }

    if (typeof L.Draw === "undefined") {
      console.warn("❌ drawTools.js: Leaflet.draw not found. Ensure leaflet.draw.js is loaded.");
      return;
    }

    const root = document.getElementById("drawtools-root");
    if (!root) {
      console.warn("❌ drawTools.js: #drawtools-root not found in HTML.");
      return;
    }

    // ----------------------------------------------------
    // Draw Shape Manager (separate from UserLayerManager)
    // ----------------------------------------------------
    window.DrawShapeManager = window.DrawShapeManager || {
      items: {}, // id -> { id, name, layer, geojson, active, opacity, meta }
      getAllActiveFeatures() {
        const out = [];
        for (const id in this.items) {
          const d = this.items[id];
          if (d?.active && d.geojson?.features?.length) {
            out.push(...d.geojson.features);
          }
        }
        return out;
      },
    };

    function uid(prefix = "draw") {
      return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    }

    function escapeHTML(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // ----------------------------------------------------
    // UI helpers
    // ----------------------------------------------------
    function el(tag, className, html) {
      const d = document.createElement(tag);
      if (className) d.className = className;
      if (html !== undefined) d.innerHTML = html;
      return d;
    }

    function countUntitled() {
      const names = Object.values(window.DrawShapeManager.items).map((x) => x?.name || "");
      return names.filter((n) => /^Untitled\s+\d+$/i.test(n)).length;
    }

    function defaultNameIfBlank(name) {
      const cleaned = String(name ?? "").trim();
      if (cleaned) return cleaned;
      return `Untitled ${countUntitled() + 1}`;
    }

    function getShapeUiType(item) {
      const t = String(item?.meta?.shapeType || "").toLowerCase();
      if (t === "polyline" || t === "line") return "line";
      if (t === "marker" || t === "point") return "point";
      return "polygon"; // polygon/rectangle/circle
    }

    // ----------------------------------------------------
    // Modal prompt (name dialog)
    // ----------------------------------------------------
    function askForNameDialog(defaultValue = "") {
      return new Promise((resolve) => {
        const overlay = el("div", "ema-modal-overlay");
        const modal = el("div", "ema-modal");

        modal.innerHTML = `
          <div class="ema-modal-title">Name your shape</div>
          <div class="ema-modal-body">
            <input id="ema-shape-name-input" class="ema-modal-input" type="text" placeholder="Enter a name..." />
          </div>
          <div class="ema-modal-actions">
            <button type="button" class="ema-btn ghost" id="ema-name-cancel">Cancel</button>
            <button type="button" class="ema-btn primary" id="ema-name-save">Save</button>
          </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const input = modal.querySelector("#ema-shape-name-input");
        const cancelBtn = modal.querySelector("#ema-name-cancel");
        const saveBtn = modal.querySelector("#ema-name-save");

        input.value = defaultValue || "";
        input.focus();

        function cleanup(val) {
          document.body.removeChild(overlay);
          resolve(val);
        }

        cancelBtn.addEventListener("click", () => cleanup(""));
        saveBtn.addEventListener("click", () => cleanup(input.value));

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") cleanup(input.value);
          if (e.key === "Escape") cleanup("");
        });
      });
    }

    // ----------------------------------------------------
    // Style + Rename modal (geometry aware)
    // - Polygons/Rect/Circle: name + stroke + fill + transparent fill
    // - Lines: name + stroke (no fill)
    // - Points: name + point color
    // ----------------------------------------------------
    function askForShapeOptionsDialog(item) {
      return new Promise((resolve) => {
        const uiType = getShapeUiType(item);
        const currentStyle = item?.meta?.style || {};

        const curName = item?.name || "";
        const stroke = currentStyle.stroke || "#2563eb";
        const fill = currentStyle.fill || "#2563eb";
        const weight = Number.isFinite(currentStyle.weight) ? currentStyle.weight : 2;
        const transparentFill = !!currentStyle.transparentFill;

        // For points we use "pointColor" but we store it as stroke/fill anyway
        const pointColor = currentStyle.pointColor || stroke || "#2563eb";

        const overlay = el("div", "ema-modal-overlay");
        const modal = el("div", "ema-modal");

        let bodyHTML = `
          <div class="ema-modal-title">Shape options</div>
          <div class="ema-modal-body">
            <div class="ema-style-grid">
              <label>Name</label>
              <input id="ema-opt-name" class="ema-modal-input" type="text" value="${escapeHTML(curName)}" />
        `;

        if (uiType === "polygon") {
          bodyHTML += `
              <label>Stroke</label>
              <input id="ema-opt-stroke" type="color" value="${escapeHTML(stroke)}" />

              <label>Fill</label>
              <input id="ema-opt-fill" type="color" value="${escapeHTML(fill)}" />

              <label style="display:flex;align-items:center;gap:8px;">Transparent fill</label>
              <input id="ema-opt-tf" type="checkbox" ${transparentFill ? "checked" : ""} />

              <label>Line width</label>
              <input id="ema-opt-weight" type="number" min="1" max="10" step="1" value="${escapeHTML(weight)}" />
          `;
        } else if (uiType === "line") {
          bodyHTML += `
              <label>Stroke</label>
              <input id="ema-opt-stroke" type="color" value="${escapeHTML(stroke)}" />

              <label>Line width</label>
              <input id="ema-opt-weight" type="number" min="1" max="10" step="1" value="${escapeHTML(weight)}" />
          `;
        } else {
          // point
          bodyHTML += `
              <label>Point color</label>
              <input id="ema-opt-point" type="color" value="${escapeHTML(pointColor)}" />
          `;
        }

        bodyHTML += `
            </div>
          </div>
          <div class="ema-modal-actions">
            <button type="button" class="ema-btn ghost" id="ema-opt-cancel">Cancel</button>
            <button type="button" class="ema-btn primary" id="ema-opt-save">Apply</button>
          </div>
        `;

        modal.innerHTML = bodyHTML;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const cancelBtn = modal.querySelector("#ema-opt-cancel");
        const saveBtn = modal.querySelector("#ema-opt-save");

        const nameInput = modal.querySelector("#ema-opt-name");

        function cleanup(val) {
          document.body.removeChild(overlay);
          resolve(val);
        }

        cancelBtn.addEventListener("click", () => cleanup(null));

        saveBtn.addEventListener("click", () => {
          const newNameRaw = nameInput?.value || "";
          const newName = defaultNameIfBlank(newNameRaw);

          if (uiType === "polygon") {
            const strokeVal = modal.querySelector("#ema-opt-stroke")?.value || "#2563eb";
            const fillVal = modal.querySelector("#ema-opt-fill")?.value || "#2563eb";
            const tfVal = !!modal.querySelector("#ema-opt-tf")?.checked;
            const weightVal = parseInt(modal.querySelector("#ema-opt-weight")?.value || "2", 10);

            cleanup({
              name: newName,
              style: {
                stroke: strokeVal,
                fill: fillVal,
                weight: Number.isFinite(weightVal) ? weightVal : 2,
                transparentFill: tfVal,
              },
            });
            return;
          }

          if (uiType === "line") {
            const strokeVal = modal.querySelector("#ema-opt-stroke")?.value || "#2563eb";
            const weightVal = parseInt(modal.querySelector("#ema-opt-weight")?.value || "2", 10);

            cleanup({
              name: newName,
              style: {
                stroke: strokeVal,
                weight: Number.isFinite(weightVal) ? weightVal : 2,
              },
            });
            return;
          }

          // point
          const pointVal = modal.querySelector("#ema-opt-point")?.value || "#2563eb";

          cleanup({
            name: newName,
            style: {
              pointColor: pointVal,
            },
          });
        });

        nameInput?.addEventListener("keydown", (e) => {
          if (e.key === "Escape") cleanup(null);
        });
      });
    }

    // ----------------------------------------------------
    // Leaflet FeatureGroup to hold drawn layers
    // ----------------------------------------------------
    const drawnItems = new L.FeatureGroup();
    drawnItems.addTo(map);

    // ----------------------------------------------------
    // Convert Leaflet layer -> GeoJSON FeatureCollection
    // ----------------------------------------------------
    function layerToFeatureCollection(layer, name, shapeType = "drawn") {
      const gj = layer.toGeoJSON();
      const fc =
        gj.type === "FeatureCollection"
          ? gj
          : { type: "FeatureCollection", features: [gj] };

      fc.features = (fc.features || []).map((f) => {
        f.properties = f.properties || {};
        f.properties.__drawn_name = name;
        f.properties.__drawn_type = shapeType;

        // Circle special case: Leaflet circle becomes Point in GeoJSON
        if (layer instanceof L.Circle) {
          f.properties.__circle_radius_m = layer.getRadius();
        }

        return f;
      });

      return fc;
    }

    // ----------------------------------------------------
    // Apply opacity (transparentFill supported)
    // ----------------------------------------------------
    function applyOpacity(layer, opacity) {
      const val = Math.max(0, Math.min(1, Number(opacity)));

      // Vector layers (polygon/line/circleMarker)
      if (layer.setStyle) {
        const tf = !!layer.__emaStyle?.transparentFill;

        layer.setStyle({
          opacity: val,
          fillOpacity: tf ? 0 : val,
        });
        return;
      }

      // Marker layers
      if (layer.setOpacity) {
        layer.setOpacity(val);
        return;
      }

      // FeatureGroup / LayerGroup
      if (layer.eachLayer) {
        layer.eachLayer((l) => applyOpacity(l, val));
      }
    }

    // ----------------------------------------------------
    // Apply style (geometry aware)
    // ----------------------------------------------------
    function applyStyle(layer, style, item) {
      if (!style) return;

      const uiType = getShapeUiType(item);

      // Store style on layer so opacity logic can respect transparent fill
      layer.__emaStyle = style;

      // Points: use circleMarker style (single color)
      if (uiType === "point") {
        const c = style.pointColor || "#2563eb";

        if (layer.setStyle) {
          layer.setStyle({
            color: c,
            weight: 2,
            fillColor: c,
          });
        }
        return;
      }

      // Lines
      if (uiType === "line") {
        const stroke = style.stroke || "#2563eb";
        const weight = style.weight ?? 2;

        if (layer.setStyle) {
          layer.setStyle({
            color: stroke,
            weight: weight,
          });
        }
        return;
      }

      // Polygons / rectangle / circle
      const stroke = style.stroke || "#2563eb";
      const fill = style.fill ?? stroke;
      const weight = style.weight ?? 2;
      const tf = !!style.transparentFill;

      if (layer.setStyle) {
        layer.setStyle({
          color: stroke,
          weight: weight,
          fillColor: fill,
          fillOpacity: tf ? 0 : undefined,
        });
      }
    }

    // ----------------------------------------------------
    // Rebuild Leaflet layer from stored GeoJSON (for Cancel Edits)
    // ----------------------------------------------------
    function buildLayerFromFeatureCollection(fc, item) {
      const features = fc?.features || [];
      if (!features.length) return null;

      const builtLayers = [];

      for (const f of features) {
        const geom = f?.geometry;
        if (!geom) continue;

        const props = f?.properties || {};
        const type = geom.type;

        // Circle rebuild (Point + radius metadata)
        if (type === "Point" && Number.isFinite(props.__circle_radius_m)) {
          const [lon, lat] = geom.coordinates;
          const circle = L.circle([lat, lon], {
            radius: props.__circle_radius_m,
          });
          builtLayers.push(circle);
          continue;
        }

        // Point rebuild -> circleMarker (so we can style point color)
        if (type === "Point") {
          const [lon, lat] = geom.coordinates;
          const cm = L.circleMarker([lat, lon], {
            radius: 7,
            color: "#2563eb",
            weight: 2,
            fillColor: "#2563eb",
            fillOpacity: 0.85,
          });
          builtLayers.push(cm);
          continue;
        }

        // LineString
        if (type === "LineString") {
          const latlngs = (geom.coordinates || []).map(([lon, lat]) => [lat, lon]);
          const line = L.polyline(latlngs);
          builtLayers.push(line);
          continue;
        }

        // Polygon
        if (type === "Polygon") {
          const rings = geom.coordinates || [];
          const latlngRings = rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
          const poly = L.polygon(latlngRings);
          builtLayers.push(poly);
          continue;
        }

        // MultiPolygon / MultiLineString fallback
        try {
          const g = L.geoJSON(f);
          builtLayers.push(g);
        } catch {}
      }

      if (!builtLayers.length) return null;
      if (builtLayers.length === 1) return builtLayers[0];

      return L.featureGroup(builtLayers);
    }

    // ----------------------------------------------------
    // Update popup after rename
    // ----------------------------------------------------
    function updateShapePopup(layer, name) {
      const html = `<div class="ema-popup"><h3>${escapeHTML(name)}</h3></div>`;

      // If it's a group, apply to children
      if (layer?.eachLayer) {
        layer.eachLayer((child) => {
          try {
            if (child.getPopup()) child.setPopupContent(html);
            else child.bindPopup(html);
          } catch {}
        });
      }

      // Apply to the root layer too
      try {
        if (layer.getPopup()) layer.setPopupContent(html);
        else layer.bindPopup(html);
      } catch {}
    }

    // ----------------------------------------------------
    // Edit handler + Cancel logic (reliable snapshot restore)
    // ----------------------------------------------------
    const editHandler = new L.EditToolbar.Edit(map, {
      featureGroup: drawnItems,
    });

    let editMode = false;
    let editSnapshot = null; // id -> FeatureCollection snapshot

    function takeEditSnapshot() {
      const snap = {};
      Object.values(window.DrawShapeManager.items).forEach((item) => {
        try {
          snap[item.id] = layerToFeatureCollection(item.layer, item.name, item.meta?.shapeType);
        } catch {
          // ignore
        }
      });
      return snap;
    }

    function restoreFromSnapshot(snapshot) {
      if (!snapshot) return;

      // Remove existing layers from map + featureGroup
      Object.values(window.DrawShapeManager.items).forEach((item) => {
        try {
          if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
        } catch {}
      });

      drawnItems.clearLayers();

      // Rebuild every item layer from snapshot
      Object.values(window.DrawShapeManager.items).forEach((item) => {
        const fc = snapshot[item.id];
        if (!fc) return;

        const rebuilt = buildLayerFromFeatureCollection(fc, item);
        if (!rebuilt) return;

        // Replace layer reference
        item.layer = rebuilt;

        // Keep geojson stored
        item.geojson = fc;

        // Tag id on the root + children
        rebuilt.__emaDrawId = item.id;
        if (rebuilt.eachLayer) rebuilt.eachLayer((l) => (l.__emaDrawId = item.id));

        // Add to drawnItems always
        drawnItems.addLayer(rebuilt);

        // Respect active toggle state
        if (item.active) {
          rebuilt.addTo(map);
        }

        // Restore popup + style + opacity
        updateShapePopup(rebuilt, item.name);

        applyStyle(rebuilt, item.meta?.style || {}, item);
        applyOpacity(rebuilt, item.opacity ?? 0.7);
      });
    }

    function setEditMode(on) {
      editMode = !!on;

      if (editMode) {
        // Snapshot BEFORE edits begin
        editSnapshot = takeEditSnapshot();

        try {
          editHandler.enable();
        } catch (e) {
          console.warn("Edit enable failed:", e);
        }
      } else {
        // Save edits normally
        try {
          editHandler.save();
        } catch {}

        try {
          editHandler.disable();
        } catch {}
      }

      updateEditButtonUI();
    }

    // When edits are saved via Leaflet.draw
    map.on(L.Draw.Event.EDITED, (e) => {
      const layers = e.layers;

      layers.eachLayer((layer) => {
        const id = layer?.__emaDrawId;
        if (!id) return;

        const item = window.DrawShapeManager.items[id];
        if (!item) return;

        // Update stored geojson
        item.geojson = layerToFeatureCollection(layer, item.name, item.meta?.shapeType);
      });

      refreshListUI();
      refreshDownloadDropdown();
    });

    // ----------------------------------------------------
    // UI layout build
    // ----------------------------------------------------
    root.innerHTML = "";

    // --- Tools section
    const toolsSec = el("div", "drawtools-section");
    toolsSec.appendChild(el("h3", "drawtools-heading", "Tools"));

    const toolBtns = el("div", "drawtools-buttons");
    toolsSec.appendChild(toolBtns);

    function addToolButton(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "drawtools-btn";
      b.textContent = label;
      b.addEventListener("click", onClick);
      toolBtns.appendChild(b);
      return b;
    }

    // Leaflet.draw handlers
    const drawHandlers = {
      polygon: new L.Draw.Polygon(map, { showArea: true }),
      polyline: new L.Draw.Polyline(map),
      marker: new L.Draw.Marker(map),
      rectangle: new L.Draw.Rectangle(map),
      circle: new L.Draw.Circle(map),
    };

    let activeDraw = null;

    function startDraw(kind) {
      // Disable edit mode if drawing
      if (editMode) setEditMode(false);

      if (activeDraw) {
        try {
          activeDraw.disable();
        } catch {}
      }

      const h = drawHandlers[kind];
      if (!h) return;

      activeDraw = h;
      h.enable();
    }

    addToolButton("Polygon", () => startDraw("polygon"));
    addToolButton("Line", () => startDraw("polyline"));
    addToolButton("Point", () => startDraw("marker"));
    addToolButton("Rectangle", () => startDraw("rectangle"));
    addToolButton("Circle", () => startDraw("circle"));

    // Edit mode button + Cancel edits button
    const editRow = el("div", "drawtools-edit-row");

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "drawtools-btn secondary";
    editBtn.textContent = "Enter Edit Mode";
    editRow.appendChild(editBtn);

    const cancelEditBtn = document.createElement("button");
    cancelEditBtn.type = "button";
    cancelEditBtn.className = "drawtools-btn ghost";
    cancelEditBtn.textContent = "Cancel Edits";
    cancelEditBtn.style.display = "none";
    editRow.appendChild(cancelEditBtn);

    editBtn.addEventListener("click", () => {
      setEditMode(!editMode);
    });

    cancelEditBtn.addEventListener("click", () => {
      if (!editMode) return;

      // Disable WITHOUT saving
      try {
        editHandler.disable();
      } catch {}

      // Restore old geometry/state
      restoreFromSnapshot(editSnapshot);

      // Exit edit mode
      editMode = false;
      editSnapshot = null;

      updateEditButtonUI();
      refreshListUI();
      refreshDownloadDropdown();
    });

    function updateEditButtonUI() {
      editBtn.textContent = editMode ? "Exit Edit Mode" : "Enter Edit Mode";
      editBtn.classList.toggle("active", editMode);
      cancelEditBtn.style.display = editMode ? "inline-flex" : "none";
    }

    toolsSec.appendChild(editRow);

    // Clear all button
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "drawtools-btn danger";
    clearBtn.textContent = "Clear All";
    clearBtn.addEventListener("click", () => {
      const ok = confirm("Remove all drawn shapes?");
      if (!ok) return;

      Object.values(window.DrawShapeManager.items).forEach((item) => {
        try {
          map.removeLayer(item.layer);
        } catch {}
      });

      window.DrawShapeManager.items = {};
      drawnItems.clearLayers();

      refreshListUI();
      refreshDownloadDropdown();
    });

    toolsSec.appendChild(clearBtn);
    root.appendChild(toolsSec);

    // --- Drawn shapes list section
    const listSec = el("div", "drawtools-section");
    listSec.appendChild(el("h3", "drawtools-heading", "User Drawn Shapes"));

    const listWrap = el("div", "drawtools-list");
    listSec.appendChild(listWrap);
    root.appendChild(listSec);

    // --- Download section
    const dlSec = el("div", "drawtools-section");
    dlSec.appendChild(el("h3", "drawtools-heading", "Download"));

    const dlWrap = el("div", "drawtools-download");
    dlWrap.innerHTML = `
      <label class="drawtools-label">File type</label>
      <select id="draw-dl-type" class="drawtools-select">
        <option value="geojson">GeoJSON (.geojson)</option>
        <option value="shp">Shapefile (.zip)</option>
      </select>

      <label class="drawtools-label" style="margin-top:10px;">Shape</label>
      <select id="draw-dl-shape" class="drawtools-select"></select>

      <button id="draw-dl-btn" type="button" class="drawtools-btn primary" style="margin-top:10px;">
        Download
      </button>

      <div class="drawtools-hint">
        Tip: Shapefile export requires the <code>shp-write</code> library.
      </div>
    `;

    dlSec.appendChild(dlWrap);
    root.appendChild(dlSec);

    const dlType = dlWrap.querySelector("#draw-dl-type");
    const dlShape = dlWrap.querySelector("#draw-dl-shape");
    const dlBtn = dlWrap.querySelector("#draw-dl-btn");

    // ----------------------------------------------------
    // Layer row UI (like Layers panel)
    // ----------------------------------------------------
    function makeShapeRow(item) {
      const wrap = el("div", "layer-item-card");

      const topRow = el("div", "drawtools-title-row");

      const titleBtn = document.createElement("button");
      titleBtn.type = "button";
      titleBtn.className = "layer-name-btn";
      titleBtn.textContent = item.name;

      // Delete X
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "layer-remove-btn";
      delBtn.title = "Remove shape";
      delBtn.innerHTML = "✕";

      topRow.appendChild(titleBtn);
      topRow.appendChild(delBtn);

      // Toggle row
      const toggleRow = el("div", "layer-toggle-row");
      toggleRow.innerHTML = `
        <label class="toggle-switch" title="Toggle shape">
          <input type="checkbox" class="layer-toggle" />
          <span class="toggle-slider"></span>
        </label>
      `;
      const toggle = toggleRow.querySelector(".layer-toggle");
      toggle.checked = !!item.active;

      // Opacity row
      const opacityRow = el("div", "layer-opacity-row");
      opacityRow.innerHTML = `
        <div class="layer-opacity-label">Opacity</div>
        <input class="opacity-slider" type="range" min="0" max="1" step="0.05" value="${escapeHTML(
          item.opacity
        )}">
      `;
      const slider = opacityRow.querySelector(".opacity-slider");

      wrap.appendChild(topRow);
      wrap.appendChild(toggleRow);
      wrap.appendChild(opacityRow);

      // Click name => open geometry-aware style dialog (includes rename)
      titleBtn.addEventListener("click", async () => {
        const result = await askForShapeOptionsDialog(item);
        if (!result) return;

        // Update name everywhere
        item.name = result.name;
        titleBtn.textContent = item.name;

        // Update popup title
        updateShapePopup(item.layer, item.name);

        // Store style
        item.meta = item.meta || {};
        item.meta.style = result.style;

        // Apply style + re-apply opacity
        applyStyle(item.layer, result.style, item);
        applyOpacity(item.layer, item.opacity);

        // Refresh stored geojson
        item.geojson = layerToFeatureCollection(item.layer, item.name, item.meta?.shapeType);

        refreshDownloadDropdown();
      });

      // Toggle show/hide
      toggle.addEventListener("change", () => {
        const on = toggle.checked;
        item.active = on;

        if (on) {
          if (!map.hasLayer(item.layer)) item.layer.addTo(map);
        } else {
          if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
        }
      });

      // Opacity changes
      slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        item.opacity = val;
        applyOpacity(item.layer, val);
      });

      // Delete single shape
      delBtn.addEventListener("click", () => {
        const ok = confirm(`Delete "${item.name}"?`);
        if (!ok) return;

        try {
          if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
        } catch {}

        try {
          drawnItems.removeLayer(item.layer);
        } catch {}

        delete window.DrawShapeManager.items[item.id];

        refreshListUI();
        refreshDownloadDropdown();
      });

      return wrap;
    }

    // ----------------------------------------------------
    // Refresh list UI
    // ----------------------------------------------------
    function refreshListUI() {
      listWrap.innerHTML = "";

      const items = Object.values(window.DrawShapeManager.items);

      if (!items.length) {
        listWrap.appendChild(el("div", "drawtools-empty", "No shapes created yet."));
        return;
      }

      items.forEach((item) => {
        const row = makeShapeRow(item);
        listWrap.appendChild(row);
      });
    }

    // ----------------------------------------------------
    // Download dropdown refresh
    // ----------------------------------------------------
    function refreshDownloadDropdown() {
      dlShape.innerHTML = "";

      const items = Object.values(window.DrawShapeManager.items);

      if (!items.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No shapes available";
        dlShape.appendChild(opt);
        dlShape.disabled = true;
        return;
      }

      dlShape.disabled = false;

      items.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.name;
        dlShape.appendChild(opt);
      });
    }

    // ----------------------------------------------------
    // Finalize newly drawn layer
    // ----------------------------------------------------
    function finalizeNewDrawLayer(layer, fc, name, shapeType) {
      const id = uid("shape");

      // Add to map + feature group
      layer.addTo(map);
      drawnItems.addLayer(layer);

      // Tag id
      layer.__emaDrawId = id;
      if (layer.eachLayer) layer.eachLayer((l) => (l.__emaDrawId = id));

      // Default style by geometry type
      const item = {
        id,
        name,
        layer,
        geojson: fc || layerToFeatureCollection(layer, name, shapeType),
        active: true,
        opacity: 0.7,
        meta: {
          shapeType,
          style: {},
        },
      };

      // Set default styles
      const uiType = getShapeUiType(item);

      if (uiType === "point") {
        item.meta.style = { pointColor: "#2563eb" };
      } else if (uiType === "line") {
        item.meta.style = { stroke: "#2563eb", weight: 3 };
      } else {
        item.meta.style = { stroke: "#2563eb", fill: "#2563eb", weight: 2, transparentFill: false };
      }

      // Apply style + opacity
      applyStyle(layer, item.meta.style, item);
      applyOpacity(layer, item.opacity);

      // Popup
      try {
        layer.bindPopup(`<div class="ema-popup"><h3>${escapeHTML(name)}</h3></div>`);
      } catch {}

      window.DrawShapeManager.items[id] = item;

      refreshListUI();
      refreshDownloadDropdown();
    }

    // ----------------------------------------------------
    // Leaflet.draw event: when user finishes a draw
    // ----------------------------------------------------
    map.on(L.Draw.Event.CREATED, async (e) => {
      let layer = e.layer;
      const shapeType = e.layerType || "drawn";

      // Stop active draw handler
      if (activeDraw) {
        try {
          activeDraw.disable();
        } catch {}
        activeDraw = null;
      }

      // Convert Marker -> CircleMarker so "point color" styling works properly
      if (shapeType === "marker" && layer?.getLatLng) {
        const ll = layer.getLatLng();
        layer = L.circleMarker(ll, {
          radius: 7,
          color: "#2563eb",
          weight: 2,
          fillColor: "#2563eb",
          fillOpacity: 0.85,
        });
      }

      const rawName = await askForNameDialog("");
      const name = defaultNameIfBlank(rawName);

      const fc = layerToFeatureCollection(layer, name, shapeType);
      finalizeNewDrawLayer(layer, fc, name, shapeType);
    });

    // ----------------------------------------------------
    // Download behavior
    // ----------------------------------------------------
    dlBtn.addEventListener("click", () => {
      const id = dlShape.value;
      if (!id) return;

      const item = window.DrawShapeManager.items[id];
      if (!item) return;

      const type = dlType.value;

      // Always refresh geojson before export (in case edits occurred)
      item.geojson = layerToFeatureCollection(item.layer, item.name, item.meta?.shapeType);

      if (type === "geojson") {
        const blob = new Blob([JSON.stringify(item.geojson, null, 2)], {
          type: "application/geo+json",
        });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${item.name.replace(/[^\w\-]+/g, "_")}.geojson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      if (type === "shp") {
        if (!window.shpwrite) {
          alert("Shapefile export requires shp-write. Add:\nhttps://unpkg.com/shp-write@latest/shpwrite.js");
          return;
        }

        try {
          window.shpwrite.download(item.geojson, {
            file: item.name.replace(/[^\w\-]+/g, "_"),
            folder: "drawn_shapes",
            types: {
              point: "points",
              polygon: "polygons",
              line: "lines",
            },
          });
        } catch (e) {
          console.warn("Shapefile export failed:", e);
          alert("Shapefile export failed. Try GeoJSON instead.");
        }
      }
    });

    // Init UI state
    refreshListUI();
    refreshDownloadDropdown();
    updateEditButtonUI();

    console.log("✅ Draw Tools panel initialized.");
  });
})();
