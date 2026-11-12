(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StrikeCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const day = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10)) ? String(value).slice(0, 10) : '';
  const recordTime = record => String(record?.reviewedAt || record?.lastChecked || '');
  const names = { candidate: 'FWS exposure check', internal: 'Preliminary internal alert', watch: 'Watch / reconfirm', excluded: 'Outside FWS scope', closed: 'Closed / changed action', unreviewed: 'Screening pending' };
  function status(record, today, now = Date.now()) {
    const declared = record.state || (record.category === 'strike' ? 'announced' : record.category || 'risk');
    if (['cancelled', 'suspended', 'postponed', 'ended'].includes(declared)) return declared;
    if (record.endAt && Number.isFinite(Date.parse(record.endAt)) && now >= Date.parse(record.endAt)) return 'past';
    if (declared === 'ongoing' && !record.endDate) {
      const checked = day(record.lastChecked);
      if (!checked || (Date.parse(today) - Date.parse(checked)) / 86400000 > 3) return 'unverified';
      return 'ongoing';
    }
    if (day(record.date) && (record.endDate || record.date) < today) return 'past';
    return declared;
  }
  function screening(record, today) {
    const state = status(record, today);
    if (['cancelled', 'suspended', 'postponed', 'ended'].includes(state)) return {decision: 'closed', reason: record.screening?.reason || 'The action was cancelled, suspended, postponed or ended; retain it as a dated outcome.'};
    if (state === 'past') return {decision: 'closed', reason: 'The scheduled date has passed; a past call alone does not confirm that a stoppage occurred.' + (record.screening?.reason ? ' Saved assessment: ' + record.screening.reason : '')};
    if (state === 'unverified') return {decision: 'watch', reason: 'Current activity needs reconfirmation. An old ongoing label is not evidence that the strike continues today.'};
    if (record.screening?.decision && names[record.screening.decision]) return record.screening;
    if (record.category !== 'strike') return {decision: 'watch', reason: 'A bargaining milestone, ballot or threat is not a confirmed stoppage.'};
    return {decision: 'unreviewed', reason: 'Confirm the named location, continuous duration, sources and production or delivery impact before choosing an FWS action.'};
  }
  function merge(live, reviewed) {
    live = live?.data || live || {};
    reviewed = reviewed || {};
    const aliases = new Map();
    for (const row of [...(reviewed.events || []), ...(reviewed.watchlist || [])]) {
      aliases.set(row.id, row.id);
      for (const alias of row.aliases || []) aliases.set(alias, row.id);
    }
    const combined = new Map();
    function add(row, isReviewed) {
      if (!row?.id) return;
      const id = aliases.get(row.id) || row.id;
      const current = combined.get(id);
      const next = {...row, id};
      if (!current || recordTime(next) > recordTime(current.row) || (recordTime(next) === recordTime(current.row) && isReviewed)) combined.set(id, {row: next, reviewed: isReviewed});
    }
    for (const row of [...(live.events || []), ...(live.watchlist || [])]) add(row, false);
    for (const row of [...(reviewed.events || []), ...(reviewed.watchlist || [])]) add(row, true);
    const all = [...combined.values()].map(value => value.row);
    const events = all.filter(row => day(row.date));
    const watchlist = all.filter(row => !day(row.date));
    const newer = String(live.updatedAt || live.asOf || '') > String(reviewed.updatedAt || reviewed.asOf || '') ? live : reviewed;
    const dates = events.map(row => row.date);
    const starts = [live.rangeStart, reviewed.rangeStart, ...dates].filter(day).sort();
    const ends = [live.rangeEnd, reviewed.rangeEnd, ...events.map(row => row.endDate || row.date)].filter(day).sort();
    const changes = [...(reviewed.changes || []), ...(live.changes || [])].filter((item, index, arr) => arr.findIndex(other => other.date === item.date && other.title === item.title) === index).sort((a,b) => String(b.date).localeCompare(String(a.date)));
    const coverageByRegion = new Map();
    for (const row of [...(live.coverage || []), ...(reviewed.coverage || [])]) {
      const prior = coverageByRegion.get(row.region);
      if (!prior || String(row.checkedAt || row.lastChecked || '') >= String(prior.checkedAt || prior.lastChecked || '')) coverageByRegion.set(row.region, row);
    }
    const sourceRegistry = [...(live.sourceRegistry || []), ...(reviewed.sourceRegistry || [])].filter((item,index,arr) => arr.findIndex(other => other.url === item.url) === index);
    return {...live, ...newer, events, watchlist, changes, coverage:[...coverageByRegion.values()], sourceRegistry, rangeStart: starts[0], rangeEnd: ends.at(-1), screeningRules: reviewed.screeningRules || live.screeningRules, curatedAsOf: reviewed.asOf, curatedUpdatedAt: reviewed.updatedAt};
  }
  return {merge, status, screening, names};
});
