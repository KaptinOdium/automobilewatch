const liveURL = 'https://auto-strike-watch-vw-oct-2026.speedycomet512.chatgpt.site/api/calendar';
const snapshotURL = '../screened-calendar.json';

function calendarRecords(payload) {
  const data = payload?.data ?? payload;
  if (!Array.isArray(data?.events) || !Array.isArray(data.watchlist) ||
      ![...data.events, ...data.watchlist].every(row => row && typeof row.id === 'string' && typeof row.title === 'string')) {
    throw Error('The screening register has an invalid event list.');
  }
  return data;
}

export function readPrivateRegister(text) {
  if (typeof text !== 'string' || text.length > 5_000_000) throw Error('Choose a screening register under 5 MB.');
  let data;
  try { data = calendarRecords(JSON.parse(text.replace(/^\uFEFF/, ''))); }
  catch { throw Error('Choose a screening JSON register with events and watchlist arrays.'); }
  const entries = [...data.events, ...data.watchlist];
  const decisions = ['candidate','internal','watch','closed','excluded','unreviewed'];
  if (entries.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(data.asOf || '') ||
      new Set(entries.map(row => row.id)).size !== entries.length ||
      entries.some(row => !decisions.includes(row.screening?.decision) || !row.screening.reason ||
        typeof row.screening.reason !== 'string' || !Array.isArray(row.sources) || !row.sources.length ||
        row.sources.some(source => !source || typeof source.name !== 'string' || typeof source.url !== 'string'))) {
    throw Error('Each private register needs a review date, unique incident IDs, screening decisions, reasons, and source references.');
  }
  return data;
}

export async function loadCalendar(fetcher = globalThis.fetch, core = globalThis.StrikeCore) {
  async function read(url) {
    const response = await fetcher(url, {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('Calendar request failed');
    return calendarRecords(await response.json());
  }
  const [live, snapshot] = await Promise.allSettled([read(liveURL), read(snapshotURL)]);
  if (live.status === 'rejected' && snapshot.status === 'rejected') throw Error('Auto Strike Watch is unavailable. Retry to check for matches.');
  const calendar = core.merge(live.value, snapshot.value);
  const coverage = live.status === 'fulfilled'
    ? (snapshot.status === 'fulfilled' ? 'Live Auto Strike Watch calendar and saved reviews' : 'Live Auto Strike Watch calendar; saved reviews unavailable')
    : 'Live calendar unavailable. Showing the saved Auto Strike Watch snapshot';
  return {calendar, coverage};
}
