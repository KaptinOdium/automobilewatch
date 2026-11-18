import test from 'node:test';
import assert from 'node:assert/strict';
import {loadHazardLeads, hazardSourceURL} from './screen-hazards.mjs';

const now = Date.parse('2026-11-18T11:00:00Z');
const supplier = {name:'Example Parts Ltd.', city:'York', country:'United Kingdom'};
const incident = {
  id: 1, type: 'fire', type_label: 'Fire', title: 'Example Parts factory evacuated in York',
  occurred_at:'2026-11-18 10:00:00', source:'press', country:'United Kingdom', severity_label:'Moderate',
  url:'https://news.example/fire', permalink:'https://globalincidenttracker.com/incident/example-1'
};
const run = (rows, suppliers = [supplier]) => loadHazardLeads(suppliers, {
  now, fetcher: async (url, options) => {
    assert.equal(url, hazardSourceURL);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.body, undefined);
    return {ok:true, json:async () => ({count:rows.length, incidents:rows})};
  }
});

test('links published evidence and returns local review leads with no supplier identifiers in the source request', async () => {
  const result = await run([incident, incident]);
  assert.equal(result.consideredCount, 1);
  assert.equal(result.recordCount, 2);
  assert.deepEqual(result.matches.map(m => [m.kind,m.decision]), [['company-city','unreviewed']]);
  assert.deepEqual(result.matches[0].event.sources.map(s => s.url), [incident.permalink,incident.url]);
  assert.equal(result.checkedAt, '2026-11-18T11:00:00.000Z');
});

test('distinguishes forecast areas, ambiguous country overlap, county ranges and longer city names', async () => {
  const warning = {...incident, source:'meteoalarm', type:'storm', occurred_at:'2026-11-19 09:00:00', title:'Coastal warning — York'};
  const others = [
    {...warning, id:2, title:'Coastal warning — New York'},
    {...warning, id:3, title:'Coastal warning — York County'},
    {...warning, id:4, country:'France'}, {...warning, id:5, title:'Nationwide warning'}
  ];
  const {matches} = await run([warning,...others]);
  assert.deepEqual(matches.map(m => m.kind), ['locality']);
  assert.match(matches[0].reason, /Forecast/);
});

test('filters past and future reports, distant forecasts, raw seismic observations and unsafe source URLs', async () => {
  const {matches} = await run([
    {...incident,id:2,occurred_at:'2026-11-16 10:00:00'},
    {...incident,id:3,occurred_at:'2026-11-19 10:00:00'},
    {...incident,id:4,source:'nws',occurred_at:'2026-11-28 10:00:00'},
    {...incident,id:5,type:'earthquake',title:'M3.0 Earthquake — York'},
    {...incident,id:6,permalink:'https://example.net/incident/false-report'},
    {...incident,id:7,permalink:'javascript:alert(1)'}
  ]);
  assert.deepEqual(matches, []);
});

test('failed reads are distinct from a successful zero-result scan', async () => {
  const empty = await run([]);
  assert.deepEqual(empty.matches, []);
  await assert.rejects(loadHazardLeads([], {fetcher:async()=>({ok:false})}), /unavailable/);
  await assert.rejects(loadHazardLeads([], {fetcher:async()=>({ok:true,json:async()=>({})})}), /unsupported/);
});

test('coalesces and caches public reads but rematches each list and preserves the original retrieval time', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return {ok:true, json:async () => ({count:1, incidents:[incident]})};
  };
  const [withSupplier, empty] = await Promise.all([
    loadHazardLeads([supplier], {fetcher, now}), loadHazardLeads([], {fetcher, now})
  ]);
  assert.equal(calls, 1);
  assert.equal(withSupplier.matches.length, 1);
  assert.deepEqual(empty.matches, []);
  assert.equal((await loadHazardLeads([], {fetcher, now:now+10000})).checkedAt, empty.checkedAt);
  assert.equal(calls, 1);
  const forced = await loadHazardLeads([], {fetcher, now:now+20000, force:true});
  assert.equal(calls, 2);
  assert.notEqual(forced.checkedAt, empty.checkedAt);
  await loadHazardLeads([], {fetcher, now:now+321000});
  assert.equal(calls, 3);
});
