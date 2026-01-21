// scripts/panels.js
// ---------------------------------------------
// Controls switching between sidebar icon buttons
// and the panels in the tool panel area.
// ---------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // 1) Groups ALL sidebar icon buttons on the left
  const panelButtons = document.querySelectorAll("#icon-bar .icon-btn");

  // 2) Groups ALL panels inside the tool-panel area
  const panels = document.querySelectorAll("#tool-panel .tool-panel-section");

//--------------------------------------------------------------------------------

  // Error Safety checker if nothing is found so the script stops
  if (!panelButtons.length || !panels.length) {
    console.warn("Panel switcher: No buttons or panels found.");
    return;
  }
//--------------------------------------------------------------------------------



  // -----------------------------------------
  // Helper function:
  // Show ONLY the panel for the clicked icon
  // ------------------------------------------
  function showPanel(panelIdToShow) {
    panels.forEach((panel) => {
      panel.hidden = panel.id !== panelIdToShow;
    });

    // Update button states (aria-pressed)
    panelButtons.forEach((btn) => {
      const btnPanelId = btn.getAttribute("data-panel");
      const isActive = btnPanelId === panelIdToShow;
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  // -------------------------------------------------
  // Find the panel that should be visible on page load
  // -------------------------------------------------
  let defaultPanelId = null;

  panelButtons.forEach((btn) => {
    if (btn.getAttribute("aria-pressed") === "true") {
      defaultPanelId = btn.getAttribute("data-panel");
    }
  });

  // If nothing was set as pressed, fall back to "panel-overview"
  if (!defaultPanelId) {
    defaultPanelId = "panel-overview";
  }

  // Show the default panel
  showPanel(defaultPanelId);

  // ---------------------------------
  // Add click events to each icon-btn
  // ---------------------------------
  panelButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const panelId = btn.getAttribute("data-panel");
      if (!panelId) return;

      if (typeof window.openToolPanel === "function") {
        window.openToolPanel();
      }
      showPanel(panelId);
    });
  });
});
