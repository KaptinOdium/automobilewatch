# Automobile Watch

Public dashboard: https://kaptinodium.github.io/automobilewatch/

This repository contains the static Auto Strike Watch interface for GitHub Pages. Publish the repository root using GitHub Pages.

The dashboard loads live, read-only calendar data from:

https://auto-strike-watch-vw-oct-2026.speedycomet512.chatgpt.site/api/calendar

Daily research and data storage remain on the existing Sites backend. While open, the dashboard checks for saved updates every five minutes. The API allows the GitHub Pages origin through CORS; requests do not send credentials.

The bundled `data.js` is shown immediately and reconciled with the live response. `strike-core.js` matches explicit IDs/aliases and uses each record's evidence date, so an older API record cannot reinstate a cancelled or postponed strike. Newer API evidence and unrelated additions remain available. If the API is unavailable, the saved list remains visible with a warning. Static assets and map data use relative paths so the project URL works correctly.

The 12 November reconciliation uses the current backend calendar plus saved 6–11 November screening registers and targeted primary-source updates. It preserves 72 dated entries and 6 undated watches, with a decision and evidence date for each. It is not a new exhaustive worldwide scan. `screened-calendar.json` contains the same history-inclusive payload as `data.js`; backend publication uses the same records within a 12 November–11 February planning window. Save timestamps do not replace individual source-check dates or the retained 11 November regional coverage.

FWS decisions distinguish exact-site exposure checks, preliminary internal alerts, watches, excluded candidates and closed actions. A normal industrial stoppage must be continuous for at least 24 hours, or cause material production/delivery loss when shorter. Separated short windows are not added together. P-Mat uses the latest 12 months; A-Mat Orders uses 2024–2026 as the primary view, with the latest 12 months as fallback; A-Mat Sourcing is supporting. Internal supplier exposure is not asserted from public records. All statuses are shown by default, including historical outcomes, and the additional FWS filter is under **More filters**.

Known cancellations and postponements remain explicit. An ongoing label older than three days requires reconfirmation; an exact published end time expires the active state at that instant. Country/group scope, legal minimum-service percentages and union participation claims do not establish factory shutdowns or affected Volkswagen deliveries. Halifax's ratification/holiday gate restrictions are explicitly excluded from the strike list because they are not a strike.

Run the meaningful merge, lifecycle and data-safety checks with `node --test strike-core.test.cjs`.

Country dots indicate approximate country scope, not exact factory locations. See [map attribution](MAP-ATTRIBUTION.md).

Hover or keyboard-focus a country dot for dates and affected groups; select it to focus the map and filter entries. Use World/Europe presets or the zoom controls, then drag to pan. With the map focused, arrow keys pan, +/− zoom and Home resets the view. Escape dismisses previews. Only strikes reported ongoing pulse; reduced-motion preferences disable camera animation and show a static ongoing ring.

The date timeline starts in **All dates** mode. Drag the slider, step a day, or press Play to explore a single date across the map, dated counts, list, calendar and exports. The timeline uses the current dataset's planning window and respects other filters. Published end dates are inclusive; an unknown end is not extended into future dates. A reported ongoing event with no end date can also appear on today's date. The undated watchlist remains separate. Playback pauses when the tab is hidden or a brief is opened and stops at the end of the window.


## Supplier Atlas

Supplier workspace: https://kaptinodium.github.io/automobilewatch/suppliers/

The Suppliers link opens a private shared supplier-map interface inside this GitHub Pages site. CSV/TSV import and Excel paste preserve supplier names and DUNS strings; city/country matching uses the bundled GeoNames gazetteer, with coordinate review, map filters, CSV export, and explicit shared saves. City matches are approximate, not verified factory positions.

**Activation is pending:** the page remains locked until the owner-controlled Supabase account service is configured. See [account setup](suppliers/setup/README.md) for the schema, invited members, public browser settings, and required live access checks. No supplier records, credentials, or private keys belong in this public repository.

Run supplier checks with `node --test suppliers/*.test.mjs`. The client tests use controlled responses; they do not verify a live Supabase project.
