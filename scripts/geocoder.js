// scripts/geocoder.js
// ----------------------------------------------------
// Search Bar (top-right) + dropdown suggestions
// Uses Photon Geocoder (https://photon.komoot.io)
// ----------------------------------------------------


// Pull out the elements from index.html
const form = document.getElementById("search-form");
const input = document.getElementById("search-input");


  // Create suggestion dropdown container
  const suggestionsBox = document.createElement("div");
  suggestionsBox.className = "search-suggestions";
  suggestionsBox.style.display = "none";
  form.style.position = "relative";
  form.appendChild(suggestionsBox);

  // Photon endpoint (free tier)
  const PHOTON_URL = "https://photon.komoot.io/api/";

  // Bias searches toward Trinidad & Tobago by prioritizing results near Port of Spain.
  // Photon supports &lat= &lon= for priority near a position. :contentReference[oaicite:1]{index=1}
  const BIAS_LAT = 10.6603;
  const BIAS_LON = -61.5086;

  // Used to cancel previous requests while typing (keeps results accurate + fast)
  let activeController = null;

  function hideSuggestions() {
    suggestionsBox.style.display = "none";
    suggestionsBox.innerHTML = "";
  }

  function zoomToFeature(feature) {
  if (!feature) return;

  // Photon returns GeoJSON coordinates [lon, lat]
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return;

  const lon = coords[0];
  const lat = coords[1];

  // Zoom level for a "specific searched location"
  const TARGET_ZOOM = 17;

  // Minimum zoom to enforce even if bounds are very large
  const MIN_ZOOM = 15;

  // Photon extent when provided:
  // [minLon, minLat, maxLon, maxLat]
  const extent = feature.properties?.extent;

  if (Array.isArray(extent) && extent.length === 4) {
    const bounds = L.latLngBounds(
      [extent[1], extent[0]],
      [extent[3], extent[2]]
    );

    // Fit bounds first, but and not zooming out too far
    map.fitBounds(bounds, { padding: [40, 40] });

    // After fitBounds finishes, force minimum zoom if needed
    setTimeout(() => {
      if (map.getZoom() < MIN_ZOOM) {
        map.setView([lat, lon], MIN_ZOOM);
      }
    }, 200);
  } else {
 
    // Zoom close to the searched place if the search location is a point eg. Environmental Management Authority POS.
    map.setView([lat, lon], TARGET_ZOOM);
  }
}

  // Label for Dropdown
  function buildLabel(feature) {
    const p = feature.properties || {};
    const name = p.name || "Unknown place";

    // Add extra context if available (subtext to search query)
    const parts = [];
    if (p.city) parts.push(p.city);
    if (p.state) parts.push(p.state);
    if (p.country) parts.push(p.country);

    return parts.length ? `${name} — ${parts.join(", ")}` : name;
  }

  // Debounce helper (prevents hammering the API on every keystroke)
  function debounce(fn, delay = 350) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  async function photonSearch(query, limit = 6) {
    // Cancel any previous in-flight request
    if (activeController) activeController.abort();
    activeController = new AbortController();

    const url =
      `${PHOTON_URL}?q=${encodeURIComponent(query)}` +
      `&limit=${limit}` +
      `&lat=${BIAS_LAT}&lon=${BIAS_LON}` +
      `&lang=en`;

    const res = await fetch(url, { signal: activeController.signal });

    if (!res.ok) {
      throw new Error(`Photon error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.features || [];
  }

  // Show suggestions while typing
  async function fetchSuggestions(query) {
    const trimmed = query.trim();

    if (trimmed.length < 3) {
      hideSuggestions();
      return;
    }

    try {
      const features = await photonSearch(trimmed, 6);

      suggestionsBox.innerHTML = "";

      if (!features.length) {
        hideSuggestions();
        return;
      }

      suggestionsBox.style.display = "block";

      features.forEach((feature) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = buildLabel(feature);

        btn.addEventListener("click", () => {
          input.value = feature.properties?.name || input.value;
          hideSuggestions();
          zoomToFeature(feature);
        });

        suggestionsBox.appendChild(btn);
      });
    } catch (err) {

      if (err.name === "AbortError") return;

      console.warn("❌ Photon suggestion fetch failed:", err);
      hideSuggestions();
    }
  }

  const fetchSuggestionsDebounced = debounce(fetchSuggestions, 350);

input.addEventListener("input", () => {
  const val = input.value.trim();

  // If user is typing coordinates, don't show Photon suggestions
  if (parseLatLon(val) || parseUTM32620(val)) {
    hideSuggestions();
    return;
  }

  fetchSuggestionsDebounced(val);
});

// Coordinate Search Helpers
function parseLatLon(query) {
  const q = query.trim();

  // matches two decimal numbers separated by comma or space
  const match = q.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/
  );

  if (!match) return null;

  const a = parseFloat(match[1]);
  const b = parseFloat(match[2]);

  // LAT must be between -90 and 90
  // LON must be between -180 and 180
  if (a >= -90 && a <= 90 && b >= -180 && b <= 180) {
    return { lat: a, lon: b };
  }

  // If user type LON, LAT by mistake
  // Example: "-61.5086, 10.6603"
  if (b >= -90 && b <= 90 && a >= -180 && a <= 180) {
    return { lat: b, lon: a };
  }

  return null;
}

// Detect UTM easting/northing like:
// "661000 1180000" OR "E=661000 N=1180000" OR "661000,1180000"
function parseUTM32620(query) {
  const q = query.trim();

  // Extract all numbers from the string
  const nums = q.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;

  const easting = parseFloat(nums[0]);
  const northing = parseFloat(nums[1]);

  // Basic sanity checks for UTM Zone 20N:
  if (
    easting >= 100000 &&
    easting <= 900000 &&
    northing >= 0 &&
    northing <= 10000000
  ) {
    return { easting, northing };
  }

  return null;
}

// Convert UTM (EPSG:32620) to lat/lon (EPSG:4326) using proj4
function utm32620ToLatLon(easting, northing) {
  if (typeof proj4 === "undefined") {
    console.warn("proj4 not found. Make sure proj4.js loads before geocoder.js");
    return null;
  }

  // Define projections
  const epsg32620 = "+proj=utm +zone=20 +datum=WGS84 +units=m +no_defs";
  const epsg4326 = "+proj=longlat +datum=WGS84 +no_defs";

  // proj4 returns [lon, lat]
  const [lon, lat] = proj4(epsg32620, epsg4326, [easting, northing]);

  return { lat, lon };
}

  // Enter or Search button to trigger the search
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const query = input.value.trim();
  if (!query) return;

  hideSuggestions();

  // Try LAT/LON first
  const latlon = parseLatLon(query);
  if (latlon) {
    map.setView([latlon.lat, latlon.lon], 18); // zoom close
    return;
  }

  //Try UTM (EPSG:32620) second
  const utm = parseUTM32620(query);
  if (utm) {
    const converted = utm32620ToLatLon(utm.easting, utm.northing);
    if (converted) {
      map.setView([converted.lat, converted.lon], 18);
      return;
    }
  }

  //Otherwise, treat it as a normal place name and search Photon
  try {
    const features = await photonSearch(query, 1);

    if (features.length) {
      zoomToFeature(features[0]);
    } else {
      alert("No results found. Try a different search term.");
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.warn("❌ Photon submit search failed:", err);
    alert("Search failed. Please try again.");
  }
});

  // Click outside closes dropdown
  document.addEventListener("click", (e) => {
    if (!form.contains(e.target)) hideSuggestions();
  });

  // Escape key closes dropdown
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideSuggestions();
  });

  console.log("✅ Photon search system initialized."); //to test that it functions as intended
