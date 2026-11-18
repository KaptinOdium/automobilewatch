export const words = value => String(value ?? '').normalize('NFKD').toLowerCase()
  .replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Remove only trailing legal forms. Geographic and business-unit qualifiers
// distinguish entities and must stay in the comparison.
const legalSuffix = /\s+(?:gmbh and co kg|gmbh|ag|kg|ohg|kgaa|incorporated|inc|limited|ltd|llc|l l c|plc|corp|corporation|s a de c v|s a s|s a|s r l|s l|s p a|spa|sarl|sas|s r o|sro|bv|b v|nv|pty)$/u;
export function entityName(value) {
  let name = words(value);
  while (legalSuffix.test(name)) name = name.replace(legalSuffix, '');
  return name;
}

const countryAliases = new Map([
  ['us','united states'], ['usa','united states'], ['united states of america','united states'],
  ['uk','united kingdom'], ['gb','united kingdom'], ['great britain','united kingdom'],
  ['republic of korea','south korea'], ['korea republic of','south korea'], ['kr','south korea'],
  ['czech republic','czechia'], ['turkiye','turkey'], ['deutschland','germany'],
]);
export function countryName(value, countryCode) {
  const name = words(value);
  if (!name) return '';
  const canonical = countryAliases.get(name) || name;
  return words(countryCode?.(String(value)) || countryCode?.(canonical) || canonical);
}

const generic = /^(?:company|group|national|steel|rail|port|airport|transport|logistics|metal|automotive|industry|suppliers?|workers?|regional|general|operations|staff|national rail|public service)$/u;
function parties(company) {
  // A calendar company field can name several employers, labor organizations,
  // or whole sectors. Only use complete named parties in that field.
  return [...new Set(String(company ?? '').split(/\s*[\/;·|–—]\s*/u)
    .map(entityName)
    .filter(name => name.length >= 3 && !generic.test(name) &&
      !/\b(?:cross sector|unions?|university sector|public sector|nationwide|nearby suppliers|bargaining regions|regional workplaces|named sites)\b/u.test(name)))];
}

function namedCities(site) {
  return new Set(String(site ?? '').split(/[,;/·|]|\s+and\s+/iu).map(part =>
    words(part).replace(/^(?:port of|city of) /u, '')
      .replace(/ (?:plant|site|factory|port|airport|airports|industrial area|steel operations)$/u, '')
  ).filter(Boolean));
}

const qualifyingDecisions = new Set(['candidate', 'internal', 'watch', 'unreviewed']);
const specifiedSite = /^(?:named (?:supplier )?sites?|automotive plant)$/u;

/**
 * Compare the private register to already-screened calendar records. A
 * supplier/company match or shared city is insufficient to confirm a shutdown
 * or procurement exposure. Keep the calendar decision and match basis separate.
 */
export function matchSuppliers(suppliers, calendar, core, today, countryCode) {
  const byCountry = new Map();
  for (const supplier of suppliers) {
    const name = entityName(supplier.name);
    const country = countryName(supplier.country, countryCode);
    if (!name || !country) continue;
    if (!byCountry.has(country)) byCountry.set(country, []);
    // A register city may include a county or region after the locality.
    const city = words(String(supplier.city ?? '').split(',')[0]);
    byCountry.get(country).push({supplier, name, city});
  }

  const matches = [];
  for (const event of [...(calendar.events || []), ...(calendar.watchlist || [])]) {
    const {decision, reason} = core.screening(event, today);
    if (!qualifyingDecisions.has(decision)) continue;
    const names = parties(event.company);
    const cities = namedCities(event.site);
    const country = countryName(event.country, countryCode);
    // Locality checks require an explicit reviewed location. Country and route
    // names alone cannot associate a supplier with a regional incident.
    const localities = new Set((Array.isArray(event.screening?.localityReview) ? event.screening.localityReview : [])
      .filter(loc => country && countryName(loc?.country, countryCode) === country)
      .map(loc => words(loc.city)).filter(Boolean));
    if (!names.length && !localities.size) continue;
    for (const {supplier, name, city} of byCountry.get(country) ?? []) {
      const sameCity = !!city && cities.has(city);
      const exactName = names.includes(name);
      // Eg. "Example Components" and "Example Components Manufacturing" in
      // the reported city. Whole multi-word names avoid short acronym matches.
      const relatedName = !exactName && sameCity && names.some(party =>
        party.includes(' ') && name.startsWith(party + ' ') ||
        name.includes(' ') && party.startsWith(name + ' '));
      if (!exactName && !relatedName) {
        if (city && localities.has(city)) matches.push({supplier, event, decision: 'watch', reason, kind: 'locality',
          basis: 'Site in a locality identified for review; verify local operations and deliveries'});
        continue;
      }
      const concreteSite = specifiedSite.test(words(event.scope)) ||
        (words(event.scope) === 'company' && /^\p{L}+(?:[- ]\p{L}+)?$/u.test(String(event.site || '').trim()));
      if (!sameCity && concreteSite && cities.size) continue;

      const basis = relatedName ? 'Similar company name and reported city; verify the legal entity and site'
        : sameCity ? 'Company name and reported city match; verify the operating site'
        : 'Company name and country match; site unverified';
      // A group notice can list several employers and several locations without
      // pairing them. Reserve the verified-site indicator for one named employer.
      const namedSite = exactName && sameCity && names.length === 1 &&
        /^(?:named site|automotive plant|supplier site|workplace)$/u.test(words(event.scope));
      matches.push({supplier, event, decision, reason, basis, kind: sameCity ? 'company-city' : 'company-only', namedSite});
    }
  }
  return matches;
}
