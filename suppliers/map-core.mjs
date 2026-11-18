// Geographic data stays in the browser. No supplier labels or identifiers are
// sent to the basemap provider; IDs below are consumed only by the local worker.
export function mapRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && typeof row.id === 'string' && row.id &&
    Number.isFinite(row.lat) && Number.isFinite(row.lon) &&
    Math.abs(row.lat) <= 90 && Math.abs(row.lon) <= 180);
}

export function supplierFeatures(rows) {
  return {
    type: 'FeatureCollection',
    features: mapRows(rows).map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lon, Math.max(-85.051129, Math.min(85.051129, row.lat))] },
      properties: { supplierId: row.id, approximate: row.precision === 'Approximate city' }
    }))
  };
}

// Remove the largest gap in circular longitude space before fitting. A network
// either side of the date line should fit the Pacific, not almost the whole map.
export function supplierBounds(rows) {
  const points = mapRows(rows);
  if (!points.length) return null;
  const longitudes = points.map(row => ((row.lon % 360) + 360) % 360).sort((a, b) => a - b);
  let biggest = -1, gapIndex = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = i + 1 === longitudes.length ? longitudes[0] + 360 : longitudes[i + 1];
    if (next - longitudes[i] > biggest) { biggest = next - longitudes[i]; gapIndex = i; }
  }
  let west = longitudes[(gapIndex + 1) % longitudes.length];
  let east = longitudes[gapIndex];
  if (east < west) east += 360;
  if ((west + east) / 2 > 180) { west -= 360; east -= 360; }
  const latitudes = points.map(row => Math.max(-85.051129, Math.min(85.051129, row.lat)));
  return [[west, Math.min(...latitudes)], [east, Math.max(...latitudes)]];
}
