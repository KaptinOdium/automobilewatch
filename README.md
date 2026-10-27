# Automobile Watch

Public dashboard: https://kaptinodium.github.io/automobilewatch/

This repository contains the static Auto Strike Watch interface for GitHub Pages. Publish the repository root using GitHub Pages.

The dashboard loads live, read-only calendar data from:

https://auto-strike-watch-vw-oct-2026.speedycomet512.chatgpt.site/api/calendar

Daily research and data storage remain on the existing Sites backend. While open, the dashboard checks for saved updates every five minutes. The API allows the GitHub Pages origin through CORS; requests do not send credentials.

If the API is unavailable, the bundled `data.js` snapshot is displayed with a warning and its recorded update time. Later refresh failures retain the last successfully loaded data. Static assets and map data use relative paths so the project URL works correctly.

Country dots indicate approximate country scope, not exact factory locations. See [map attribution](MAP-ATTRIBUTION.md).
