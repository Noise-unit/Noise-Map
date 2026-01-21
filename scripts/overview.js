// scripts/overview.js
// ----------------------------------------------------
// Overview panel values (Noise map)
// ----------------------------------------------------

window.OverviewConfig = window.OverviewConfig || {
  dataFolderLink: "https://drive.google.com/drive/folders/139H73GKeLnDXwqWwc60kmA1UkxYytM7V?usp=drive_link",
  eventVariations: "https://docs.google.com/spreadsheets/d/1ro2RikBI665e5VLKk8MPUylEkAEJIhfKeBo46AGimLo/edit?usp=drive_link",
  //noiseEmissions: "https://docs.google.com/spreadsheets/d/1p61zrvjZTi5lBTAmQ3PWDRpI9J8xPq7_L7vX9oakvp0/edit?usp=drive_link",
  gmailUsername: "",
  gmailPassword: "",
  githubUsername: "",
  githubPassword: "",
};

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.OverviewConfig;

  const linkEl = document.getElementById("overview-data-folder-link");
  if (linkEl && cfg.dataFolderLink) linkEl.href = cfg.dataFolderLink;

  const linkE2 = document.getElementById("overview-event-variations-link");
  if (linkE2 && cfg.eventVariations) linkE2.href = cfg.eventVariations;

/*
  const linkE3 = document.getElementById("overview-noise-emissions-link");
  if (linkE3 && cfg.noiseEmissions) linkE3.href = cfg.noiseEmissions;
*/
  const gmailUserEl = document.getElementById("overview-gmail-user");
  if (gmailUserEl) gmailUserEl.textContent = cfg.gmailUsername || "unitnoise3@gmail.com";

  const gmailPassEl = document.getElementById("overview-gmail-pass");
  if (gmailPassEl) gmailPassEl.textContent = cfg.gmailPassword || "Password100%";

  const ghUserEl = document.getElementById("overview-github-user");
  if (ghUserEl) ghUserEl.textContent = cfg.githubUsername || "Noise-unit";

  const ghPassEl = document.getElementById("overview-github-pass");
  if (ghPassEl) ghPassEl.textContent = cfg.githubPassword || "Noiseunit3";
});
