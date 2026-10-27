# Automobile Watch

Public dashboard: https://kaptinodium.github.io/automobilewatch/

This repository contains the static Auto Strike Watch interface for GitHub Pages. Publish the repository root using GitHub Pages.

The dashboard loads live, read-only calendar data from:

https://auto-strike-watch-vw-oct-2026.speedycomet512.chatgpt.site/api/calendar

Daily research and data storage remain on the existing Sites backend. While open, the dashboard checks for saved updates every five minutes. The API allows the GitHub Pages origin through CORS; requests do not send credentials.

If the API is unavailable, the bundled `data.js` snapshot is displayed with a warning and its recorded update time. Later refresh failures retain the last successfully loaded data. Static assets and map data use relative paths so the project URL works correctly.

Country dots indicate approximate country scope, not exact factory locations. See [map attribution](MAP-ATTRIBUTION.md).

Hover or keyboard-focus a country dot for dates and affected groups; select it to focus the map and filter entries. Use World/Europe presets or the zoom controls, then drag to pan. With the map focused, arrow keys pan, +/− zoom and Home resets the view. Escape dismisses previews. Only strikes reported ongoing pulse; reduced-motion preferences disable camera animation and show a static ongoing ring.
