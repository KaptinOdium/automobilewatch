const test = require('node:test');
const assert = require('node:assert/strict');
const {merge,status,screening} = require('./strike-core.js');
test('stale API cannot reinstate a suspended or postponed call',()=>{
  const live={updatedAt:'2026-11-12T09:00:00Z',events:[{id:'old',date:'2026-11-12',state:'announced',lastChecked:'2026-11-10'}],watchlist:[]};
  const curated={asOf:'2026-11-11',events:[{id:'new',aliases:['old'],date:'2026-11-12',state:'suspended',lastChecked:'2026-11-11'}],watchlist:[]};
  const result=merge(live,curated);assert.equal(result.events.length,1);assert.equal(result.events[0].state,'suspended');assert.equal(screening(result.events[0],'2026-11-12').decision,'closed');
});
test('newer per-record evidence can replace reviewed state',()=>{
  const result=merge({events:[{id:'same',date:'2026-11-10',state:'ended',lastChecked:'2026-11-12'}]}, {events:[{id:'same',date:'2026-11-10',state:'ongoing',lastChecked:'2026-11-11'}]});
  assert.equal(result.events[0].state,'ended');
});
test('history and unrelated API additions survive with their original check dates',()=>{
  const result=merge({rangeStart:'2026-11-12',rangeEnd:'2027-02-12',events:[{id:'remote',date:'2026-12-10',lastChecked:'2026-11-11'}]}, {rangeStart:'2026-10-02',events:[{id:'history',date:'2026-10-20',lastChecked:'2026-10-21'}]});
  assert.equal(result.events.length,2);assert.equal(result.rangeStart,'2026-10-02');assert.equal(result.events.find(e=>e.id==='history').lastChecked,'2026-10-21');
});
test('a targeted save does not overwrite newer worldwide coverage with an older snapshot',()=>{
 const result=merge({asOf:'2026-11-11',coverage:[{region:'Europe',checkedAt:'2026-11-11',note:'Newer coverage'}],sourceRegistry:[{url:'https://example.com/new'}]}, {asOf:'2026-11-12',coverage:[{region:'Europe',checkedAt:'2026-10-27',note:'Old coverage'}],sourceRegistry:[{url:'https://example.com/old'}]});
 assert.equal(result.coverage[0].checkedAt,'2026-11-11');assert.equal(result.sourceRegistry.length,2);
});
test('undated replacement does not leave a duplicate dated event',()=>{
  const result=merge({events:[{id:'old',date:'2026-11-12',lastChecked:'2026-11-10'}]}, {watchlist:[{id:'new',aliases:['old'],state:'postponed',lastChecked:'2026-11-11'}]});
  assert.equal(result.events.length,0);assert.equal(result.watchlist.length,1);
});
test('ongoing evidence expires without inventing an end date',()=>{
  const row={state:'ongoing',date:'2026-10-24',lastChecked:'2026-11-08'};
  assert.equal(status(row,'2026-11-12'),'unverified');assert.equal(row.endDate,undefined);
  assert.equal(status({...row,lastChecked:'2026-11-11'},'2026-11-12'),'ongoing');
});
test('ordinary short action is not automatically eligible',()=>{
  assert.equal(screening({category:'strike',state:'announced',date:'2026-11-13'},'2026-11-12').decision,'unreviewed');
});
test('an exact published end time does not stay active for the rest of the date',()=>{
  const row={state:'ongoing',date:'2026-11-10',endDate:'2026-11-12',endAt:'2026-11-12T06:00:00+02:00',lastChecked:'2026-11-11'};
  assert.equal(status(row,'2026-11-12',Date.parse('2026-11-12T03:59:59Z')),'ongoing');
  assert.equal(status(row,'2026-11-12',Date.parse('2026-11-12T04:00:00Z')),'past');
});
const calendar=require('./screened-calendar.json');
const all=[...calendar.events,...calendar.watchlist];
test('calendar retains cancellations, distinct POSCO actions and the corrected SEMAF dates',()=>{
  assert.equal(all.find(e=>e.id==='korea-posco-20261102').state,'cancelled');
  assert.equal(all.find(e=>e.id==='korea-posco-overtime-ban-20261110').screening.decision,'watch');
  assert.equal(all.find(e=>e.id==='DE-SWEG-2026-11-12').state,'cancelled');
  assert.equal(all.find(e=>e.id==='IE-PUBLIC-2026-11-12').state,'cancelled');
  assert.equal(all.find(e=>e.id==='spain-renfe-drivers-20261112').state,'postponed');
  assert.equal(all.find(e=>e.id==='spain-semaf-20261123').state,'announced');
  assert.equal(all.filter(e=>e.date==='2026-11-12'&&/SEMAF|Renfe/.test(e.title)&&e.state==='announced').length,0);
});
test('KOSTAL separated short actions never qualify as a continuous full-day strike',()=>{
 const rows=all.filter(e=>e.id.startsWith('ireland-kostal'));
 assert.deepEqual(rows.map(e=>e.screening.durationHours),[4,4,2]);
 assert.ok(rows.every(e=>e.screening.decision==='watch'&&e.date===e.endDate));
});
test('every retained calendar candidate has dated evidence and an explicit screening decision',()=>{
 assert.equal(new Set(all.map(e=>e.id)).size,all.length);
 assert.ok(all.every(e=>e.lastChecked&&e.sources?.length&&e.screening?.decision));
 assert.ok(!all.some(e=>e.id.includes('HALIFAX')));
});
