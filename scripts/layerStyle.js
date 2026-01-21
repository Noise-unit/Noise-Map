// scripts/layerStyle.js
// ----------------------------------------------------
// Central styling and layer creation utilities
// Used by layers.js for repo layers AND uploaded layers
// ----------------------------------------------------
console.log("✅ layerStyle.js loaded");

(function () {
  function sanitize(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function getPolygonStrokeWidth(zoom) {
    if (zoom >= 15) return 3;
    if (zoom >= 12) return 2;
    return 1;
  }

  function getRoadLineWidth(zoom) {
    if (zoom >= 17) return 4;
    if (zoom >= 15) return 3;
    if (zoom >= 13) return 2;
    return 1.5;
  }

  function buildCategoryColorMap(values) {
    const unique = Array.from(new Set(values)).filter(
      (v) => v !== undefined && v !== null && String(v).trim() !== ""
    );

    const count = unique.length || 1;
    const mapColors = {};

    unique.forEach((val, idx) => {
      const hue = (idx * 360) / count;
      const saturation = 55;
      const lightness = 78;
      mapColors[val] = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    });

    return mapColors;
  }

  function guessLabelProperty(features) {
    if (!features || !features.length) return null;

    const props = features[0].properties || {};
    const candidateKeys = [
      "zone",
      "ZONE",
      "name",
      "Name",
      "NAME",
      "label",
      "Label",
      "LABEL",
      "category",
      "Category",
      "CATEGORY",
    ];

    for (const key of candidateKeys) {
      if (key in props) return key;
    }

    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "string" && value.trim() !== "") return key;
    }

    return null;
  }

  function featureIntersectsBounds(feature, bounds) {
    // Fast-ish check using bbox of coordinates
    // Works for LineString + MultiLineString. If anything fails, we render it.
    try {
      const geom = feature.geometry;
      if (!geom) return true;

      const coords = geom.coordinates;
      let points = [];

      if (geom.type === "LineString") {
        points = coords;
      } else if (geom.type === "MultiLineString") {
        points = coords.flat();
      } else {
        // For polygons, we don't use this filter here.
        return true;
      }

      let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999;
      for (const [lng, lat] of points) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }

      const featureBounds = L.latLngBounds(
        L.latLng(minLat, minLng),
        L.latLng(maxLat, maxLng)
      );

      return bounds.intersects(featureBounds);
    } catch {
      return true;
    }
  }

  function defaultStyleByType(type) {
    // Neutral but distinct defaults; you can tune later.
    const base = {
      municipality: { stroke: "#6b7280", fillOpacity: 0.0 },
      protected: { stroke: "#6b7280", fillOpacity: 0.0 },
      zone: { stroke: "#6b7280", fillOpacity: 0.0 },
      watershed: { stroke: "#6b7280", fillOpacity: 0.0 },
      policy: { stroke: "#6b7280", fillOpacity: 0.0 },
      poi: { marker: "#60a5fa" },
      roads: { stroke: "#ffffff" },
    };
    return base[type] || { stroke: "#6b7280", fillOpacity: 0.0 };
  }

    function makePopupHtml(title, props, hiddenFields = []) {
    const keys = Object.keys(props || {});

    const hiddenSet = new Set(
        (hiddenFields || []).map((k) => String(k).toLowerCase().trim())
    );

    let html = `<div class="popup-title">${sanitize(title)}</div><table>`;

    for (const k of keys) {
        if (hiddenSet.has(String(k).toLowerCase().trim())) continue;

        html += `<tr>
        <td class="key"><strong>${sanitize(k)}</strong></td>
        <td class="val">${sanitize(props[k])}</td>
        </tr>`;
    }

    html += `</table>`;
    return `<div class="ema-popup">${html}</div>`;
    }

function createPolygonLayer(cfg, data) {
  const features = (data && data.features) || [];

  const labelField =
    cfg.labelField ||
    (cfg.type === "municipality"
      ? "NAME_1"
      : cfg.type === "zone"
      ? "zone"
      : null) ||
    guessLabelProperty(features);

  const valuesForColors = labelField
    ? features.map((f) => f?.properties?.[labelField])
    : [cfg.name];

  const colorMap = buildCategoryColorMap(valuesForColors.length ? valuesForColors : [cfg.name]);

  const labelClass =
    cfg.type === "municipality"
      ? "municipality-label"
      : cfg.type === "zone"
      ? "zone-label"
      : "protected-label";

  const layer = L.geoJSON(data, {
    // allow interaction (click)
    interactive: true,

    style: (feature) => {
      const key = labelField ? feature?.properties?.[labelField] : cfg.name;

      const fillColor =
        colorMap[key] || Object.values(colorMap)[0] || "#e5e7eb";

      return {
        color: "#6b7280",
        weight: getPolygonStrokeWidth(map.getZoom()),
        fillColor,
        fillOpacity: 0.0, 
        interactive: true, 
      };
    },

    onEachFeature: (feature, lyr) => {
      const props = feature?.properties || {};

      // Popup (all properties)
      const popupHtml = makePopupHtml(cfg.name, props);
      lyr.bindPopup(popupHtml, {
        maxWidth: 380,
        closeButton: true,
        autoPan: true,
      });

      const labelText = labelField ? props?.[labelField] : null;
      if (labelText && String(labelText).trim() !== "") {
        lyr.bindTooltip(String(labelText), {
          direction: "center",
          className: labelClass,
          sticky: true,
        });
      }
    },
  });

  layer.__ema = {
    type: "repo_polygon",
    setOpacity(opacity) {
      // affects polygon fill, not border
      layer.setStyle({ fillOpacity: opacity });
    },
    updateZoomStyles() {
      layer.setStyle({ weight: getPolygonStrokeWidth(map.getZoom()) });
    },
  };

  return { layer, features };
}

function createLineLayer(cfg, data) {
  const features = (data && data.features) || [];

  const layer = L.geoJSON(data, {
    interactive: true,
    style: () => ({
      color: "#e5e7eb",
      weight: getRoadLineWidth(map.getZoom()),
      opacity: 0.7,
      interactive: true,
    }),
    onEachFeature: (feature, lyr) => {
      const props = feature?.properties || {};
      const popupHtml = makePopupHtml(cfg.name, props);

      lyr.bindPopup(popupHtml, {
        maxWidth: 380,
        closeButton: true,
        autoPan: true,
      });
    },
  });

  layer.__ema = {
    type: "repo_line",
    setOpacity(opacity) {
      layer.setStyle({ opacity });
    },
    updateZoomStyles() {
      layer.setStyle({ weight: getRoadLineWidth(map.getZoom()) });
    },
  };

  return { layer, features };
}

  function createPointLayer(cfg, data) {
    const base = defaultStyleByType(cfg.type);

    const layer = L.geoJSON(data, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 6,
          color: base.marker || "#60a5fa",
          weight: 2,
          fillColor: base.marker || "#60a5fa",
          fillOpacity: 0.85,
        }),
      onEachFeature: (feature, lyr) => {
        lyr.bindPopup(makePopupHtml(cfg.name, feature.properties || {}, cfg.hideFields || []));
      },
    });

    layer.__ema = {
      type: cfg.type,
      setOpacity(opacity) {
        // opacity for points affects fillOpacity mostly
        layer.eachLayer((l) => {
          if (l.setStyle) l.setStyle({ fillOpacity: opacity });
        });
      },
      updateZoomStyles() {},
    };

    return { layer, features: (data && data.features) || [] };
  }

function createRoadsLayer(cfg, data) {
  // ======================================================
  // Roads layer (always-on behavior)
  // - Non-interactive, display + analysis use
  // - Only renders at zoom >= 16
  // - Curved labels along line at zoom >= 18 (Leaflet.TextPath)
  // - Renders only features that intersect map bounds (performance)
  // ======================================================

  const roadsData = data;
  const base = defaultStyleByType("roads");

  let visible = true;     
  let opacity = 0.6;     

  const textPathAvailable =
    typeof L !== "undefined" &&
    typeof L.Polyline !== "undefined" &&
    typeof L.Polyline.prototype.setText === "function";

  // --- Helper: fast-ish geometry vs bounds intersection ---
  function featureIntersectsBounds(feature, bounds) {
    const geom = feature?.geometry;
    if (!geom) return false;

    const coords = geom.coordinates;
    if (!coords) return false;

    const coordInBounds = (c) => {
      const lon = c[0];
      const lat = c[1];
      return bounds.contains([lat, lon]);
    };

    if (geom.type === "LineString") {
      for (const c of coords) {
        if (coordInBounds(c)) return true;
      }
      return false;
    }

    if (geom.type === "MultiLineString") {
      for (const line of coords) {
        for (const c of line) {
          if (coordInBounds(c)) return true;
        }
      }
      return false;
    }

    return false;
  }

  // --- Helper: Google-ish road line width per zoom ---
  function getRoadLineWidth(zoom) {
    if (zoom >= 17) return 4;
    if (zoom >= 15) return 3;
    if (zoom >= 13) return 2;
    return 1.5;
  }

  // --- Roads GeoJSON layer ---
  const roadsLayer = L.geoJSON(null, {
    interactive: false,
    bubblingMouseEvents: false,
    style: () => ({
      color: base.stroke,
      weight: getRoadLineWidth(map.getZoom()),
      opacity,
      interactive: false,
    }),
    onEachFeature: (feature, layer) => {
      layer.options.interactive = false;

      // Grab common road name fields
      const name =
        feature.properties?.name ||
        feature.properties?.NAME ||
        feature.properties?.Name ||
        feature.properties?.ROAD_NAME ||
        feature.properties?.RoadName;

      layer.__roadName = name ? String(name) : null;
    },
  });

  function applyRoadTextLabels(showLabels) {
    if (!textPathAvailable) return;

    roadsLayer.eachLayer((layer) => {
      const name = layer.__roadName;
      if (!name || typeof layer.setText !== "function") return;

      if (!showLabels) {

        layer.setText(null);
        return;
      }

      // Add curved label text
      layer.setText(name, {
        repeat: false,     
        center: true,
        offset: 7,     
        attributes: {
          class: "road-text-label",
        },
      });
    });
  }

  // --- Main visibility (zoom + bounds + label rules) ---
  function updateRoadsVisibility() {
    if (!roadsLayer || !roadsData) return;

    const zoom = map.getZoom();
    const bounds = map.getBounds();

    const showLines = visible && zoom >= 16;
    const showLabels = visible && zoom >= 18;

    roadsLayer.clearLayers();

    if (!showLines) {
      if (map.hasLayer(roadsLayer)) map.removeLayer(roadsLayer);
      return;
    }

    const feats = roadsData.features || [];
    for (const f of feats) {
      if (featureIntersectsBounds(f, bounds)) {
        roadsLayer.addData(f);
      }
    }

    if (!map.hasLayer(roadsLayer)) {
      roadsLayer.addTo(map);
    }

    // Update style
    roadsLayer.setStyle({
      weight: getRoadLineWidth(zoom),
      color: base.stroke,
      opacity,
    });

    applyRoadTextLabels(showLabels);
  }

  map.on("zoomend", updateRoadsVisibility);
  map.on("moveend", updateRoadsVisibility);

  // --- Initial draw ---
  setTimeout(updateRoadsVisibility, 0);

  roadsLayer.__ema = {
    type: "roads",
    setActive(isOn) {
 
      visible = !!isOn;
      updateRoadsVisibility();
    },
    setOpacity(val) {
      opacity = Number(val);
      if (!Number.isFinite(opacity)) opacity = 0.6;
      updateRoadsVisibility();
    },
    updateZoomStyles() {
      updateRoadsVisibility();
    },
    features: (roadsData && roadsData.features) || [],
  };

  return { layer: roadsLayer, features: (roadsData && roadsData.features) || [] };
}

  function createLayerFromGeoJson(cfg, data) {
    // Decide how to render based on geometry + type
    const hasFeatures = data && Array.isArray(data.features) && data.features.length > 0;
    const geomType = hasFeatures ? data.features[0]?.geometry?.type : null;

    if (cfg.type === "roads") return createRoadsLayer(cfg, data);

    // If it’s points, render as point layer; else polygon layer
    if (geomType === "Point" || geomType === "MultiPoint") {
      return createPointLayer(cfg, data);
    }

    return createPolygonLayer(cfg, data);
  }

  window.LayerStyle = {
    sanitize,
    getPolygonStrokeWidth,
    getRoadLineWidth,
    buildCategoryColorMap,
    guessLabelProperty,
    featureIntersectsBounds,
    defaultStyleByType,
    createLayerFromGeoJson,
    makePopupHtml,
  };
})();
