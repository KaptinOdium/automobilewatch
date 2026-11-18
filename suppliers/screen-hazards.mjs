import {countryName, entityName, words} from './screen-matches.mjs';

export const hazardSourceURL = 'https://globalincidenttracker.com/api/incidents.php?format=list&days=1';
const day = 86400000;
const defaultFetch = (...args) => fetch(...args);
const feeds = new WeakMap();
const physicalHazards = new Set([
  'earthquake', 'flood', 'storm', 'hurricane', 'cyclone', 'tornado', 'wildfire', 'fire', 'gas-leak',
  'chemical-spill', 'industrial-accident', 'power-outage', 'landslide', 'explosion', 'mining-accident',
  'building-collapse', 'bridge-collapse', 'volcano', 'tsunami', 'maritime-accident', 'train-accident',
]);
const warningProviders = new Set(['meteoalarm', 'nws', 'caphub', 'glofas']);
const reportedImpact = /\b(?:damage[d]?|destroyed|injured|closed|closure|power outage|evacuat\w*|tsunami warning)\b/i;
const usesSite = /\b(?:plant|factory|warehouse|facility|terminal|mine|production|operations|manufacturing|evacuat\w*|damage[d]?|shutdown|interrupted|suspend\w*|halt\w*)\b/i;

function sourceLink(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {}
  return null;
}
function occurredAt(value) {
  // The publisher's list endpoint uses UTC without an explicit zone.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:Z)?$/.test(value)) return NaN;
  return Date.parse(value.replace(' ', 'T').replace(/Z?$/, 'Z'));
}
function localities(title, warning) {
  // Accept delimited locations or an explicit location at the end of a
  // headline. "York" must not match "New York" or county/region prose.
  const dash = title.match(/\s[—–]\s(.+)$/u);
  const trailing = title.match(/\b(?:in|at|near) ([\p{L}\p{M}][\p{L}\p{M}'’ .-]*)(?=$|[,;|])/iu);
  const part = dash?.[1] || trailing?.[1] || '';
  const parts = warning ? part.split(/[,;/]/u) : part.split(/[,;]/u);
  return new Set(parts.map(words).filter(name => name.length > 2 && !/\b(?:county|district|province|region|nationwide|state|coast|offshore|near)\b/.test(name)));
}
function scopeOf(row, now) {
  if (!physicalHazards.has(row.type) || typeof row.title !== 'string' || !row.country || row.id == null) return null;
  const time = occurredAt(row.occurred_at);
  const warning = warningProviders.has(row.source) || /\b(?:forecast|warning|outlook|watch)\b/i.test(row.title);
  if (!Number.isFinite(time) || time < now - day || time > now + (warning ? day : 0)) return null;
  if (row.type === 'earthquake' && !reportedImpact.test(row.title)) return null;
  const link = sourceLink(row.permalink);
  if (link?.origin !== 'https://globalincidenttracker.com' || !link.pathname.startsWith('/incident/')) return null;
  return {time, warning, link, cities: localities(row.title, warning)};
}

async function publicFeed(fetcher, now, force) {
  if (!feeds.has(fetcher)) feeds.set(fetcher, {});
  const cache = feeds.get(fetcher);
  if (cache.pending) return cache.pending;
  if (!force && cache.latest && now >= cache.latest.time && now - cache.latest.time < 300000) return cache.latest;
  cache.pending = (async () => {
    const response = await fetcher(hazardSourceURL, {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error('Global Incident Tracker is unavailable.');
    const data = await response.json();
    if (!Array.isArray(data?.incidents) || !Number.isSafeInteger(data.count) || data.count < data.incidents.length) {
      throw Error('Global Incident Tracker returned an unsupported feed.');
    }
    cache.latest = {data, time: now};
    return cache.latest;
  })();
  try { return await cache.pending; }
  finally { cache.pending = null; }
}

export async function loadHazardLeads(suppliers, {fetcher = defaultFetch, now = Date.now(), countryCode, force = false} = {}) {
  const {data, time} = await publicFeed(fetcher, now, force);
  const checkedAt = new Date(time).toISOString();
  const byCountry = new Map();
  for (const supplier of suppliers) {
    const country = countryName(supplier.country, countryCode);
    if (!country) continue;
    const name = entityName(supplier.name);
    const city = words(String(supplier.city ?? '').split(',')[0]);
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push({supplier, name, city});
  }

  const matches = [];
  const ids = new Set();
  let consideredCount = 0;
  for (const row of data.incidents) {
    if (!row || ids.has(row.id)) continue;
    const scope = scopeOf(row, now);
    if (!scope) continue;
    ids.add(row.id);
    consideredCount++;
    const country = countryName(row.country, countryCode);
    const headline = ' ' + words(row.title) + ' ';
    const original = sourceLink(row.url);
    const sources = [{name: 'Global Incident Tracker (CC BY 4.0)', url: scope.link.href}];
    if (original && original.origin !== scope.link.origin) sources.push({name: String(row.source || original.hostname), url: original.href});
    const occurred = new Date(scope.time).toISOString();
    const date = occurred.slice(0,10);
    const event = {
      id: 'git-' + String(row.id), country: row.country, date, title: String(row.type_label || row.type) + (scope.warning ? ' warning' : ' report'),
      sources, lastChecked: checkedAt.slice(0,10)
    };
    const reason = (scope.warning ? 'Forecast or area warning; monitor for operational updates.' : 'Tracker report; verify facility, access or freight disruption with an operator or authority.') +
      ' Tracker severity: ' + String(row.severity_label || 'unspecified') + '. Reported event time: ' + occurred.slice(0,16).replace('T',' ') + ' UTC.';
    for (const {supplier, city, name} of byCountry.get(country) || []) {
      const locality = !!city && city !== country && scope.cities.has(city);
      // Require a full multiword company name in a headline about a facility
      // or operations; avoid brand-name fragments and incidental street names.
      const company = !scope.warning && name.length >= 6 && name.includes(' ') && name !== city &&
        usesSite.test(row.title) && headline.includes(' ' + name + ' ');
      if (!locality && !company) continue;
      const kind = company ? (locality ? 'company-city' : 'company-only') : 'locality';
      const basis = company ? (locality ? 'Company and locality named; confirm the facility' : 'Company named in headline; confirm the facility')
        : 'Reported location or warning area shares the supplier city name; confirm boundaries and operations';
      const location = locality ? String(supplier.city).split(',')[0].trim() : row.country;
      const title = event.title + ' · ' + location + ' · ' + occurred.slice(11,16) + ' UTC';
      matches.push({supplier, event: {...event, title, site: location}, decision: 'unreviewed', reason, basis, kind});
    }
  }
  const recordCount = data.incidents.length;
  const reportedTimes = data.incidents.map(row => occurredAt(row?.occurred_at)).filter(Number.isFinite);
  const hasRecent = reportedTimes.some(t => t >= now - day && t <= now);
  const coverage = 'Global Incident Tracker returned ' + recordCount + ' records from its one-day list. ' +
    consideredCount + ' distinct physical hazard records qualified for locality or company comparison. ' +
    (data.count > recordCount || recordCount >= 800 ? 'Coverage is partial; this check covers only the returned sample. ' : 'The returned sample can omit events. ') +
    (!hasRecent ? 'No returned records carry event times in the last 24 hours. ' : '') +
    'Reports use a 24-hour lookback and warnings a further 24-hour outlook. ' +
    'Coverage depends on reported places, names and available upstream sources.';
  return {matches, checkedAt, recordCount, consideredCount, coverage, sourceURL: hazardSourceURL};
}
