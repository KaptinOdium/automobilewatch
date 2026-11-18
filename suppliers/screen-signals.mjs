const closed = new Set(['ended', 'past', 'cancelled', 'suspended', 'postponed', 'closed', 'recovery']);
const activeDecisions = new Set(['watch', 'candidate', 'internal', 'unreviewed']);

function signalLevel(match, maxAge, today) {
  const {event, decision} = match;
  if (!event || !activeDecisions.has(decision) || closed.has(event.state) ||
      ['closed', 'excluded'].includes(event.screening?.decision) ||
      (event.endDate && event.endDate < today) ||
      (event.endAt && Date.parse(event.endAt) <= Date.now())) return null;
  if (event.state !== 'ongoing' || event.date > today || match.namedSite !== true) return 'yellow';
  const reviewed = String(event.lastChecked || event.reviewedAt || '').slice(0,10);
  const age = (Date.parse(today) - Date.parse(reviewed)) / 86400000;
  const cited = Array.isArray(event.sources) && event.sources.some(s => /^https?:\/\//i.test(s?.url));
  const siteDisrupted = event.screening?.operationalImpactVerified === true ||
    (event.category === 'strike' && decision === 'candidate');
  return cited && age >= 0 && age <= maxAge && siteDisrupted ? 'red' : 'yellow';
}

// A supplier may appear in multiple sources. Keep every source with its
// evidence, but count and colour each register row once.
export function summarizeSignals(results, policy, today) {
  const maxAge = Number.isInteger(policy?.maxEvidenceAgeDays) ? policy.maxEvidenceAgeDays : 3;
  const byRow = new Map();
  for (const {source, match} of results) {
    const supplier = match?.supplier;
    if (!supplier?.id) continue;
    const level = signalLevel(match, maxAge, today);
    if (!level) continue;
    let group = byRow.get(supplier.id);
    if (!group) {
      group = {supplier, level, items:[]};
      byRow.set(supplier.id, group);
    }
    if (level === 'red') group.level = 'red';
    group.items.push({source, match, level});
  }
  const priority = (a,b) => Number(b.level === 'red') - Number(a.level === 'red');
  for (const group of byRow.values()) group.items.sort(priority);
  return [...byRow.values()].sort((a,b) => priority(a,b) ||
    a.supplier.name.localeCompare(b.supplier.name) || a.supplier.id.localeCompare(b.supplier.id));
}
