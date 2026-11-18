import { mapRows, supplierFeatures, supplierBounds } from './map-core.mjs?v=20261112-3';

const VERSION = '6.17.0';
const MODULE_URL = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.mjs`;
const CSS_URL = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
const CSS_INTEGRITY = 'sha384-S+OnE5M4U3Qc2nR0RgljGrVs06xqfRg8L7uFk/pOF5+sRuSDG4oKkqKZmFrx7w09';
const STYLES = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
const SOURCE = 'atlas-suppliers';
const CLUSTERS = 'atlas-clusters', COUNTS = 'atlas-cluster-counts', POINTS = 'atlas-points', SELECTED = 'atlas-selected';
let rendererPromise;

function abortError() { return new DOMException('Map initialization cancelled.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function bounded(promise, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}
function abortable(promise, signal) {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function loadRenderer(signal) {
  checkAbort(signal);
  if (!rendererPromise) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = CSS_URL; css.integrity = CSS_INTEGRITY; css.crossOrigin = 'anonymous';
    const stylesReady = new Promise((resolve, reject) => {
      css.onload = resolve;
      css.onerror = () => reject(new Error('The detailed map stylesheet could not load.'));
    });
    css.dataset.atlasMapStyles = VERSION; document.head.append(css);
    rendererPromise = bounded(Promise.all([import(MODULE_URL), stylesReady]), 15000,
      'The detailed map renderer could not load. The overview map is still available.').then(([module]) => module.default || module).catch(error => {
      rendererPromise = null; css.remove(); throw error;
    });
  }
  return abortable(rendererPromise, signal);
}

export async function createSupplierMap({ container, onSelect = () => {}, onStatus = () => {}, onReady = () => {}, signal } = {}) {
  if (!container) throw new Error('The detailed map container is missing.');
  const api = await loadRenderer(signal);
  checkAbort(signal);
  const host = document.createElement('div'); host.className = 'atlas-map-canvas'; container.append(host);
  let map, destroyed = false, ready = false, styleReady = false, selectedId = '', currentRows = [], styleGeneration = 0;
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const motion = reducedMotion ? 0 : 650;
  const report = (message, error = false) => { if (!destroyed) onStatus(message, error); };
  const live = () => !destroyed && !signal?.aborted;
  let timer, resolveInitial, rejectInitial;
  const initial = new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; });
  // A constructor failure or abort can happen before execution reaches await.
  initial.catch(() => {});
  function destroy() {
    if (destroyed) return;
    destroyed = true; clearTimeout(timer);
    window.removeEventListener('supplier-theme-change', changeTheme);
    window.removeEventListener('keydown', exitExpanded);
    container.closest('.mapwrap')?.classList.remove('maplibregl-pseudo-fullscreen');
    signal?.removeEventListener('abort', abort);
    currentRows = []; selectedId = '';
    try { if (map) map.remove(); }
    finally { host.remove(); if (!ready) rejectInitial(abortError()); }
  }
  function abort() { destroy(); }
  function exitExpanded(event) { if (event.key === 'Escape') container.querySelector('.maplibregl-ctrl-shrink')?.click(); }
  function installData() {
    // isStyleLoaded() becomes false while a GeoJSON source is processing. That
    // must never discard a newer filter/update; the worker accepts setData then.
    if (!live() || !styleReady) return;
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: supplierFeatures(currentRows), cluster: true, clusterMaxZoom: 15, clusterRadius: 48 });
      map.addLayer({ id: CLUSTERS, type: 'circle', source: SOURCE, filter: ['has', 'point_count'], paint: {
        'circle-color': theme === 'dark' ? '#29516b' : '#123a50',
        'circle-radius': ['step', ['get', 'point_count'], 20, 25, 25, 100, 31],
        'circle-stroke-width': 3, 'circle-stroke-color': theme === 'dark' ? '#85d4d0' : '#ffffff', 'circle-opacity': 0.95
      }});
      map.addLayer({ id: COUNTS, type: 'symbol', source: SOURCE, filter: ['has', 'point_count'], layout: {
        'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true
      }, paint: { 'text-color': '#ffffff' } });
      map.addLayer({ id: POINTS, type: 'circle', source: SOURCE, filter: ['!', ['has', 'point_count']], paint: {
        'circle-color': ['case', ['get', 'approximate'], theme === 'dark' ? '#47c8b9' : '#008577', theme === 'dark' ? '#91adff' : '#4264d9'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 5, 8, 7, 15, 9],
        'circle-stroke-width': 2.5, 'circle-stroke-color': theme === 'dark' ? '#102337' : '#ffffff', 'circle-opacity': 0.98
      }});
      map.addLayer({ id: SELECTED, type: 'circle', source: SOURCE, filter: ['==', ['get', 'supplierId'], selectedId], paint: {
        'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 14, 'circle-stroke-width': 3,
        'circle-stroke-color': theme === 'dark' ? '#f9d579' : '#ae6a17'
      }});
    } else map.getSource(SOURCE).setData(supplierFeatures(currentRows));
    map.setFilter(SELECTED, ['==', ['get', 'supplierId'], selectedId]);
  }
  async function selectCluster(feature) {
    const source = map.getSource(SOURCE), generation = styleGeneration;
    if (!source) return;
    try {
      const clusterId = Number(feature.properties.cluster_id);
      const zoom = await source.getClusterExpansionZoom(clusterId);
      if (!live() || generation !== styleGeneration) return;
      const coordinates = feature.geometry.coordinates;
      if (map.getZoom() >= 14.5) {
        const leaves = await source.getClusterLeaves(clusterId, Math.min(currentRows.length, 10000), 0);
        if (live() && generation === styleGeneration) onSelect(leaves.map(item => item.properties.supplierId));
      } else map.easeTo({ center: coordinates, zoom: Math.min(zoom, 16), duration: motion });
    } catch { report('The supplier group changed. Select it again.', false); }
  }
  function changeTheme(event) {
    const next = event.detail?.theme === 'dark' ? 'dark' : 'light';
    if (!live() || next === theme) return;
    theme = next; styleGeneration++; styleReady = false;
    map.setStyle(STYLES[theme]);
  }
  try {
    map = new api.Map({ container: host, style: STYLES[theme], center: [12, 28], zoom: 1.5, minZoom: 1, maxZoom: 19,
      attributionControl: true, cooperativeGestures: false, renderWorldCopies: true, maxPitch: 0, pitchWithRotate: false,
      dragRotate: false, touchPitch: false, canvasContextAttributes: { antialias: true } });
    map.touchZoomRotate.disableRotation();
    map.addControl(new api.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    map.addControl(new api.FullscreenControl({ container: container.closest('.mapwrap') || container, pseudo: true }), 'top-right');
    map.getCanvas().setAttribute('aria-label', 'Detailed supplier map. Use arrow keys to pan, plus and minus to zoom.');
    signal?.addEventListener('abort', abort, { once: true });
    checkAbort(signal);
    timer = setTimeout(() => { if (!ready) rejectInitial(new Error('The detailed map could not load. The overview map is still available.')); }, 18000);
    map.on('style.load', () => {
      if (!live()) return;
      if(theme==='dark')for(const layer of map.getStyle().layers||[]){if(layer.type==='symbol'&&layer.layout?.['text-field']){map.setPaintProperty(layer.id,'text-color','#a5b6c3');map.setPaintProperty(layer.id,'text-halo-color','#101820');map.setPaintProperty(layer.id,'text-halo-width',1);}}

      styleReady = true;
      installData();
      if (!ready) { ready = true; clearTimeout(timer); resolveInitial(); onReady(); }
      report('Street map · OpenFreeMap / OpenStreetMap');
    });
    map.on('error', event => {
      if (!live()) return;
      if (!ready) rejectInitial(new Error('The detailed map could not load. The overview map is still available.'));
      else report('Some map detail is unavailable. Supplier markers and the register remain available.', true);
    });
    map.on('click', async event => {
      if (!live() || !map.getLayer(POINTS)) return;
      const features = map.queryRenderedFeatures(event.point, { layers: [CLUSTERS, POINTS] });
      if (!features.length) return;
      const cluster = features.find(feature => feature.properties.cluster_id !== undefined);
      if (cluster) return selectCluster(cluster);
      const first = features[0], coordinates = first.geometry.coordinates;
      // Points at the same position remain individually accessible after clusters split.
      const ids = currentRows.filter(row => Math.abs(row.lon - coordinates[0]) < 0.000001 && Math.abs(Math.max(-85.051129, Math.min(85.051129, row.lat)) - coordinates[1]) < 0.000001).map(row => row.id);
      selectedId = String(first.properties.supplierId || '');
      map.setFilter(SELECTED, ['==', ['get', 'supplierId'], selectedId]);
      onSelect(ids.length ? ids : [selectedId]);
    });
    map.on('mousemove', event => {
      if (!live() || !map.getLayer(POINTS)) return;
      map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers: [CLUSTERS, POINTS] }).length ? 'pointer' : '';
    });
    window.addEventListener('supplier-theme-change', changeTheme);
    window.addEventListener('keydown', exitExpanded);
    await abortable(initial, signal);
    checkAbort(signal);
    return {
      update(rows) { if (!live()) return; currentRows = mapRows(rows).map(row => ({ id: row.id, lat: row.lat, lon: row.lon, precision: row.precision })); if (!currentRows.some(row => row.id === selectedId)) selectedId = ''; installData(); },
      fit(rows = currentRows) { if (!live()) return; const bounds = supplierBounds(rows); if (!bounds) return this.world(); map.fitBounds(bounds, { padding: { top: 65, bottom: 85, left: 55, right: 55 }, maxZoom: 11, duration: motion }); },
      world() { if (live()) map.easeTo({ center: [12, 28], zoom: 1.5, bearing: 0, pitch: 0, duration: motion }); },
      europe() { if (live()) map.fitBounds([[-15, 34], [38, 67]], { padding: 35, duration: motion }); },
      zoom(factor) { if (live() && Number.isFinite(factor) && factor > 0) map.zoomTo(map.getZoom() - Math.log2(factor), { duration: reducedMotion ? 0 : 250 }); },
      focus(row) { if (!live() || !mapRows([row]).length) return; selectedId = row.id; if (map.getLayer(SELECTED)) map.setFilter(SELECTED, ['==', ['get', 'supplierId'], selectedId]); map.easeTo({ center: [row.lon, Math.max(-85.051129, Math.min(85.051129, row.lat))], zoom: Math.max(map.getZoom(), 10), duration: motion }); },
      resize() { if (live()) map.resize(); },
      destroy
    };
  } catch (error) { destroy(); throw error; }
}
