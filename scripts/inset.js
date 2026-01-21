// scripts/inset.js
// ----------------------------------------------------
// Inset / Overview Map (bottom-right container)
// ----------------------------------------------------

console.log("✅ inset.js loaded");

// Safety check: make sure the main Leaflet map exists
if (typeof map === "undefined") {
  console.warn("❌ inset.js: 'map' not found. Make sure main.js loads first.");
} else {
  // -----------------------------
  // Helper: bounds at fixed zoom
  // (prevents rectangle from being insanely tiny at high zoom)
  // -----------------------------
  function boundsAtZoom(center, zoom) {
    const size = map.getSize();
    const half = size.divideBy(2);
    const centerPx = map.project(center, zoom);

    const sw = map.unproject(centerPx.subtract(half), zoom);
    const ne = map.unproject(centerPx.add(half), zoom);

    return L.latLngBounds(sw, ne);
  }

  // -----------------------------
  // Boundaries
  // -----------------------------
  const BOUNDS_TRINIDAD = L.latLngBounds(
    [9.95, -61.95],
    [10.95, -60.45]
  );

  const BOUNDS_TOBAGO = L.latLngBounds(
    [11.05, -60.95],
    [11.40, -60.40]
  );

  // Boundary for everything else not Trinidad or Tobago
  const BOUNDS_BOTH = L.latLngBounds(
    [9.95, -61.95],
    [11.45, -60.35]
  );

  // -----------------------------
  // Create the inset map
  // -----------------------------
  const insetMap = L.map("inset-map", {
    attributionControl: false,
    zoomControl: false,

    dragging: false,
    scrollWheelZoom: false,
    touchZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    zoomSnap: 0,
    inertia: false,
  });

  // Basemap for inset (light grey)
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(insetMap);

  // Red rectangle showing the main map view
  const viewRect = L.rectangle(map.getBounds(), {
    color: "red",
    weight: 2,
    fill: false,
    className: "inset-viewport-rect",
  }).addTo(insetMap);

  // -----------------------------
  // Decide which mode to show
  // -----------------------------
  function insetModeForCenter(centerLatLng) {
    if (BOUNDS_TOBAGO.contains(centerLatLng)) return "TOBAGO";
    if (BOUNDS_TRINIDAD.contains(centerLatLng)) return "TRINIDAD";
    return "BOTH";
  }
  // Rectangle size limits
    const RECT_ZOOM_MIN = 12; // prevents rectangle from being too large
    const RECT_ZOOM_MAX = 14; // prevents rectangle from being too small

  // -----------------------------
  // Update inset on main map movement
  // -----------------------------
  function updateInset() {
    const center = map.getCenter();
    const currentZoom = map.getZoom();

    const mode = insetModeForCenter(center);

    // Pick the island bounds to display
    let targetBounds;
    if (mode === "TOBAGO") {
      targetBounds = BOUNDS_TOBAGO;
    } else if (mode === "TRINIDAD") {
      targetBounds = BOUNDS_TRINIDAD;
    } else {
      targetBounds = BOUNDS_BOTH;
    }

    // Rectangle bounds:
    const clampedZoom = Math.max(RECT_ZOOM_MIN, Math.min(currentZoom, RECT_ZOOM_MAX));
    const rectBounds = boundsAtZoom(center, clampedZoom);

    // Update rectangle first
    viewRect.setBounds(rectBounds);

    // If in Other mode, ensure the rectangle is also visible
    if (mode === "BOTH") {
      // Create a combined bounds that contains everything else
      const combined = L.latLngBounds(targetBounds);
      combined.extend(rectBounds);

      insetMap.fitBounds(combined, { animate: false, padding: [8, 8] });
    } else {
      // Normal Trinidad or Tobago view
      insetMap.fitBounds(targetBounds, { animate: false, padding: [8, 8] });
    }
  }

  // Run once the main map is ready
  map.whenReady(() => {
    insetMap.invalidateSize();
    updateInset();
  });

  // Update after map movement/zoom finishes
  map.on("moveend zoomend", updateInset);

  console.log("✅ Inset map initialized.");
}
