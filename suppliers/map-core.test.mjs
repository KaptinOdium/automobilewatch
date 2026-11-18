import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRows, supplierFeatures, supplierMapSource, supplierBounds } from './map-core.mjs';

test('map data excludes invalid points and keeps supplier identity details out of feature properties', () => {
  const rows = [{id:'s1',name:'Private name',duns:'0000123',lat:50,lon:14,precision:'Approximate city'}, {id:'bad',lat:null,lon:4}, {id:'bad2',lat:91,lon:5}, {id:'bad3',lat:0,lon:Infinity}];
  assert.equal(mapRows(rows).length,1);
  const data=supplierFeatures(rows);
  assert.deepEqual(data.features[0].properties,{supplierId:'s1',signalRank:0});
  assert.deepEqual(data.features[0].geometry.coordinates,[14,50]);
  assert.equal(JSON.stringify(data).includes('Private name'),false);
  assert.equal(JSON.stringify(data).includes('0000123'),false);
});

test('clusters keep the most serious member signal as zoom changes and refresh clears old ranks', () => {
  const suppliers = [
    {id:'neutral',lat:50,lon:14}, {id:'yellow',lat:50,lon:14,screeningLevel:'yellow'},
    {id:'red',lat:50.6,lon:14.6,screeningLevel:'red'}
  ];
  const source = supplierMapSource(suppliers);
  // MapLibre uses the same reducer for clusters of points and clusters of clusters.
  assert.deepEqual(source.clusterProperties.signalRank, ['max', ['get','signalRank']]);
  const ranks = source.data.features.map(f => f.properties.signalRank);
  assert.deepEqual(ranks, [0,1,2]);
  const [neutral,yellow,red] = ranks;
  const coincident = Math.max(neutral,yellow);
  assert.equal(coincident, 1);
  assert.equal(Math.max(coincident,red), 2);
  const cleared = supplierFeatures(suppliers.map(({screeningLevel,...row}) => row));
  assert.deepEqual(cleared.features.map(f=>f.properties.signalRank),[0,0,0]);
});
test('fitting uses the short longitude arc at the date line', () => {
  const bounds=supplierBounds([{id:'a',lat:10,lon:179},{id:'b',lat:-5,lon:-179}]);
  assert.equal(bounds[1][0]-bounds[0][0],2);
  assert.deepEqual([bounds[0][1],bounds[1][1]],[-5,10]);
});
test('empty fits and single-point fits remain valid', () => {
  assert.equal(supplierBounds([]),null);
  assert.deepEqual(supplierBounds([{id:'a',lat:50,lon:14}]),[[14,50],[14,50]]);
});
test('Mercator clamps display latitude without mutating supplier coordinates', () => {
  const row={id:'pole',lat:90,lon:0};
  assert.equal(supplierFeatures([row]).features[0].geometry.coordinates[1],85.051129);
  assert.equal(row.lat,90);
});
