// scripts/toolpanelToggle.js
// ----------------------------------------------------
// Toggle collapse/expand of ONLY the tool panel
// Icon bar + header remains visible
// ----------------------------------------------------

console.log("✅ toolpanelToggle.js loaded"); 

document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("panel-toggle");
  if (!toggleBtn) {
    console.warn("❌ panel-toggle button not found.");
    return;
  }

  // persist user preference
  const KEY = "toolpanel-collapsed";

  function setCollapsed(isCollapsed) {
    document.body.classList.toggle("toolpanel-collapsed", isCollapsed);

    // Update button accessibility + text
    toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
    toggleBtn.setAttribute(
      "aria-label",
      isCollapsed ? "Expand tool panel" : "Collapse tool panel"
    );
    toggleBtn.title = isCollapsed ? "Expand panel" : "Collapse panel";

    toggleBtn.textContent = isCollapsed ? "▶" : "◀";

    // Save preference
    localStorage.setItem(KEY, isCollapsed ? "1" : "0");

    // ✅ Force Leaflet to re-measure map size after layout changes
    if (typeof map !== "undefined" && map && map.invalidateSize) {
      requestAnimationFrame(() => {
        map.invalidateSize(true);
      });

      // In case there’s a CSS transition, invalidate again shortly after
      setTimeout(() => {
        map.invalidateSize(true);
      }, 350);
    }
  }

  // Load saved state (default is open)
  const saved = localStorage.getItem(KEY);
  const startCollapsed = saved === "1";
  setCollapsed(startCollapsed);

  // Click button = toggle
  toggleBtn.addEventListener("click", () => {
    const currentlyCollapsed = document.body.classList.contains("toolpanel-collapsed");
    setCollapsed(!currentlyCollapsed);
  });

  // Expose a helper globally so panel.js can reopen it
  window.openToolPanel = function () {
    setCollapsed(false);
  };
});
