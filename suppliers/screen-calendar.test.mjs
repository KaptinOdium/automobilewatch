import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCalendar, readPrivateRegister} from './screen-calendar.mjs';

const saved = {asOf:'2026-11-12',events:[],watchlist:[]};
const live = {asOf:'2026-11-18',events:[{id:'open',title:'Reviewed event'}],watchlist:[]};
const merge = {merge:(primary, fallback) => primary || fallback};
const response = body => ({ok:true,json:async()=>body});

test('requests only the two public calendars and handles the hosted API envelope',async () => {
  const urls = [];
  const result = await loadCalendar(async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.body, undefined);
    return response(url.startsWith('https://') ? {data:live} : saved);
  }, merge);
  assert.equal(urls.length, 2);
  assert.equal(result.calendar, live);
  assert.match(result.coverage, /Live/);
});

test('a malformed live calendar displays the dated snapshot, and two unavailable sources cannot return a clean scan',async () => {
  const result = await loadCalendar(async url => response(url.startsWith('https://') ? {} : saved),merge);
  assert.equal(result.calendar,saved);
  assert.match(result.coverage,/unavailable/);
  await assert.rejects(loadCalendar(async () => response({}),merge),/unavailable/);
});

test('private registers require a decision and cited evidence for each incident',() => {
  const row = {id:'source-1',title:'Company statement',screening:{decision:'watch',reason:'Awaiting site confirmation'},sources:[{name:'Operator',url:'https://example.com/incident'}]};
  const input = {...saved, events:[row]};
  assert.deepEqual(readPrivateRegister(JSON.stringify(input)),input);
  assert.throws(()=>readPrivateRegister(JSON.stringify({...input,events:[{...row,sources:[]}]})),/source references/);
  assert.throws(()=>readPrivateRegister(JSON.stringify({...input,watchlist:[row]})),/unique incident/);
});
