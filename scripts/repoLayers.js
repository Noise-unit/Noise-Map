// scripts/repoLayers.js
// ----------------------------------------------------
// GeoJSON layer registry stored on github repo
// ----------------------------------------------------
console.log("✅ repoLayers.js loaded");

window.GEOJSON_LAYERS_CONFIG = [
  {
    id: "municipality",
    name: "Municipalities",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Municipality.geojson",
    type: "municipality",
  },
  {
    id: "aripo",
    name: "Aripo Savannas",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Aripo%20Savannas.geojson",
    type: "protected",
  },
  {
    id: "matura",
    name: "Matura National Park",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Matura%20National%20Park.geojson",
    type: "protected",
  },
  {
    id: "nariva",
    name: "Nariva Swamp",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Nariva%20Swamp.geojson",
    type: "protected",
  },
  {
    id: "caroni",
    name: "Caroni Swamp",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Caroni%20Swamp.geojson",
    type: "protected",
  },

  // Roads
  {
    id: "major_roads",
    name: "Major Roads",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Major%20Roads.geojson",
    type: "roads",
  },

  // Noise zones
  {
    id: "noise_zones",
    name: "Current Noise Zones",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Noise%20Zones.geojson",
    type: "zone",
  },
  {
    id: "proposed_noise_zones",
    name: "Proposed Noise Zones",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Proposed%20Noise%20Zones.geojson",
    type: "zone",
  },

  // Protected / reserves
  {
    id: "chag_nature_reserve",
    name: "Chaguaramas Nature Reserve",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Chaguaramas.geojson",
    type: "protected",
  },
  {
    id: "forest_reserves",
    name: "Trinidad Forest Reserves",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Forest%20Reserves.geojson",
    type: "protected",
  },
  {
    id: "main_ridge",
    name: "Main Ridge",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/HummingBirds_MainRidge.geojson",
    type: "protected",
  },

  // POI
  {
    id: "private_medical_trinidad",
    name: "Private Medical Facilities",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/PrivateMedicalFacilities_Trinidad.geojson",
    type: "poi",
  },
  {
    id: "tobago_hospitals",
    name: "Tobago Hospitals",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/TobagoHospitals.geojson",
    type: "poi",
  },
  {
    id: "trinidad_hospitals",
    name: "Trinidad Hospitals",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/TrinidadHospitals.geojson",
    type: "poi",
  },
  {
    id: "turtle_nesting_sites",
    name: "Turtle Nesting Sites",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/TurtleNestingSites.geojson",
    type: "poi",
    labelField: "layer",
    hideFields: ["path"],
  },

  // Policy
  {
    id: "tobago_tcpd_policy",
    name: "Tobago TCPD Policy",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Tobago%20TCPD%20Policy.geojson",
    type: "policy",
    labelField: "Class_Name",
  },
  {
    id: "trinidad_tcpd_policy",
    name: "Trinidad TCPD Policy",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Trinidad%20TCPD%20Policy.geojson",
    type: "policy",
    labelField: "Class_Name",
  },

  // Watersheds
  {
    id: "tobago_watersheds",
    name: "Tobago Watershed",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Tobago%20Watersheds.geojson",
    type: "watershed",
    labelField: "WATERSHED",
  },
  {
    id: "trinidad_watersheds",
    name: "Trinidad Watershed",
    url: "https://raw.githubusercontent.com/Noise-unit/GeojsonLayers/refs/heads/main/Trinidad%20Watersheds.geojson",
    type: "watershed",
    labelField: "NAME",
  },
];

// Section ordering for the Layers panel
window.REPO_LAYER_GROUPS = [
  { id: "zone", title: "Noise Zones" },
  { id: "protected", title: "Protected Areas" },
  { id: "municipality", title: "Administrative" },
  { id: "roads", title: "Roads" },
  { id: "watershed", title: "Watersheds" },
  { id: "policy", title: "Policy" },
  { id: "poi", title: "Points of Interest" },
];
