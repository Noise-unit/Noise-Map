// scripts/theme.js
// ----------------------------------------------------
// Light/Dark Theme Toggle
// - Uses body[data-theme="dark" | "light"]
// - Saves preference to localStorage
// - Contains Road toggle in the settings panel
// ----------------------------------------------------

console.log("✅ theme.js loaded");

const THEME_KEY = "ema-map-theme";

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);

  // Update the toggle switch UI
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.checked = theme === "light";
  }
}

function getPreferredTheme() {
  // Use saved preference if it exists
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;

  // Otherwise follow the user's system preference
  const prefersLight =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches;

  return prefersLight ? "light" : "dark";
}

document.addEventListener("DOMContentLoaded", () => {
  // Apply theme on load
  const startTheme = getPreferredTheme();
  applyTheme(startTheme);

  // Hook toggle switch
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", () => {
    const newTheme = toggle.checked ? "light" : "dark";
    applyTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  });

// Roads visibility toggle in settings
const ROADS_KEY = "ema_roads_enabled";
const roadsToggle = document.getElementById("roads-toggle");

function applyRoadsSetting(enabled) {
  // Store preference
  localStorage.setItem(ROADS_KEY, enabled ? "1" : "0");

  const roadsObj = window.UserLayerManager?.repo?.major_roads;

  if (!roadsObj?.layer) {
    console.warn("⚠️ Roads layer not ready yet.");
    return;
  }

  roadsObj.active = enabled;

  // Call the roads layer internal controller
  if (roadsObj.layer.__ema?.setActive) {
    roadsObj.layer.__ema.setActive(enabled);
  }

  if (enabled) {
    if (!map.hasLayer(roadsObj.layer)) {
      roadsObj.layer.addTo(map);
    }
  } else {
    // Off means remove from map completely
    if (map.hasLayer(roadsObj.layer)) {
      map.removeLayer(roadsObj.layer);
    }
  }
}

if (roadsToggle) {
  // Load saved preference (default ON)
  const saved = localStorage.getItem(ROADS_KEY);
  const startOn = saved === null ? true : saved === "1";

  roadsToggle.checked = startOn;

  // Apply once roads layer exists
  setTimeout(() => applyRoadsSetting(startOn), 200);

  roadsToggle.addEventListener("change", () => {
    applyRoadsSetting(roadsToggle.checked);
  });
}

});
