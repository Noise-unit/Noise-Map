// scripts/layers.js
// ----------------------------------------------------
// Layers Panel
// - Upload CSV/GeoJSON/Shapefile ZIP
// - Uploaded layers list
// - Repo layers list grouped
// - Roads non-interactive
// - Stores features for later analysis
// ----------------------------------------------------
console.log("✅ layers.js loaded");

(function () {
  // ----------------------------
  // Global store for analysis later
  // ----------------------------
  window.UserLayerManager = window.UserLayerManager || {
    uploaded: {}, // id -> { layer, features, meta, active, opacity }
    repo: {}, // id -> { layer, features, meta, active, opacity }
    getAllActiveFeatures() {
      const out = [];
      for (const id in this.uploaded) {
        const d = this.uploaded[id];
        if (d?.active && Array.isArray(d.features)) out.push(...d.features);
      }
      for (const id in this.repo) {
        const d = this.repo[id];
        if (d?.active && Array.isArray(d.features)) out.push(...d.features);
      }
      return out;
    },
  };

  function uid(prefix = "layer") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function el(tag, className, html) {
    const d = document.createElement(tag);
    if (className) d.className = className;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function sanitize(x) {
    return window.LayerStyle?.sanitize ? window.LayerStyle.sanitize(x) : String(x ?? "");
  }

  // ----------------------------
  // CSV handling
  // Default projection: EPSG:32620 (UTM WGS84 20N)
  // ----------------------------
  function utmToLatLon32620(easting, northing) {
    if (typeof proj4 === "undefined") return null;

    const utm20 = "+proj=utm +zone=20 +datum=WGS84 +units=m +no_defs";
    const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";

    try {
      const [lon, lat] = proj4(utm20, wgs84, [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  }

  async function handleCsvUpload(file) {
    if (typeof Papa === "undefined") {
      alert("PapaParse is missing. Ensure papaparse is loaded.");
      return null;
    }

    const text = await file.text();
    const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;

    const markers = [];
    const features = [];

    for (const r of rows) {
      // Expect Easting/Northing (UTM 20N default)
      const e = parseFloat(r.Easting);
      const n = parseFloat(r.Northing);
      if (!Number.isFinite(e) || !Number.isFinite(n)) continue;

      const ll = utmToLatLon32620(e, n);
      if (!ll) continue;

      const m = L.circleMarker([ll.lat, ll.lon], {
        radius: 6,
        color: "#22c55e",
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 0.85,
      });

      // Popup with all fields
      const popupHtml = window.LayerStyle?.makePopupHtml
        ? window.LayerStyle.makePopupHtml(file.name, r)
        : `<div class="ema-popup"><pre>${sanitize(JSON.stringify(r, null, 2))}</pre></div>`;
      m.bindPopup(popupHtml);

      markers.push(m);

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [ll.lon, ll.lat] },
        properties: { ...r, __sourceFile: file.name, __assumedCRS: "EPSG:32620" },
      });
    }

    const group = L.featureGroup(markers);
    group.__ema = {
      type: "upload_csv",
      setOpacity(opacity) {
        group.eachLayer((l) => l.setStyle?.({ fillOpacity: opacity }));
      },
      updateZoomStyles() {},
    };

    return { layer: group, features };
  }

  async function handleGeoJsonUpload(file) {
    // GeoJSON should already be EPSG:4326 for web maps
    const text = await file.text();
    const data = JSON.parse(text);

    const cfg = { id: uid("upload_geojson"), name: file.name, type: "upload_geojson" };
    const built = window.LayerStyle.createLayerFromGeoJson(cfg, data);

    return { layer: built.layer, features: data.features || [] };
  }

  async function handleShapefileZipUpload(file) {
    // shpjs will use .prj if present; no user CRS prompt
    if (typeof shp === "undefined") {
      alert(
        "Shapefile support requires shpjs.\nAdd:\n<script src=\"https://unpkg.com/shpjs@latest/dist/shp.min.js\"></script>"
      );
      return null;
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = await shp(arrayBuffer); // GeoJSON output

    const cfg = { id: uid("upload_shp"), name: file.name, type: "upload_shp" };
    const built = window.LayerStyle.createLayerFromGeoJson(cfg, data);

    return { layer: built.layer, features: data.features || [] };
  }

  // ----------------------------
  // UI builders
  // ----------------------------
  function makeSection(title, subtitle = "") {
    const sec = el("div", "layer-section");
    sec.appendChild(el("h3", "", sanitize(title)));
    if (subtitle) sec.appendChild(el("p", "", sanitize(subtitle)));
    return sec;
  }

  /**
   * makeLayerRow()
   * - nameBtn is the "style" button
   * - toggle is below label
   * - opacity slider under toggle
   * - metadata link under opacity (when needed)
   * - remove X button only when enabled (for uploads)
   */
  function makeLayerRow(name, metaUrl = "", options = {}) {
    const { showRemove = false, onRemove = null } = options;

    const wrap = el("div", "layer-item-card");

    // TOP ROW: Name button + optional remove button
    const topRow = el("div", "layer-card-toprow");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.justifyContent = "space-between";
    topRow.style.gap = "10px";

    // Title button (also acts as style button)
    const titleBtn = document.createElement("button");
    titleBtn.type = "button";
    titleBtn.className = "layer-name-btn";
    titleBtn.textContent = name;

    topRow.appendChild(titleBtn);

    // Remove button (only for uploads)
    let removeBtn = null;
    if (showRemove) {
      removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "layer-remove-btn";
      removeBtn.title = "Remove this uploaded layer";
      removeBtn.setAttribute("aria-label", "Remove layer");
      removeBtn.textContent = "✕";

      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onRemove === "function") onRemove();
      });

      topRow.appendChild(removeBtn);
    }

    // Toggle row (below title)
    const toggleRow = el("div", "layer-toggle-row");
    toggleRow.innerHTML = `
      <label class="toggle-switch" title="Toggle layer">
        <input type="checkbox" class="layer-toggle" />
        <span class="toggle-slider"></span>
      </label>
    `;

    const toggle = toggleRow.querySelector(".layer-toggle");

    // Opacity row
    const opacityRow = el("div", "layer-opacity-row");
    opacityRow.innerHTML = `
      <div class="layer-opacity-label">Opacity</div>
      <input class="opacity-slider" type="range" min="0" max="1" step="0.05" value="0.7">
    `;
    const slider = opacityRow.querySelector(".opacity-slider");

    // Metadata icon row (optional)
    const metaRow = el("div", "layer-meta-row");

    if (metaUrl) {
      const metaLink = document.createElement("a");
      metaLink.className = "layer-meta-link";
      metaLink.href = metaUrl;
      metaLink.target = "_blank";
      metaLink.rel = "noopener noreferrer";
      metaLink.title = "Open metadata document";
      metaLink.innerHTML = `📄 <span>Metadata</span>`;
      metaRow.appendChild(metaLink);
    } else {
      metaRow.style.display = "none";
    }

    wrap.appendChild(topRow);
    wrap.appendChild(toggleRow);
    wrap.appendChild(opacityRow);
    wrap.appendChild(metaRow);

    return { container: wrap, toggle, nameBtn: titleBtn, slider, removeBtn };
  }

  // ----------------------------
  // Repo layer grouping
  // ----------------------------
  function groupRepoLayers(config) {
    const groups = {};
    for (const cfg of config) {
      const t = cfg.type || "other";
      if (!groups[t]) groups[t] = [];
      groups[t].push(cfg);
    }
    return groups;
  }

  // ----------------------------
  // Initiation
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof map === "undefined") {
      console.warn("❌ layers.js: map not found. Ensure main.js loads first.");
      return;
    }

    if (!window.LayerStyle) {
      console.warn("❌ layers.js: LayerStyle missing. Ensure layerStyle.js loads before layers.js.");
      return;
    }

    const root = document.getElementById("layers-root");
    if (!root) {
      console.warn("❌ layers.js: #layers-root missing. Add panel-layers container in index.html.");
      return;
    }

    root.innerHTML = "";

    async function preloadRepoLayers() {
      const registry = window.GEOJSON_LAYERS_CONFIG || [];

      for (const cfg of registry) {
        if (window.UserLayerManager.repo[cfg.id]) continue;

        try {
          const resp = await fetch(cfg.url);
          const data = await resp.json();

          const built = window.LayerStyle.createLayerFromGeoJson(cfg, data);

          const feats = built.features || (data.features || []);
          const labelField = computeLabelField(cfg, feats);

          window.UserLayerManager.repo[cfg.id] = {
            id: cfg.id,
            name: cfg.name,
            layer: built.layer,
            features: feats,
            active: false,
            opacity: cfg.type === "roads" ? 0.6 : 0.7,
            meta: {
              type: cfg.type,
              url: cfg.url,

              labelField: labelField,
            },
          };

          if (built.layer.__ema?.updateZoomStyles) {
            map.on("zoomend", () => built.layer.__ema.updateZoomStyles());
          }
        } catch (e) {
          console.warn("❌ Failed to preload repo layer:", cfg.name, e);
        }
      }

      console.log("✅ Repo layers preloaded");

      // Notify Filters/Analysis that repo layers are ready
      document.dispatchEvent(new CustomEvent("layers:repoPreloaded"));

      // Force Major Roads always ON
      const roadsId = "major_roads";
      const roadsObj = window.UserLayerManager.repo[roadsId];

      if (roadsObj?.layer) {
        roadsObj.active = true;

        if (!map.hasLayer(roadsObj.layer)) {
          roadsObj.layer.addTo(map);
        }

        // Ensure dynamic visibility behavior kicks in
        roadsObj.layer.__ema?.setActive?.(true);

        // Set base opacity (line opacity) for roads
        roadsObj.layer.__ema?.setOpacity?.(0.6);
      }
    }

        // Determine the label field used for styling/tooltips (to be used in analysis and filter sections)
        function computeLabelField(cfg, features) {
          if (!features || !features.length) return null;

          // If config explicitly provides labelField, use it
          if (cfg.labelField) return cfg.labelField;

          // Same defaults used in layerStyle.js
          if (cfg.type === "municipality") return "NAME_1";
          if (cfg.type === "zone") return "zone";

          // Otherwise guess from properties
          if (window.LayerStyle?.guessLabelProperty) {
            return window.LayerStyle.guessLabelProperty(features);
          }

          return null;
        }

    // Start preloading (runs in background)
    preloadRepoLayers();

    // ----------------------------
    // Section 1: Upload
    // ----------------------------
    const uploadSec = makeSection("Upload data", "Upload CSV (UTM), GeoJSON, or Shapefile (.zip).");

    const uploadUI = el("div", "layer-upload-row");
    uploadUI.innerHTML = `
      <label>Select file(s)</label>
      <input id="upload-file" type="file" multiple accept=".csv,.geojson,.json,.zip" />
      <button id="upload-btn" type="button">Upload</button>
    `;

    uploadSec.appendChild(uploadUI);
    root.appendChild(uploadSec);

    const fileInput = uploadUI.querySelector("#upload-file");
    const uploadBtn = uploadUI.querySelector("#upload-btn");

    // ----------------------------
    // Section 2: Uploaded layers
    // ----------------------------
    const uploadedSec = makeSection("User-uploaded layers", "Uploaded layers appear here.");
    const uploadedList = el("div", "layer-list");
    uploadedSec.appendChild(uploadedList);
    root.appendChild(uploadedSec);

    // ----------------------------
    // Section 3: Repo layers
    // ----------------------------
    const repoSec = makeSection("GeoJson layers");
    root.appendChild(repoSec);

    const repoGroups = groupRepoLayers(window.GEOJSON_LAYERS_CONFIG || []);
    const groupOrder = window.REPO_LAYER_GROUPS || [];

    // Create group blocks in a consistent order
    for (const g of groupOrder) {
      const list = repoGroups[g.id];
      if (!list || !list.length) continue;

      // Remove roads from what gets displayed in the panel
      const visibleList = list.filter((cfg) => cfg.type !== "roads");

      // If nothing remains after filtering, skip the entire group heading
      if (!visibleList.length) continue;

      const groupBlock = el("div", "layer-section");
      groupBlock.style.marginTop = "12px";
      groupBlock.appendChild(el("h3", "", sanitize(g.title)));

      const groupList = el("div", "layer-list");
      groupBlock.appendChild(groupList);
      repoSec.appendChild(groupBlock);

      for (const cfg of visibleList) {
        const row = makeLayerRow(cfg.name, cfg.metaUrl || "");
        groupList.appendChild(row.container);

        row.slider.value = "0.7";

        row.toggle.addEventListener("change", () => {
          const isOn = row.toggle.checked;

          const obj = window.UserLayerManager.repo[cfg.id];
          if (!obj) {
            alert(`Layer not ready yet: ${cfg.name}`);
            row.toggle.checked = false;
            return;
          }

          obj.active = isOn;

          if (isOn) {
            obj.layer.addTo(map);
            obj.layer.__ema?.setOpacity(parseFloat(row.slider.value));
          } else {
            map.removeLayer(obj.layer);
          }
        });

        row.slider.addEventListener("input", () => {
          const obj = window.UserLayerManager.repo[cfg.id];
          const val = parseFloat(row.slider.value);

          if (!obj) return;
          obj.opacity = val;

          if (obj.active && obj.layer?.__ema?.setOpacity) {
            obj.layer.__ema.setOpacity(val);
          }
        });

        row.nameBtn.addEventListener("click", () => {
          alert(`Style options coming next for: ${cfg.name}`);
        });
      }
    }

    // ----------------------------
    // Upload click
    // ----------------------------
    uploadBtn.addEventListener("click", async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) {
        alert("Please select at least one file.");
        return;
      }

      for (const file of files) {
        let result = null;

        try {
          const lower = file.name.toLowerCase();

          if (lower.endsWith(".csv")) {
            result = await handleCsvUpload(file);
          } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
            result = await handleGeoJsonUpload(file);
          } else if (lower.endsWith(".zip")) {
            result = await handleShapefileZipUpload(file);
          } else {
            alert(`Unsupported file type: ${file.name}`);
            continue;
          }
        } catch (e) {
          console.warn("Upload failed:", e);
          alert(`Failed to upload: ${file.name}`);
          continue;
        }

        if (!result) continue;

        const id = uid("upload");
        const { layer, features } = result;

        const uploadLabelField = computeLabelField({ type: "uploaded" }, features);

        window.UserLayerManager.uploaded[id] = {
          id,
          name: file.name,
          layer,
          features,
          active: false,
          opacity: 0.7,
          meta: {
            source: "upload",
            fileName: file.name,

            labelField: uploadLabelField,
          },
        };

        // ✅ Create row WITH REMOVE (X) for uploads only
        const row = makeLayerRow(file.name, "", {
          showRemove: true,
          onRemove: () => {
            const obj = window.UserLayerManager.uploaded[id];
            if (!obj) return;

            // Remove from map if present
            if (obj.layer && map.hasLayer(obj.layer)) {
              map.removeLayer(obj.layer);
            }

            // Remove from store (so analysis cannot access it)
            delete window.UserLayerManager.uploaded[id];

            // Remove UI card
            row.container.remove();
          },
        });

        uploadedList.appendChild(row.container);

        row.slider.value = "0.7";

        row.toggle.addEventListener("change", () => {
          const isOn = row.toggle.checked;
          const obj = window.UserLayerManager.uploaded[id];
          if (!obj) return;

          obj.active = isOn;

          if (isOn) {
            obj.layer.addTo(map);
            obj.layer.__ema?.setOpacity(parseFloat(row.slider.value));
          } else {
            map.removeLayer(obj.layer);
          }
        });

        row.slider.addEventListener("input", () => {
          const obj = window.UserLayerManager.uploaded[id];
          if (!obj) return;

          const val = parseFloat(row.slider.value);
          obj.opacity = val;

          if (obj.active && obj.layer?.__ema?.setOpacity) {
            obj.layer.__ema.setOpacity(val);
          }
        });

        row.nameBtn.addEventListener("click", () => {
          alert(`Style options coming next for: ${file.name}`);
        });
      }

      fileInput.value = "";
    });

    console.log("✅ Layers panel initialized");
  });
})();
