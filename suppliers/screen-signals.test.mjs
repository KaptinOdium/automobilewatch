import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSignals} from './screen-signals.mjs';

const today = '2026-11-18';
const site = {id:'north',name:'Example works',duns:'000000001'};
const ongoing = {
  supplier:site, namedSite:true, kind:'company-city', decision:'candidate',
  event:{id:'strike', state:'ongoing', date:today, category:'strike', lastChecked:today,
    sources:[{url:'https://example.org/notice'}]}
};
const summary = (...matches) => summarizeSignals(matches.map(match => ({source:'test',match})),null,today);

test('the most urgent incident determines a supplier’s one dot and the order of its evidence',() => {
  const yellow = {...ongoing, namedSite:false, kind:'company-only'};
  const other = {...yellow,supplier:{...site,id:'south',name:'A different works'}};
  const groups = summary(other,yellow,ongoing);
  assert.deepEqual(groups.map(g=>[g.supplier.id,g.level]),[['north','red'],['south','yellow']]);
  assert.deepEqual(groups[0].items.map(i=>i.level),['red','yellow']);
});

test('an announcement, stale notice, uncited item or unverified location stays yellow',() => {
  for (const fields of [{state:'announced'},{lastChecked:'2026-11-12'},{sources:[]},{date:'2026-11-19'}])
    assert.equal(summary({...ongoing,event:{...ongoing.event,...fields}})[0].level,'yellow');
  assert.equal(summary({...ongoing,kind:'locality',namedSite:false})[0].level,'yellow');
});

test('an explicitly verified current non-strike disruption also marks the named site red',() => {
  const match = {...ongoing,event:{...ongoing.event,category:'outage',screening:{operationalImpactVerified:true}}};
  assert.equal(summary(match)[0].level,'red');
});

test('expired, cancelled and out-of-scope events are excluded, and suppliers without matches have no signal',() => {
  const ended = {...ongoing,event:{...ongoing.event,endAt:'2020-01-01T00:00:00Z'}};
  const cancelled = {...ongoing,event:{...ongoing.event,state:'cancelled'}};
  const excluded = {...ongoing,decision:'excluded'};
  assert.deepEqual(summary(ended,cancelled,excluded),[]);
  assert.deepEqual(summary(),[]);
});
