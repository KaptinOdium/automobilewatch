# Supplier Atlas data sources

World map: Natural Earth, public-domain 1:110m country geometry, derived from the user's existing Automobile Watch map. Small countries and territories may not have visible polygons; supplier dots still use their geographic coordinates. https://www.naturalearthdata.com/about/terms-of-use/

Offline cities: GeoNames cities15000, downloaded 12 November 2026. 34,214 records. Fields retained: name, ASCII name, alternate names, latitude, longitude, ISO country code, region code and population. Licensed CC BY 4.0: https://www.geonames.org/ and https://creativecommons.org/licenses/by/4.0/. This is a city gazetteer, not a complete list of towns, a supplier directory or a factory-address database.

Optional online lookup: OpenStreetMap Nominatim. City and country only, explicitly enabled and triggered by the user. Single-threaded batches up to 20 unique places, a minimum 1.2-second pause between requests, in-memory cache and a 15-second request timeout. Online candidates always require user review. No automatic requests on import, no autocomplete, no supplier names or DUNS sent. For large datasets use imported coordinates and offline matching. https://operations.osmfoundation.org/policies/nominatim/ and https://www.openstreetmap.org/copyright

Supplier identities in the demo are fictional. Demo city coordinates are illustrative city centres. User-supplied coordinates are labelled as supplied, not independently verified.
