// Initialize the Leaflet noisemap
const map = L.map('map', {
  zoomControl: true,
});

// === Basemaps (openstreet map and Google - the const names were left as esriStreets and esriImagery from a previous version of the code)===
const esriStreets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, //above this number causes render issues with the esristreet
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

  const esriImagery = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: 'Google', // need to figure out the proper attribution to allow for imagery date display etc.
    maxZoom: 20 
  });

// Initial view — centered roughly on Trinidad & Tobago
map.setView([10.55, -61.25], 9);

// Scale bar (this could be used for functions like buffers etc.......)
L.control.scale({ imperial: false }).addTo(map);

// Ensure proper sizing on load/resize
const invalidate = () => map.invalidateSize();
window.addEventListener('load', invalidate);
window.addEventListener('resize', invalidate);

let currentBase = "streets";

function toggleBasemap(buttonEl) {
  if (currentBase === "streets") {
    // Switch to imagery
    if (map.hasLayer(esriStreets)) map.removeLayer(esriStreets);
    esriImagery.addTo(map);

    currentBase = "imagery";
    if (buttonEl) buttonEl.textContent = "Streets"; 
  } else {
    // Switch to streets
    if (map.hasLayer(esriImagery)) map.removeLayer(esriImagery);
    esriStreets.addTo(map);

    currentBase = "streets";
    if (buttonEl) buttonEl.textContent = "Satellite"; 
  }
}

// Wire up the top-right HTML button after the DOM is available
document.addEventListener("DOMContentLoaded", () => {
  const basemapBtn = document.getElementById("basemap-toggle");
  if (!basemapBtn) return;

  // Initial label should indicate what the NEXT basemap will be
  basemapBtn.textContent = "Satellite";

  basemapBtn.addEventListener("click", (e) => {

    e.preventDefault();
    e.stopPropagation();
    toggleBasemap(basemapBtn);
  });
});