import {summarizeSignals} from './screen-signals.mjs';

const signalLabels = { red: 'Active site incident', yellow: 'Needs review' };
const publicSource = 'Auto Strike Watch', projectSource = 'Project register', hazardSource = 'Global Incident Tracker';
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'});
const timeFormat = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Prague', dateStyle:'medium', timeStyle:'short'});
const number = value => value.toLocaleString('en-US');

export function createScreeningPanel({document, core, loadCalendar, loadProject, readPrivateRegister, matchSuppliers,
  countryCode, loadHazardLeads, canCheckTracker, projectAssessment, onSignals = () => {}, onShowMap}) {
  const get = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  };
  const button = get('refreshScreening'), fileInput = get('privateRegister'), removeFile = get('removeRegister');
  const status = get('scanStatus'), coverage = get('scanCoverage'), sources = get('screeningSources'), results = get('screeningResults');
  let rows = null, sourceRuns = [], localRegister = null, localName = '', localResult = null, groups = [], completed = null;
  let generation = 0, fileGeneration = 0, busy = false, activePolicy = null;
  let visibleLimit = 40;
  const disclosures = new Map();

  function controls() {
    button.disabled = !rows?.length || busy;
    button.textContent = busy ? 'Scanning…' : 'Scan all suppliers';
    fileInput.disabled = !rows?.length;
    removeFile.hidden = !localRegister;
    removeFile.disabled = !rows?.length;
  }

  function safeLink(parent, source) {
    if (!source || typeof source !== 'object') return;
    let url;
    try { url = new URL(source.url); } catch { /* Some sources are named internal systems. */ }
    const line = node('li');
    if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      const anchor = node('a', source.name || url.hostname);
      anchor.href = url.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      line.append(anchor);
    } else line.append(node('span', source.name || 'Source reference'));
    for (const detail of [source.published, source.role, source.checkStatus].filter(Boolean)) line.append(node('small', detail));
    parent.append(line);
  }

  function renderRules(parent, rules, label = '') {
    if (Array.isArray(rules)) {
      for (const rule of rules) renderRules(parent, rule, label);
    } else if (rules && typeof rules === 'object') {
      if (typeof rules.url === 'string') { const list = node('ul'); safeLink(list, rules); parent.append(list); return; }
      for (const [key,value] of Object.entries(rules)) {
        const name = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_',' ');
        renderRules(parent,value, [label, name].filter(Boolean).join(' · '));
      }
    } else if (typeof rules === 'string' && rules.trim()) {
      const p = node('p');
      if (label) p.append(node('b', label + ' — '));
      p.append(node('span',rules)); parent.append(p);
    }
  }

  function sourceDetail(run) {
    const section = node('details',undefined,'scan-source');
    const phase = run.state === 'ready' ? run.date || 'Checked' : run.state === 'loading' ? 'Checking…' : 'Unavailable';
    section.append(node('summary',run.name + ' · ' + phase));
    if (run.note) section.append(node('p',run.note));
    if (run.calendar) {
      if (run.calendar.coverageNote) section.append(node('p',run.calendar.coverageNote));
      if (run.calendar.screeningRules) {
        const rules = node('details'); rules.append(node('summary','Screening rules')); renderRules(rules,run.calendar.screeningRules); section.append(rules);
      }
      if (run.calendar.sourceRegistry?.length) {
        const registry = node('details'), list = node('ul');
        registry.append(node('summary','Registered sources'));
        for (const item of run.calendar.sourceRegistry) safeLink(list,item);
        registry.append(list); section.append(registry);
      }
    }
    if (run.sourceURL) {const list=node('ul');safeLink(list,{url:run.sourceURL,name:run.name});section.append(list);}
    return section;
  }

  function incident(groupItem, today) {
    const {match,source} = groupItem, {event,reason,basis,decision} = match;
    const item = node('article',undefined,'scan-incident');
    item.append(node('b',event.title || event.company || 'Screened event'));
    item.append(node('small',[source,event.date,event.site || event.country].filter(Boolean).join(' · ')));
    const label = core.names?.[decision] || decision;
    item.append(node('p',[label,reason].filter(Boolean).join(' — ')),node('p',basis));
    const assessment = activePolicy && projectAssessment?.(match,activePolicy,today);
    if (assessment) item.append(node('p',assessment));
    const checked = event.lastChecked || event.reviewedAt;
    item.append(node('small',checked ? 'Source checked ' + checked : 'Source check date unavailable'));
    if (event.sources?.length) {
      const refs=node('ul');for(const fact of event.sources)safeLink(refs,fact);item.append(refs);
    }
    return item;
  }

  function renderResults(today) {
    results.replaceChildren(); disclosures.clear();
    if (!groups.length) return;
    const wrap=node('div',undefined,'tablewrap'), table=node('table',undefined,'scan-table');
    table.setAttribute('aria-label','Supplier findings');
    const head=node('thead'), tr=node('tr'), body=node('tbody');
    for (const name of ['Signal','Supplier','Site','Evidence']) tr.append(node('th',name));
    head.append(tr);table.append(head,body);wrap.append(table);results.append(wrap);
    const more=node('button','Show more suppliers','quiet');more.type='button';
    let shown=0;
    function appendThrough(limit) {
      const last=Math.min(limit,groups.length);
      while(shown<last) {
        const {supplier,level,items}=groups[shown++], row=node('tr'), indicator=node('td');
        const marker=node('i',undefined,'scan-dot');marker.setAttribute('aria-hidden','true');marker.setAttribute('data-level',level);
        indicator.append(marker,node('span',signalLabels[level]));
        const who=node('td');who.append(node('b',supplier.name || 'Unnamed supplier'),node('small','DUNS ' + (supplier.duns || 'unavailable')));
        const site=node('td',[supplier.city,supplier.country].filter(Boolean).join(', '));
        const cell=node('td'), detail=node('details',undefined,'scan-evidence');
        const first=items[0]?.match.event;
        const heading=node('summary',(first?.title || 'View evidence') + (items.length>1 ? ' (+' + (items.length-1) + ' more)' : ''));
        detail.append(heading);
        // Evidence links are built when the user expands a supplier, including keyboard or map access.
        let built = false;
        function fill() {
          if(!detail.open || built)return;
          built = true;
          if(onShowMap && Number.isFinite(supplier.lat) && Number.isFinite(supplier.lon)) {
            const mapLink=node('button','Show on map','textbutton');
            mapLink.type='button';mapLink.onclick=()=>onShowMap(supplier);detail.append(mapLink);
          }
          for(const item of items) detail.append(incident(item,today));
        }
        detail.addEventListener('toggle',fill);
        disclosures.set(supplier.id || supplier.duns,{detail,heading,fill});
        cell.append(detail);row.append(indicator,who,site,cell);body.append(row);
      }
      more.hidden=shown>=groups.length;
    }
    more.onclick=()=>{visibleLimit+=40;appendThrough(visibleLimit);};
    appendThrough(visibleLimit);results.append(more);
  }

  function showSupplier(id) {
    const index = groups.findIndex(group => (group.supplier.id || group.supplier.duns) === id);
    if (index<0) return false;
    if (!disclosures.has(id)) {visibleLimit=Math.max(visibleLimit,index+1);renderResults(dayFormat.format(new Date()));}
    const {detail,heading,fill}=disclosures.get(id);
    detail.open=true;fill();heading.focus?.();detail.scrollIntoView?.({behavior:'smooth',block:'center'});return true;
  }

  function calendarResult(name,calendar,note) {
    return {name,state:'ready',date:calendar.asOf,note,calendar,
      matches:matchSuppliers(rows,calendar,core,dayFormat.format(new Date()),countryCode)};
  }

  function render() {
    sources.replaceChildren();
    if (!rows?.length) {
      status.textContent = rows ? 'Import or load a supplier list to scan.' : '';
      coverage.textContent='';results.replaceChildren();disclosures.clear();groups=[];onSignals(groups);return;
    }
    const runs=[...sourceRuns];
    if(localRegister) {
      localResult ??= calendarResult(localName,localRegister,'Private register loaded in this tab.');
      runs.push(localResult);
    }
    for(const run of runs)sources.append(sourceDetail(run));
    const owner=canCheckTracker();
    if(owner) sources.append(node('p','Dragons Eye requires licensed feed access. Its documented reviews are available in the project register.'));
    const ready=runs.filter(run=>run.state==='ready');
    const failure=runs.filter(run=>run.state==='unavailable');
    const today=dayFormat.format(new Date());
    const findings=ready.flatMap(run=>run.matches.map(match=>({source:run.name,match})));
    groups=summarizeSignals(findings,activePolicy,today);
    const red=groups.filter(group=>group.level==='red').length, yellow=groups.length-red;
    if(busy) {
      status.textContent='Checking '+number(rows.length)+' suppliers…';
    } else if (ready.length) {
      status.textContent=number(rows.length)+' suppliers scanned · '+number(red)+' red · '+number(yellow)+' yellow'+
        (completed?' · '+timeFormat.format(completed)+' Prague':'');
    } else status.textContent='Scan unavailable. Try scanning again.';
    const limited=runs.filter(run=>run.state==='ready' && /unavailable|fallback|partial|snapshot|only the returned sample/i.test(run.note || ''));
    coverage.textContent=failure.length?'Partial coverage · '+failure.map(run=>run.name).join(', ')+' unavailable.':
      owner || limited.length ? 'Limited source coverage' : '';
    renderResults(today);
    if(!groups.length && !busy && ready.length)results.append(node('p','No supplier signals in the sources checked.','scan-empty'));
    onSignals(groups);
  }

  async function scan(force=false) {
    if (!rows?.length || busy) return;
    const serial=++generation, owner=canCheckTracker(), supplierRows=rows;
    busy=true;activePolicy=null;completed=null;visibleLimit=40;localResult=null;
    const work=[[publicSource,async()=>{const {calendar,coverage:note}=await loadCalendar();return calendarResult(publicSource,calendar,note);}]];
    if(owner) {
      work.push([projectSource,async()=>{const calendar=await loadProject();if(!calendar)throw Error('No owner register has been saved.');return calendarResult(projectSource,calendar,'Saved project review');}]);
      work.push([hazardSource,async()=>{
        const payload=await loadHazardLeads(supplierRows,{countryCode,force});
        return {name:hazardSource,state:'ready',date:payload.checkedAt,note:payload.coverage,sourceURL:payload.sourceURL,matches:payload.matches};
      }]);
    }
    sourceRuns=work.map(([name])=>({name,state:'loading'}));controls();render();
    await Promise.all(work.map(async([name,load],i)=>{
      let result;
      try { result=await load(); }
      catch(error) { result={name,state:'unavailable',note:error.message || 'Source unavailable.'}; }
      if(serial!==generation || supplierRows!==rows || owner!==canCheckTracker())return;
      sourceRuns[i]=result;
      if(name===projectSource)activePolicy=result.calendar?.assessmentPolicy || null;
      if(sourceRuns.some(run=>run.state==='loading')) render();
    }));
    if(serial!==generation || supplierRows!==rows || owner!==canCheckTracker())return;
    busy=false;completed=new Date();controls();render();
  }

  function clearFile() {
    fileGeneration++;localName='';localRegister=null;localResult=null;fileInput.value='';get('registerStatus').textContent='';
  }
  function reset() {
    generation++;rows=null;busy=false;completed=null;activePolicy=null;sourceRuns=[];clearFile();controls();render();
  }
  function setRows(next) {
    if(next===rows)return;
    generation++;fileGeneration++;rows=next;sourceRuns=[];activePolicy=null;busy=false;completed=null;visibleLimit=40;
    get('registerStatus').textContent='';fileInput.value='';
    controls();
    if(rows?.length) void scan(); else render();
  }

  fileInput.onchange=async e=>{
    const file=e.target.files?.[0];
    if(!rows?.length || !file)return;
    const serial=++fileGeneration;
    try {
      if(file.size>5_000_000)throw Error('Choose a register under 5 MB.');
      const text=await file.text();
      if(serial!==fileGeneration)return;
      const calendar=readPrivateRegister(text);
      localResult=calendarResult(file.name,calendar,'Private register loaded in this tab.');
      localRegister=calendar;localName=file.name;get('registerStatus').textContent='Included in this scan: '+file.name;
      render();
    } catch(error) {
      if(serial===fileGeneration)get('registerStatus').textContent='Could not load the register. '+error.message;
    } finally {
      if(serial===fileGeneration) {fileInput.value='';controls();}
    }
  };
  button.onclick=()=>scan(true);
  removeFile.onclick=()=>{clearFile();controls();render();};
  controls();
  return {setRows, reset, showSupplier};
}
