import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {matchSuppliers} from './screen-matches.mjs';

// Load the dashboard's browser script the same way the Atlas page does.
const browser = {window: {}};
runInNewContext(readFileSync(new URL('../strike-core.js', import.meta.url), 'utf8'), browser);
const core = browser.window.StrikeCore;
const today = '2026-11-18';
const supplier = (name, city = 'Montréal', country = 'Canada') => ({name, city, country});
const site = {
  id: 'site-1', company: 'Example Components Ltd. · Industrial Workers Union',
  country: 'Canada', site: 'Montreal plant, Quebec', scope: 'named-site',
  date: '2026-11-20', category: 'strike', state: 'announced',
  screening: {decision: 'candidate', reason: 'Continuous action scheduled at this site.'}
};
const run = (suppliers, events = [site], watchlist = []) =>
  matchSuppliers(suppliers, {events, watchlist}, core, today);

test('compares a named employer and locality, preserving the original FWS decision, rationale and register row', () => {
  const row = supplier('EXAMPLE COMPONENTS, INC.');
  const [match] = run([row]);
  assert.deepEqual(match, {
    supplier: row, event: site, decision: 'candidate', reason: site.screening.reason,
    basis: 'Company name and reported city match; verify the operating site', kind: 'company-city', namedSite: true
  });
});

test('excludes unrelated businesses, similar substrings, the union, wrong countries and other named-site branches', () => {
  assert.deepEqual(run([
    supplier('Unrelated Logistics'), supplier('Example Component'), supplier('Industrial Workers Union'),
    supplier('Example Components', 'Montreal', 'France'), supplier('Example Components', 'Ottawa'),
    supplier('Example Components', 'Real'), supplier('Example Components', 'Treál')
  ]), []);
  assert.deepEqual(run([supplier('Example Components')], [{...site, company: 'Cross-sector · Regional unions', scope: 'nationwide'}]), []);
});

test('a nonidentical business unit needs city corroboration and stays a review lead', () => {
  const [match] = run([supplier('Example Components Canada Ltd'), supplier('Example Components Canada Ltd', 'Calgary')]);
  assert.equal(match.basis, 'Similar company name and reported city; verify the legal entity and site');
  assert.equal(run([supplier('Example Components Canada Ltd', 'Calgary')]).length, 0);
});

test('matches a city with an administrative suffix without matching other sites in the county', () => {
  const right = supplier('Example Components', 'Montréal, QC');
  const other = supplier('Example Components', 'Laval, QC');
  assert.deepEqual(run([right, other]).map(m => m.supplier), [right]);
});

test('handles composite employer and city fields without claiming a pairing or delivery impact', () => {
  const event = {...site, company: 'Different Industries / Example Components Ltd', site: 'Québec City and Montréal, Quebec'};
  const [match] = run([supplier('Example Components')], [event]);
  assert.equal(match.event, event);
  assert.match(match.basis, /verify the operating site/);
});

test('retains company-only watches as site-unverified and keeps foreign subsidiaries out', () => {
  const event = {...site, date: null, category: 'risk', state: 'risk', scope: 'company',
    site: null, country: 'United States', screening: {decision: 'watch', reason: 'Bargaining update.'}};
  const result = run([supplier('Example Components', 'Buffalo', 'United States of America'),
    supplier('Example Components', 'Toronto', 'Canada')], [], [event]);
  assert.equal(result.length, 1);
  assert.equal(result[0].decision, 'watch');
  assert.match(result[0].basis, /site unverified/);
});

test('uses runtime decisions for closed, stale and excluded incidents', () => {
  const stale = {...site, state: 'ongoing', date: '2026-11-01', lastChecked: '2026-11-03'};
  const rows = run([supplier('Example Components')], [
    {...site, state: 'cancelled'}, {...site, date: '2026-11-01'},
    {...site, screening: {decision: 'excluded', reason: 'Below threshold.'}}, stale
  ]);
  assert.deepEqual(rows.map(m => [m.event, m.decision]), [[stale, 'watch']]);
  assert.match(rows[0].reason, /reconfirmation/);
});

test('a company-scope hearing in a named city cannot match a distant branch', () => {
  assert.equal(run([supplier('Example Components','Calgary')],[{...site,scope:'company',site:'Montréal'}]).length,0);
});

test('an explicitly reviewed locality produces only a watch, even for a candidate incident', () => {
  const nearby = supplier('Unrelated Works');
  const other = supplier('Faraway Works','Calgary');
  const hazard = {...site, company:'', screening:{...site.screening,localityReview:[{city:'Montreal',country:'Canada'}]}};
  const [match] = run([nearby, other],[hazard]);
  assert.equal(match.supplier, nearby);
  assert.equal(match.decision, 'watch');
  assert.match(match.basis, /locality/);
  assert.deepEqual(run([nearby],[{...hazard,screening:{...site.screening}}]),[]);
});
