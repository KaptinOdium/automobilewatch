# Supplier Atlas map and data sources

Detailed map: [OpenFreeMap](https://openfreemap.org/), using Liberty and Dark styles, rendered with [MapLibre GL JS](https://maplibre.org/). Basemap attribution: OpenFreeMap © OpenMapTiles · Data from [OpenStreetMap](https://www.openstreetmap.org/copyright). Attribution is displayed on the interactive map. MapLibre GL JS 6.17.0 is loaded from jsDelivr at a pinned version with a SHA-384 integrity check on its stylesheet; its license is BSD-3-Clause. OpenFreeMap supports commercial and non-commercial use without an API key or billing account. The public service has no availability guarantee.

Map requests disclose the viewed map area to the basemap service. Supplier names and DUNS are not transmitted to the map service; supplier dots are generated from in-memory GeoJSON in the browser. Detailed map scripts and tiles load only after account and membership checks.

Fallback world map: Natural Earth, public-domain 1:110m country geometry, derived from the user's existing Automobile Watch map. Small countries and territories may not have visible polygons; supplier dots still use their geographic coordinates. https://www.naturalearthdata.com/about/terms-of-use/

Offline cities: GeoNames cities15000, downloaded 12 November 2026. 34,214 records. Fields retained: name, ASCII name, alternate names, latitude, longitude, ISO country code, region code and population. Licensed CC BY 4.0: https://www.geonames.org/ and https://creativecommons.org/licenses/by/4.0/. This is a city gazetteer, not a complete list of towns, a supplier directory or a factory-address database.

Optional online lookup: OpenStreetMap Nominatim. City and country only, explicitly enabled and triggered by the user. Single-threaded batches up to 20 unique places, a minimum 1.2-second pause between requests, in-memory cache and a 15-second request timeout. Online candidates always require user review. No automatic requests on import, no autocomplete, no supplier names or DUNS sent. For large datasets use imported coordinates and offline matching. https://operations.osmfoundation.org/policies/nominatim/ and https://www.openstreetmap.org/copyright

Supplier identities in the demo are fictional. Demo city coordinates are illustrative city centres. User-supplied coordinates are labelled as supplied, not independently verified.
