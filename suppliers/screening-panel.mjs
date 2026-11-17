export function createScreeningPanel({document, core, loadCalendar, loadProject, readPrivateRegister, matchSuppliers, countryCode, loadHazardLeads, canCheckTracker, projectAssessment}) {
  const get = id => document.getElementById(id);
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const publicBox = get('publicMatches');
  const projectBox = get('projectMatches');
  const privateBox = get('privateMatches');
  const trackerBox = get('trackerResults');
  const trackerButton = get('checkTracker');
  const refreshButton = get('refreshScreening');
  const privateInput = get('privateRegister');
  const removeButton = get('removeRegister');
  let rows = null;
  let privateCalendar = null;
  let publicVersion = 0;
  let fileVersion = 0;
  let fetching = false;
  let trackerVersion = 0;
  let checkingTracker = false;
  let privateFilename = '';
  let activePolicy = null;
  let policyReady = Promise.resolve();

  function controls() {
    get('trackerPanel').hidden = !canCheckTracker();
    trackerButton.disabled = !canCheckTracker() || !rows?.length || checkingTracker;
    refreshButton.disabled = !rows?.length || fetching;
    privateInput.disabled = !rows?.length;
    removeButton.hidden = !privateCalendar;
    removeButton.disabled = !rows?.length;
  }
  function clearPrivate() {
    ++fileVersion;
    privateCalendar = null;
    privateFilename = '';
    privateInput.value = '';
    privateBox.replaceChildren();
    get('registerStatus').textContent = '';
    controls();
  }
  function clearTracker() {
    ++trackerVersion;
    checkingTracker = false;
    trackerBox.replaceChildren();
  }
  function reset() {
    clearTracker();
    activePolicy = null;
    policyReady = Promise.resolve();
    rows = null;
    ++publicVersion;
    fetching = false;
    publicBox.replaceChildren();
    projectBox.replaceChildren();
    clearPrivate();
  }
  function sourceLinks(cell, sources) {
    for (const source of sources || []) {
      let url;
      try { url = new URL(source.url); } catch { /* Some private records cite a document by name. */ }
      const line = node('div');
      if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
        const link = node('a', source.name || url.hostname);
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        line.append(link);
      } else {
        line.append(node('span', source.name || 'Source reference'));
      }
      if (source.published) line.append(node('small', source.published));
      if (source.role) line.append(node('small', source.role));
      if (source.checkStatus) line.append(node('small', source.checkStatus));
      cell.append(line);
    }
  }
  function addRecord(body, match, today) {
    const {supplier, event, decision, reason, basis} = match;
    const row = node('tr');
    const identity = node('td');
    identity.append(node('b', supplier.name), node('small', 'DUNS ' + (supplier.duns || 'unavailable')), node('small', [supplier.city,supplier.country].filter(Boolean).join(', ')));
    const action = node('td');
    action.append(node('b', event.title || event.company || event.id), node('small', [event.date || 'Undated', event.site || event.country].filter(Boolean).join(' · ')));
    const assessment = node('td');
    assessment.append(node('b', core.names?.[decision] || decision), node('p', reason), node('small', basis));
    const verdict = activePolicy && projectAssessment(match, activePolicy, today);
    if (verdict) assessment.append(node('p', 'Project assessment · ' + verdict));
    const evidence = node('td');
    evidence.append(node('small', 'Source check · ' + (event.lastChecked || event.reviewedAt || 'Date unavailable')));
    const checked = String(event.lastChecked || event.reviewedAt || '').slice(0,10);
    if (Date.parse(today) - Date.parse(checked) > 3 * 86400000) evidence.append(node('small', 'Check older than three days. Reconfirm continuing impact.'));
    sourceLinks(evidence, event.sources);
    row.append(identity, action, assessment, evidence);
    body.append(row);
  }
  function pragueDay() {
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  }
  function renderRules(details, rule, name = '') {
    if (Array.isArray(rule)) {
      for (const value of rule) renderRules(details, value, name);
    } else if (rule && typeof rule === 'object') {
      for (const [key,value] of Object.entries(rule)) {
        const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
        renderRules(details, value, [name, label].filter(Boolean).join(' · '));
      }
    } else if (typeof rule === 'string' && rule.trim() || typeof rule === 'number' || typeof rule === 'boolean') {
      const paragraph = node('p');
      if (name) paragraph.append(node('b', name + ' — '));
      paragraph.append(node('span', String(rule)));
      details.append(paragraph);
    }
  }
  function showCalendar(box, calendar, label, coverage) {
    box.replaceChildren();
    const date = pragueDay();
    const matches = matchSuppliers(rows, calendar, core, date, countryCode);
    const count = new Set(matches.map(m => m.supplier.id || m.supplier.duns)).size;
    box.append(node('h3', label), node('p', count.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' suppliers returned for review'));
    const details = node('details');
    details.append(node('summary', 'Screening rules and source coverage'));
    renderRules(details, calendar.screeningRules);
    const info = [calendar.coverageNote, calendar.refreshStatus?.description];
    for (const text of new Set(info.filter(value => typeof value === 'string' && value.trim()))) details.append(node('p', text));
    const registry = (calendar.sourceRegistry || []).filter(source => source?.name || source?.url);
    if (registry.length) {
      const sources = node('details');
      sources.append(node('summary', 'Registered sources (' + registry.length + ')'));
      sourceLinks(sources, registry);
      details.append(sources);
    }
    box.append(node('p', [coverage, 'Register date · ' + (calendar.asOf || 'unspecified')].filter(Boolean).join(' · ')), details);
    if (box === publicBox && !calendar.feedChecks && !calendar.sourceChecks) {
      details.append(node('p', 'Separate check times for Global Incident Tracker and Dragons Eye are unavailable in this calendar.'));
    }
    showGroups(box,matches,date);
  }
  function showGroups(box,matches,date) {
    const groups = [
      ['company-city','Company and city match'],
      ['company-only','Company only · site unverified'],
      ['locality','Locality only · operations unverified']
    ];
    for (const [kind, title] of groups) {
      const items = matches.filter(item => item.kind === kind);
      if (!items.length) continue;
      const section = node('details');
      section.open = kind === 'company-city';
      section.append(node('summary', title + ' (' + items.length.toLocaleString() + ')'));
      showTable(section, items, title, date);
      box.append(section);
    }
  }
  function showTable(box, matches, label, date) {
    const wrap = node('div');
    wrap.className = 'tablewrap';
    const table = node('table');
    table.setAttribute('aria-label', label + ' supplier matches');
    const head = node('thead');
    const headings = node('tr');
    for (const text of ['Supplier and site','Screened event','Decision and match evidence','Sources']) headings.append(node('th',text));
    head.append(headings);
    const body = node('tbody');
    table.append(head,body);
    wrap.append(table);
    const more = node('button', 'Show more matches');
    more.type = 'button';
    more.className = 'quiet';
    let shown = 0;
    function page() {
      const limit = Math.min(shown + 40, matches.length);
      for (; shown < limit; shown++) addRecord(body, matches[shown], date);
      more.hidden = shown >= matches.length;
    }
    more.onclick = page;
    page();
    box.append(wrap,more);
  }
  function showPrivate() {
    privateBox.replaceChildren();
    if (rows?.length && privateCalendar) showCalendar(privateBox, privateCalendar, 'Private register · ' + privateFilename, 'Source coverage supplied with this file');
  }
  async function refresh() {
    if (!rows?.length) return;
    const version = ++publicVersion;
    fetching = true;
    controls();
    publicBox.replaceChildren(node('p','Loading the Auto Strike Watch calendar…'));
    projectBox.replaceChildren();
    activePolicy = null;
    const project = (async () => {
      try {
        const calendar = await loadProject();
        if (version === publicVersion && calendar) {
          activePolicy = calendar.assessmentPolicy || null;
          showCalendar(projectBox, calendar, 'Project screening register', 'Saved project review');
        }
      } catch (error) {
        if (version === publicVersion) projectBox.replaceChildren(node('p','Project screening register unavailable. ' + error.message));
      } finally {
        if (version === publicVersion && privateCalendar) showPrivate();
      }
    })();
    policyReady = project;
    const tracker = checkTracker();
    try {
      const {calendar,coverage} = await loadCalendar();
      await project;
      if (version !== publicVersion) return;
      showCalendar(publicBox, calendar, 'Auto Strike Watch', coverage);
    } catch (error) {
      if (version === publicVersion) publicBox.replaceChildren(node('p','Auto Strike Watch screening unavailable. ' + error.message));
    } finally {
      await Promise.all([project, tracker]);
      if (version === publicVersion) { fetching = false; controls(); }
    }
  }
  function setRows(next) {
    if (next === rows) return;
    rows = next;
    clearTracker();
    activePolicy = null;
    policyReady = Promise.resolve();
    ++publicVersion;
    ++fileVersion;
    fetching = false;
    get('registerStatus').textContent = '';
    privateInput.value = '';
    publicBox.replaceChildren();
    projectBox.replaceChildren();
    privateBox.replaceChildren();
    controls();
    if (!rows?.length) return;
    showPrivate();
    void refresh();
  }
  async function checkTracker(force = false) {
    if (!canCheckTracker() || !rows?.length || checkingTracker) return;
    const version = ++trackerVersion;
    checkingTracker = true;
    controls();
    trackerBox.replaceChildren(node('p','Checking current public incidents…'));
    try {
      const result = await loadHazardLeads(rows, {countryCode, force});
      await policyReady;
      if (version !== trackerVersion || !canCheckTracker()) return;
      trackerBox.replaceChildren(node('p', result.coverage),
        node('p', 'Public records checked · ' + result.recordCount + '  |  Considered for review · ' + result.consideredCount +
          '  |  Supplier leads · ' + result.matches.length),
        node('small', 'Retrieved ' + result.checkedAt));
      sourceLinks(trackerBox,[{name:'Global Incident Tracker',url:result.sourceURL}]);
      showGroups(trackerBox,result.matches,pragueDay());
    } catch (error) {
      if (version === trackerVersion) trackerBox.replaceChildren(node('p','Global Incident Tracker check unavailable. ' + error.message));
    } finally {
      if (version === trackerVersion) { checkingTracker = false; controls(); }
    }
  }
  trackerButton.onclick = () => checkTracker(true);
  privateInput.onchange = async e => {
    const file = e.target.files?.[0];
    if (!rows?.length || !file) return;
    const version = ++fileVersion;
    try {
      if (file.size > 5000000) throw Error('Choose a register under 5 MB.');
      const text = await file.text();
      if (version !== fileVersion) return;
      const calendar = readPrivateRegister(text);
      showCalendar(privateBox, calendar, 'Private register · ' + file.name, 'Source coverage supplied with this file');
      privateCalendar = calendar;
      privateFilename = file.name;
      get('registerStatus').textContent = '';
    } catch (error) {
      if (version === fileVersion) {
        showPrivate();
        get('registerStatus').textContent = 'Could not load the selected register. ' + error.message;
      }
    } finally {
      if (version === fileVersion) { privateInput.value = ''; controls(); }
    }
  };
  refreshButton.onclick = refresh;
  removeButton.onclick = clearPrivate;
  controls();
  return {setRows,reset};
}
