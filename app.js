(() => {
  'use strict';
  const $=id=>document.getElementById(id), esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const regions=['Europe','North America','South America','Asia','Africa','Australia / Oceania'];
  const relevanceNames={vw:'VW-related',supplier:'Automotive supplier',industry:'Wider automotive',nationwide:'Nationwide / general',logistics:'Logistics'};
  const typeNames={strike:'Strike call',milestone:'Negotiation / milestone',risk:'Risk window',watch:'Undated watch'};
  const stateNames={announced:'Announced',ongoing:'Reported ongoing',cancelled:'Cancelled',postponed:'Postponed',ended:'Ended',milestone:'Milestone',risk:'Risk / no action called',unverified:'Needs confirmation',past:'Past date / outcome unverified'};
  const dateObject=iso=>new Date(String(iso).slice(0,10)+'T12:00:00Z');
  const validDate=iso=>/^\d{4}-\d{2}-\d{2}$/.test(String(iso))&&!Number.isNaN(dateObject(iso).valueOf());
  const fmt=(iso,opts={day:'numeric',month:'short',year:'numeric'})=>validDate(String(iso).slice(0,10))?new Intl.DateTimeFormat('en-GB',{...opts,timeZone:'UTC'}).format(dateObject(iso)):'Not recorded';
  const isoDate=d=>d.toISOString().slice(0,10);
  const currentDay=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');};
  const monthStart=iso=>new Date(Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,1,12));
  const defaultEnd=iso=>{const d=dateObject(iso);d.setUTCMonth(d.getUTCMonth()+3);d.setUTCDate(d.getUTCDate()-1);return isoDate(d);};
  let data={events:[],watchlist:[],coverage:[],changes:[]}, events=[],watchlist=[], month, minMonth,maxMonth,view='map',toastTimer,loading=false,fetchError='',offline=location.protocol==='file:',hasServerData=false;
  function timestamp(value){if(!value)return 'Not recorded';const d=new Date(value);return Number.isNaN(d.valueOf())?fmt(value):new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Prague'}).format(d)+' Prague';}
  function regionFor(e){if(regions.includes(e.region))return e.region;if(e.region==='Australia/Oceania'||e.region==='Oceania'||e.region==='Australia')return 'Australia / Oceania';return ({Mexico:'North America',Canada:'North America','United States':'North America',USA:'North America',Brazil:'South America',Argentina:'South America',Chile:'South America',Australia:'Australia / Oceania','New Zealand':'Australia / Oceania','South Africa':'Africa',India:'Asia',China:'Asia','South Korea':'Asia'})[e.country]||e.region||'Unspecified';}
  function stateOf(e){const declared=e.state||(e.category==='strike'?'announced':e.category||'risk');if(((declared==='ongoing'&&e.endDate)||( !['cancelled','postponed','ended','ongoing'].includes(declared)))&&validDate(e.date)&&(e.endDate||e.date)<currentDay())return 'past';return declared;}
  const isActive=e=>!['cancelled','postponed','ended','past','unverified'].includes(stateOf(e));
  function dateRange(e){return fmt(e.date)+(e.endDate&&e.endDate!==e.date?' – '+fmt(e.endDate):(stateOf(e)==='ongoing'?' · end not confirmed':''));}
  function visibleWindow(e){return validDate(e.date)&&e.date<=data.rangeEnd&&((e.endDate||e.date)>=data.rangeStart||stateOf(e)==='ongoing');}
  function filters(){return {q:$('search').value.trim().toLowerCase(),region:$('region').value,relevance:$('relevance').value,country:$('country').value,category:$('category').value,state:$('state').value};}
  function matches(e,undated=false){const f=filters(),s=stateOf(e);return (f.region==='all'||regionFor(e)===f.region)&&(f.relevance==='all'||e.relevance===f.relevance||(f.relevance==='nationwide'&&e.scope==='nationwide'))&&(f.country==='all'||e.country===f.country)&&(f.category==='all'||(undated?f.category==='risk':e.category===f.category))&&(f.state==='all'||(f.state==='active'?isActive(e):s===f.state))&&(!f.q||[e.title,e.company,e.country,e.site,e.summary,e.impact].join(' ').toLowerCase().includes(f.q));}
  function selectedEvents(){return events.filter(e=>visibleWindow(e)&&matches(e));}
  function selectedWatch(){return watchlist.filter(e=>matches(e,true));}
  function badge(e,undated=false){const s=stateOf(e),inactive=['cancelled','postponed','ended','past','unverified'].includes(s);return '<span class="badge '+(inactive?'inactive':esc(undated?'watch':e.category))+'">'+esc(inactive?stateNames[s]:(s==='ongoing'?stateNames[s]:e.label||typeNames[undated?'watch':e.category]))+'</span>';}
  function renderHeader(){
    $('as-of').textContent=timestamp(data.updatedAt||data.asOf);
    $('refresh-label').textContent=offline?'Portable snapshot':data.refreshStatus==='daily'?'Last successful update':'Research updated';
    $('planning-window').textContent=fmt(data.rangeStart)+' → '+fmt(data.rangeEnd);
    $('schedule-note').textContent=(data.refreshStatus==='daily'?'Scheduled daily review: '+(data.dailyTime||'07:00 Europe/Prague')+'. ':'Daily review is being configured. ')+(offline?'This portable copy does not fetch later changes.':'The open dashboard checks for saved updates every five minutes. This display check is separate from the daily research run.');
    $('coverage-note').textContent=data.coverageNote||'Primary union, company and public-authority sources are preferred. Wider disruptions are labelled separately from verified VW impacts.';
    const elapsed=data.updatedAt?Date.now()-new Date(data.updatedAt).valueOf():Date.now()-dateObject(data.asOf||currentDay()).valueOf();
    const warnings=[];
    if(offline)warnings.push('Portable snapshot — this saved copy does not update automatically.');
    if(fetchError)warnings.push(hasServerData?'The latest refresh could not be loaded. Showing the last successfully loaded data.':'The shared data could not be loaded. Showing the bundled fallback snapshot.');
    if(Number.isFinite(elapsed)&&elapsed>36*3600000)warnings.push('Research is more than 36 hours old. Check sources for subsequent changes.');
    if(!data.updatedAt)warnings.push('Exact refresh time has not been recorded.');
    $('refresh-banner').textContent=warnings.join(' ');$('refresh-banner').hidden=!warnings.length;
  }
  function applyData(payload){
    const next=payload?.data||payload;
    if(!next||!Array.isArray(next.events)||!Array.isArray(next.watchlist))throw new Error('Invalid calendar data');
    data={...next,asOf:validDate(next.asOf)?next.asOf:currentDay(),rangeStart:validDate(next.rangeStart)?next.rangeStart:currentDay(),rangeEnd:validDate(next.rangeEnd)?next.rangeEnd:defaultEnd(currentDay())};
    events=data.events.filter(e=>e&&e.id&&e.title&&validDate(e.date)).map(e=>({...e,region:regionFor(e)})).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
    watchlist=data.watchlist.filter(e=>e&&e.id&&e.title).map(e=>({...e,region:regionFor(e)}));
    minMonth=monthStart(data.rangeStart);maxMonth=monthStart(data.rangeEnd);if(!month)month=monthStart(data.asOf);if(month<minMonth)month=new Date(minMonth);if(month>maxMonth)month=new Date(maxMonth);
    const existing=$('country').value;$('country').innerHTML='<option value="all">All countries</option>';
    [...new Set([...events,...watchlist].map(e=>e.country).filter(Boolean))].sort().forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;$('country').append(o);});if([...$('country').options].some(o=>o.value===existing))$('country').value=existing;
    render();
  }
  async function refresh(initial=false){
    if(loading)return;loading=true;
    try{
      if(offline){if(initial)applyData(window.STRIKE_DATA||{events:[],watchlist:[]});return;}
      const response=await fetch('https://auto-strike-watch-vw-oct-2026.speedycomet512.chatgpt.site/api/calendar',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('HTTP '+response.status);const result=await response.json();fetchError='';hasServerData=true;applyData(result);
    }catch(error){fetchError=String(error.message||error);if(initial)applyData(window.STRIKE_DATA||{events:[],watchlist:[]});else renderHeader();}
    finally{loading=false;}
  }
  // Geographic markers represent the country named in a record, never a precise plant.
  let mapExtent='world', mapReady=false, mapFailed=false, mapCountries=[], countryLookup=new Map(), mapGroups=new Map();
  let camera=[0,0,1000,450], cameraFrame=0, tooltipMarker=null, tooltipTimer=0, mapDrag=null, suppressMapClick=false;
  const reducedMapMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const markerColors={strike:'var(--strike)',milestone:'var(--milestone)',risk:'var(--risk)',inactive:'var(--muted)'};
  const normalizeCountry=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const countryAliases={'usa':'United States of America','us':'United States of America','unitedstates':'United States of America','uk':'United Kingdom','greatbritain':'United Kingdom','czechrepublic':'Czechia','southkorea':'South Korea','republicofkorea':'South Korea','northkorea':'North Korea','turkey':'Turkey','turkiye':'Turkey','russia':'Russia','russianfederation':'Russia','vietnam':'Vietnam','ivorycoast':"Ivory Coast",'cotedivoire':"Ivory Coast",'congodrc':'Democratic Republic of the Congo','drcongo':'Democratic Republic of the Congo','serbia':'Republic of Serbia','eswatini':'eSwatini','swaziland':'eSwatini'};
  function lookupCountry(name){
    const key=normalizeCountry(name);
    return countryLookup.get(key)||countryLookup.get(normalizeCountry(countryAliases[key]));
  }
  function markerKind(list){
    const active=list.filter(isActive);
    return ['strike','milestone','risk'].find(kind=>active.some(e=>e.category===kind))||'inactive';
  }
  function clampCamera(bounds){
    const width=Math.max(110,Math.min(1000,bounds[2])),height=width*.45;
    return [Math.max(0,Math.min(1000-width,bounds[0])),Math.max(0,Math.min(450-height,bounds[1])),width,height];
  }
  function updateMapCamera(announce=false){
    const svg=$('world-map'),scale=camera[2]/1000;
    svg.setAttribute('viewBox',camera.map(n=>n.toFixed(3)).join(' '));
    svg.classList.toggle('is-zoomed',camera[2]<999);
    let visible=0;
    $('map-markers').querySelectorAll('[data-map-country]').forEach(marker=>{
      const x=+marker.dataset.x,y=+marker.dataset.y,inView=x>=camera[0]&&x<=camera[0]+camera[2]&&y>=camera[1]&&y<=camera[1]+camera[3];
      marker.setAttribute('transform','translate('+x+' '+y+') scale('+scale+')');
      marker.setAttribute('tabindex',inView?'0':'-1');
      if(inView){marker.removeAttribute('aria-hidden');visible++;}else marker.setAttribute('aria-hidden','true');
    });
    ['world','europe'].forEach(mode=>{$('map-'+mode).classList.toggle('active',mapExtent===mode);$('map-'+mode).setAttribute('aria-pressed',String(mapExtent===mode));});
    if($('map-zoom-level'))$('map-zoom-level').textContent=(1000/camera[2]).toFixed(1)+'×';
    if($('map-zoom-in'))$('map-zoom-in').disabled=camera[2]<=110.1;
    if($('map-zoom-out'))$('map-zoom-out').disabled=camera[2]>=999.9;
    if(announce){
      const total=$('map-markers').children.length,count=[...mapGroups.values()].reduce((n,list)=>n+list.length,0);
      const label=mapExtent==='world'?total+' mapped '+(total===1?'country':'countries'):(mapExtent==='europe'?'Europe view':mapExtent==='country'?$('country').value:'Map view')+' · '+visible+' of '+total+' mapped countries';
      $('map-summary').textContent=label+' · '+count+' dated '+(count===1?'entry':'entries');
      const unmapped=[...mapGroups].reduce((n,[country,list])=>{const point=lookupCountry(country);return n+(!point||!Number.isFinite(point.lon)||!Number.isFinite(point.lat)?list.length:0);},0);
      let note='';
      if(mapFailed)note='Map could not load. All matching entries remain available in the list.';
      else if(!mapReady)note='Loading world map…';
      else if(unmapped)note=unmapped+' '+(unmapped===1?'entry has':'entries have')+' no map location; '+(unmapped===1?'it is':'they are')+' included in the list.';
      else if(total>visible)note='The list includes entries outside this zoom. Select World to see every mapped country.';
      $('map-unmapped').textContent=note;$('map-unmapped').hidden=!note;
    }
  }
  function hideMapTooltip(){
    clearTimeout(tooltipTimer);
    if(tooltipMarker)tooltipMarker.removeAttribute('aria-describedby');
    tooltipMarker=null;
    if($('map-tooltip'))$('map-tooltip').hidden=true;
  }
  function moveMapCamera(bounds,extent='custom',animate=true){
    cancelAnimationFrame(cameraFrame);hideMapTooltip();mapExtent=extent;
    const target=clampCamera(bounds),start=camera.slice();
    if(!animate||reducedMapMotion.matches){camera=target;updateMapCamera(true);return;}
    const began=performance.now();
    function frame(now){
      const progress=Math.min(1,(now-began)/520),ease=1-Math.pow(1-progress,3);
      camera=start.map((value,i)=>value+(target[i]-value)*ease);updateMapCamera(progress===1);
      if(progress<1)cameraFrame=requestAnimationFrame(frame);
    }
    cameraFrame=requestAnimationFrame(frame);
  }
  function zoomMap(factor){
    const width=Math.max(110,Math.min(1000,camera[2]*factor)),height=width*.45;
    moveMapCamera([camera[0]+(camera[2]-width)/2,camera[1]+(camera[3]-height)/2,width,height],width===1000?'world':'custom');
  }
  function focusMapCountry(name){
    const point=lookupCountry(name);if(!point)return;
    const record=(mapGroups.get(name)||[])[0],width=regionFor(record||{})==='Europe'?180:300;
    moveMapCamera([(point.lon+180)*1000/360-width/2,(90-point.lat)*1000/360-width*.225,width,width*.45],'country');
  }
  function showMapTooltip(marker){
    const tip=$('map-tooltip'),list=mapGroups.get(marker.dataset.mapCountry);
    if(!tip||!list||mapDrag)return;
    hideMapTooltip();tooltipMarker=marker;
    const active=list.filter(isActive),ongoing=active.filter(e=>e.category==='strike'&&stateOf(e)==='ongoing').length;
    const strikes=active.filter(e=>e.category==='strike').length,risks=active.filter(e=>e.category==='risk').length,milestones=active.filter(e=>e.category==='milestone').length;
    const next=active.filter(e=>e.category==='strike'&&stateOf(e)!=='ongoing'&&e.date>=currentDay()).sort((a,b)=>a.date.localeCompare(b.date))[0];
    const groups=[...new Set(list.map(e=>e.company).filter(Boolean))];
    const counts=[strikes+' strike '+(strikes===1?'call':'calls'),risks?risks+' risk '+(risks===1?'window':'windows'):'',milestones?milestones+' '+(milestones===1?'milestone':'milestones'):''].filter(Boolean);
    tip.innerHTML='<span class="map-tooltip-eyebrow">COUNTRY PREVIEW</span><strong class="map-tooltip-title">'+esc(marker.dataset.mapCountry)+'</strong><div class="map-tooltip-counts">'+counts.map(t=>'<span>'+esc(t)+'</span>').join('')+'</div><p class="map-tooltip-date">'+(ongoing?'<span class="map-tooltip-live">'+ongoing+' reported ongoing</span>':'')+(next?'<span>Next strike call · '+esc(fmt(next.date))+'</span>':!ongoing?'<span>No upcoming strike call in this selection</span>':'')+'</p><p class="map-tooltip-sectors"><span>Affected groups</span>'+esc(groups.slice(0,2).join(' · ')||'See source brief')+(groups.length>2?' <small>+'+(groups.length-2)+' more</small>':'')+'</p><span class="map-tooltip-hint">Select dot to zoom and explore · Country-level location</span>';
    tip.hidden=false;marker.setAttribute('aria-describedby','map-tooltip');
    const viewport=tip.parentElement.getBoundingClientRect(),anchor=marker.getBoundingClientRect(),width=tip.offsetWidth,height=tip.offsetHeight;
    let left=anchor.left-viewport.left+anchor.width/2-width/2,top=anchor.top-viewport.top-height-12;
    if(top<8)top=anchor.bottom-viewport.top+12;
    tip.style.left=Math.max(8,Math.min(viewport.width-width-8,left))+'px';
    tip.style.top=Math.max(8,Math.min(viewport.height-height-8,top))+'px';
  }
  function renderMap(selected){
    hideMapTooltip();
    const chosen=$('country').value, groups=new Map();
    selected.forEach(e=>{if(!groups.has(e.country))groups.set(e.country,[]);groups.get(e.country).push(e);});
    mapGroups=groups;
    const bounds=camera;
    const geometryWithEvents=new Set(),chosenGeometry=lookupCountry(chosen);
    const markers=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([country,list])=>{
      const point=lookupCountry(country);
      if(!point||!Number.isFinite(point.lon)||!Number.isFinite(point.lat))return '';
      geometryWithEvents.add(point.code);
      const x=(point.lon+180)*1000/360,y=(90-point.lat)*1000/360;
      const visible=x>=bounds[0]&&x<=bounds[0]+bounds[2]&&y>=bounds[1]&&y<=bounds[1]+bounds[3];
      const kind=markerKind(list),scale=camera[2]/1000,ongoing=list.some(e=>e.category==='strike'&&stateOf(e)==='ongoing');
      const strikes=list.filter(e=>e.category==='strike'&&isActive(e)).length;
      const description=country+': '+list.length+' dated '+(list.length===1?'entry':'entries')+', '+strikes+' active strike '+(strikes===1?'call':'calls')+'. Select to filter. Approximate country marker.';
      return '<g class="map-marker '+kind+(ongoing?' is-ongoing':'')+(chosen===country?' is-selected':'')+'" data-map-country="'+esc(country)+'" data-x="'+x.toFixed(2)+'" data-y="'+y.toFixed(2)+'" role="button" tabindex="'+(visible?'0':'-1')+'" aria-label="'+esc(description)+(ongoing?' Reported ongoing strike.':'')+'" aria-pressed="'+String(chosen===country)+'"'+(visible?'':' aria-hidden="true"')+' transform="translate('+x.toFixed(2)+' '+y.toFixed(2)+') scale('+scale+')" style="--marker-color:'+markerColors[kind]+'"><circle class="map-hit" r="16" fill="transparent"/>'+(ongoing?'<circle class="map-pulse" r="10" aria-hidden="true"/>':'')+'<circle class="map-halo" r="12" fill="'+markerColors[kind]+'" opacity=".12"/><circle class="map-dot" r="'+(list.length>1?'7':'5.5')+'" fill="'+markerColors[kind]+'" stroke="var(--map-stroke, #101720)" stroke-width="2"/>'+(list.length>1?'<text class="map-dot-count" text-anchor="middle" dominant-baseline="central" font-size="8" font-weight="700" style="fill:var(--map)">'+list.length+'</text>':'')+'</g>';
    }).join('');
    $('map-markers').innerHTML=markers;
    $('country-paths').querySelectorAll('[data-country-code]').forEach(path=>{
      path.classList.toggle('has-events',geometryWithEvents.has(path.dataset.countryCode));
      path.classList.toggle('is-selected',chosenGeometry?.code===path.dataset.countryCode);
    });
    updateMapCamera(true);
    $('map-description').textContent='Dots group dated entries by approximate country location, not exact plants. Color shows strike calls first, then milestones, then risk windows. Only reported ongoing strikes pulse. Hover or focus a dot for a preview; select to zoom and filter. Use plus and minus to zoom and arrow keys or drag to pan. A dot does not confirm production loss.';
    $('map-selection-title').textContent=chosen==='all'?($('state').value==='active'?'Upcoming & ongoing':'Matching entries'):chosen;
    $('clear-map-selection').hidden=chosen==='all';
    $('map-events').innerHTML=selected.length?selected.map(e=>{
      const kind=isActive(e)?e.category:'inactive';
      return '<button type="button" class="map-event '+esc(kind)+'" data-event="'+esc(e.id)+'"><span class="map-event-top"><span>'+esc(e.country)+'</span><time datetime="'+esc(e.date)+'">'+esc(stateOf(e)==='ongoing'?'Ongoing':fmt(e.date,{day:'numeric',month:'short'}))+'</time></span><strong class="map-event-title">'+esc(e.title)+'</strong><span class="map-event-meta"><span><i class="swatch '+esc(kind)+'" aria-hidden="true"></i>'+esc(stateNames[stateOf(e)]||typeNames[e.category])+'</span><span aria-hidden="true">↗</span></span></button>';
    }).join(''):'<div class="empty"><strong>No dated entries match.</strong>Try another country or reset your filters. An empty result does not establish that there is no strike risk.</div>';
  }
  async function loadMap(){
    try{
      const response=await fetch('world-map.json',{cache:'force-cache',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Map unavailable');
      const countries=await response.json();
      if(!Array.isArray(countries))throw new Error('Invalid map');
      mapCountries=countries.filter(c=>c&&typeof c.d==='string'&&typeof c.name==='string');
      mapCountries.forEach(c=>{
        const names=[c.name,c.code,c.iso2,c.iso3,...(Array.isArray(c.aliases)?c.aliases:[])];
        names.filter(Boolean).forEach(name=>countryLookup.set(normalizeCountry(name),c));
      });
      $('country-paths').setAttribute('aria-hidden','true');
      $('country-paths').innerHTML=mapCountries.map(c=>'<path class="map-country" data-country-code="'+esc(c.code)+'" d="'+esc(c.d)+'"><title>'+esc(c.name)+'</title></path>').join('');
      mapReady=true;
    }catch{mapFailed=true;}
    if(month)renderMap(selectedEvents());
  }
  function selectMapCountry(element){
    const name=element.dataset.mapCountry;
    if([...$('country').options].some(option=>option.value===name)){$('country').value=name;render();focusMapCountry(name);$('clear-map-selection').focus({preventScroll:true});}
  }
  $('map-markers').addEventListener('click',event=>{if(suppressMapClick){suppressMapClick=false;return;}const marker=event.target.closest('[data-map-country]');if(marker)selectMapCountry(marker);});
  $('map-markers').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const marker=event.target.closest('[data-map-country]');if(marker){event.preventDefault();selectMapCountry(marker);}}});
  $('map-markers').addEventListener('pointerover',event=>{const marker=event.target.closest('[data-map-country]');if(marker&&event.pointerType!=='touch'&&!marker.contains(event.relatedTarget))showMapTooltip(marker);});
  $('map-markers').addEventListener('pointerout',event=>{const marker=event.target.closest('[data-map-country]');if(marker&&document.activeElement!==marker&&!marker.contains(event.relatedTarget))tooltipTimer=setTimeout(hideMapTooltip,180);});
  $('map-markers').addEventListener('focusin',event=>{const marker=event.target.closest('[data-map-country]');if(marker)showMapTooltip(marker);});
  $('map-markers').addEventListener('focusout',hideMapTooltip);
  if($('map-tooltip')){
    $('map-tooltip').addEventListener('pointerenter',()=>clearTimeout(tooltipTimer));
    $('map-tooltip').addEventListener('pointerleave',()=>{if(document.activeElement!==tooltipMarker)tooltipTimer=setTimeout(hideMapTooltip,180);});
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideMapTooltip();});
  window.addEventListener('resize',hideMapTooltip);
  $('clear-map-selection').addEventListener('click',()=>{$('country').value='all';render();moveMapCamera([0,0,1000,450],'world');$('map-world').focus({preventScroll:true});});
  ['world','europe'].forEach(mode=>$('map-'+mode).addEventListener('click',()=>{moveMapCamera(mode==='europe'?[410,45,280,126]:[0,0,1000,450],mode);}));
  if($('map-zoom-in'))$('map-zoom-in').addEventListener('click',()=>zoomMap(1/1.45));
  if($('map-zoom-out'))$('map-zoom-out').addEventListener('click',()=>zoomMap(1.45));
  if($('map-reset-view'))$('map-reset-view').addEventListener('click',()=>moveMapCamera([0,0,1000,450],'world'));
  $('world-map').addEventListener('keydown',event=>{
    if(event.target!==$('world-map'))return;
    const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(directions[event.key]){event.preventDefault();const [x,y]=directions[event.key];moveMapCamera([camera[0]+x*camera[2]*.18,camera[1]+y*camera[3]*.18,camera[2],camera[3]],camera[2]>=999?'world':'custom');}
    else if(event.key==='+'||event.key==='='){event.preventDefault();zoomMap(1/1.45);}
    else if(event.key==='-'){event.preventDefault();zoomMap(1.45);}
    else if(event.key==='Home'){event.preventDefault();moveMapCamera([0,0,1000,450],'world');}
  });
  $('world-map').addEventListener('pointerdown',event=>{
    suppressMapClick=false;
    if(camera[2]>=999||event.button!==0||!event.isPrimary)return;
    cancelAnimationFrame(cameraFrame);hideMapTooltip();
    const rect=$('world-map').getBoundingClientRect(),unit=Math.min(rect.width/camera[2],rect.height/camera[3]);
    mapDrag={id:event.pointerId,x:event.clientX,y:event.clientY,bounds:camera.slice(),unit,moved:false};
  });
  $('world-map').addEventListener('pointermove',event=>{
    if(!mapDrag||event.pointerId!==mapDrag.id)return;
    const dx=event.clientX-mapDrag.x,dy=event.clientY-mapDrag.y;
    if(!mapDrag.moved&&Math.hypot(dx,dy)<5)return;
    if(!mapDrag.moved){mapDrag.moved=true;$('world-map').setPointerCapture(event.pointerId);$('world-map').classList.add('is-panning');}
    mapExtent='custom';camera=clampCamera([mapDrag.bounds[0]-dx/mapDrag.unit,mapDrag.bounds[1]-dy/mapDrag.unit,mapDrag.bounds[2],mapDrag.bounds[3]]);updateMapCamera();
  });
  function finishMapDrag(event){
    if(!mapDrag||event.pointerId!==mapDrag.id)return;
    suppressMapClick=mapDrag.moved;
    if($('world-map').hasPointerCapture(event.pointerId))$('world-map').releasePointerCapture(event.pointerId);
    mapDrag=null;$('world-map').classList.remove('is-panning');updateMapCamera(true);
  }
  $('world-map').addEventListener('pointerup',finishMapDrag);
  $('world-map').addEventListener('pointercancel',finishMapDrag);
  window.addEventListener('pointerup',finishMapDrag);
  window.addEventListener('pointercancel',finishMapDrag);
  function setTheme(theme){
    const next=theme==='light'?'light':'dark';document.documentElement.dataset.theme=next;
    $('theme-toggle').setAttribute('aria-label',next==='dark'?'Switch to light mode':'Switch to dark mode');
    $('theme-toggle').setAttribute('aria-pressed',String(next==='light'));
    $('theme-label').textContent=next==='dark'?'Light mode':'Dark mode';
    try{localStorage.setItem('auto-strike-watch-theme',next);}catch{}
  }
  let savedTheme='dark';try{savedTheme=localStorage.getItem('auto-strike-watch-theme')||'dark';}catch{}
  setTheme(savedTheme);
  $('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  function eventButton(e){const s=stateOf(e),inactive=!isActive(e),kind=s==='ongoing'?'ONGOING':inactive?stateNames[s].toUpperCase():typeNames[e.category].toUpperCase();return '<button class="calendar-event '+esc(inactive?'inactive':e.category)+'" data-event="'+esc(e.id)+'" aria-label="'+esc(dateRange(e)+', '+stateNames[s]+': '+e.title)+'"><span class="event-type">'+esc(kind)+'</span><span class="event-title">'+esc(e.title)+'</span><span class="event-country">'+esc(e.country)+'</span></button>';}
  function calendarDates(e){const start=e.date<data.rangeStart&&stateOf(e)==='ongoing'?data.rangeStart:e.date;return {start,end:e.endDate||start};}
  function renderCalendar(selected){
    $('month-title').textContent=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(month);$('prev-month').disabled=month<=minMonth;$('next-month').disabled=month>=maxMonth;
    const first=new Date(month);first.setUTCDate(1-((first.getUTCDay()+6)%7));const last=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0,12)),cells=Math.ceil((((month.getUTCDay()+6)%7)+last.getUTCDate())/7)*7;
    let html=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>'<div class="weekday">'+day+'</div>').join(''),count=0;
    for(let i=0;i<cells;i++){const d=new Date(first);d.setUTCDate(first.getUTCDate()+i);const iso=isoDate(d),outside=d.getUTCMonth()!==month.getUTCMonth(),unavailable=iso<data.rangeStart||iso>data.rangeEnd,entries=unavailable?[]:selected.filter(e=>{const x=calendarDates(e);return x.start<=iso&&x.end>=iso;});if(!outside)count+=entries.length;
      html+='<div class="day'+(outside?' outside':'')+(unavailable?' unavailable':'')+(iso===currentDay()?' today':'')+'" aria-label="'+esc(fmt(iso))+(unavailable?' — outside planning window':'')+'"><span class="day-number">'+d.getUTCDate()+'</span>'+entries.map(eventButton).join('')+'</div>';
    }
    if(!count)html+='<div class="empty"><strong>No dated entries in this month for these filters.</strong>Use Agenda for the full planning window. An empty month does not establish that there is no strike risk.</div>';
    $('calendar').innerHTML=html;
  }
  function renderAgenda(selected){let previous='';$('agenda').innerHTML=selected.length?selected.map(e=>{const key=e.date.slice(0,7),heading=key!==previous?'<h4 class="agenda-month">'+esc(fmt(e.date,{month:'long',year:'numeric'}))+'</h4>':'';previous=key;return heading+'<button class="agenda-row" data-event="'+esc(e.id)+'"><span class="agenda-date">'+esc(e.date.slice(8,10))+'<small>'+esc(fmt(e.date,{month:'short'}))+'</small></span><span class="agenda-main">'+badge(e)+'<strong>'+esc(e.title)+'</strong><small>'+esc(e.company)+(e.site?' · '+esc(e.site):'')+' · '+esc(stateNames[stateOf(e)])+'</small></span><span class="agenda-country">'+esc(e.country)+'</span><span aria-hidden="true">↗</span></button>';}).join(''):'<div class="empty"><strong>No dated entries match these filters.</strong>Reset filters or choose another region or status.</div>';}
  function renderWatch(selected){$('watchlist').innerHTML=selected.length?selected.map(e=>'<button class="watch-card" data-watch="'+esc(e.id)+'"><div class="watch-top"><span>'+esc(e.company)+'</span><span>'+esc(e.country)+'</span></div><h3>'+esc(e.title)+'</h3><p>'+esc(e.summary)+'</p><span class="read-brief">Read source brief ↗</span></button>').join(''):'<div class="empty"><strong>No undated watch items match these filters.</strong>Unscheduled signals are kept separate from dated strikes.</div>';}
  function renderChanges(){const changes=Array.isArray(data.changes)?data.changes.slice(0,12):[];$('recent-changes').innerHTML=changes.length?changes.map(c=>'<article class="change-item"><div><span class="change-date">'+esc(fmt(c.date))+'</span>'+(c.state?'<span class="change-state">'+esc(stateNames[c.state]||c.state)+'</span>':'')+'</div><strong>'+esc(c.title)+'</strong><p>'+esc(c.description)+'</p></article>').join(''):'<p class="panel-empty">No change log is available yet. New calls, date changes, cancellations and ended action will appear here after a verified update.</p>';
    const coverage=Array.isArray(data.coverage)?data.coverage:[];$('region-coverage').innerHTML=regions.map(region=>{const c=coverage.find(x=>x.region===region||(region==='Australia / Oceania'&&['Australia/Oceania','Oceania','Australia'].includes(x.region)));return '<article class="coverage-item"><div><strong>'+esc(region)+'</strong><small>'+(c?.checkedAt?'Checked '+esc(fmt(c.checkedAt)):'Review not recorded')+'</small></div><p>'+esc(c?.note||'No regional review has been recorded. No conclusion about strike activity can be drawn.')+'</p></article>';}).join('');}
  function render(){
    if(!month)return;
    const selected=selectedEvents(),undated=selectedWatch();
    $('strike-count').textContent=selected.filter(e=>e.category==='strike'&&isActive(e)).length;
    $('watch-count').textContent=selected.filter(e=>e.category!=='strike'&&isActive(e)).length;
    $('undated-count').textContent=undated.length;
    $('vw-count').textContent=[...selected,...undated].filter(e=>e.relevance==='vw'&&isActive(e)).length;
    $('result-count').textContent=selected.length+' dated '+(selected.length===1?'entry':'entries')+' · '+($('region').value==='all'?'Worldwide':$('region').value)+' · '+fmt(data.rangeStart)+' – '+fmt(data.rangeEnd);
    $('calendar').hidden=view!=='month';$('agenda').hidden=view!=='agenda';$('map-panel').hidden=view!=='map';
    ['map','month','agenda'].forEach(v=>{$(v+'-view').classList.toggle('active',view===v);$(v+'-view').setAttribute('aria-pressed',String(view===v));});
    document.querySelector('.month-navigation').hidden=view!=='month';
    if($('calendar-tools'))$('calendar-tools').hidden=view!=='month';
    renderHeader();renderMap(selected);renderCalendar(selected);renderAgenda(selected);renderWatch(undated);renderChanges();
    $('export-ics').disabled=!selected.length;$('export-csv').disabled=!selected.length;
  }
  function sourceList(sources){return (sources||[]).map(s=>{let url;try{url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))return '';}catch{return '';}return '<li><a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">'+esc(s.name||url.hostname)+' ↗</a><small>'+(s.published?'Published / updated '+esc(fmt(s.published))+' · ':'')+esc(url.hostname)+'</small></li>';}).join('');}
  function showDetail(e,undated=false){const s=stateOf(e);$('detail-content').innerHTML=badge(e,undated)+'<h2 id="detail-title">'+esc(e.title)+'</h2><div class="detail-date">'+(undated?'No action date confirmed':esc(dateRange(e)))+(e.time?' · '+esc(e.time):'')+'</div><dl class="detail-facts"><div><dt>Company / exposure</dt><dd>'+esc(e.company||'—')+'</dd></div><div><dt>Location</dt><dd>'+esc([e.site,e.country,regionFor(e)].filter(Boolean).join(', '))+'</dd></div><div><dt>Current status</dt><dd>'+esc(stateNames[s]||s)+' · '+esc(e.status||'')+'</dd></div><div><dt>Relevance</dt><dd>'+esc(relevanceNames[e.relevance]||'General disruption')+'</dd></div><div><dt>Last checked</dt><dd>'+esc(fmt(e.lastChecked||data.asOf))+'</dd></div>'+(e.scope?'<div><dt>Scope</dt><dd>'+esc(e.scope)+'</dd></div>':'')+'</dl><div class="detail-section"><h3>What is known</h3><p>'+esc(e.summary)+'</p></div>'+(e.impact?'<div class="detail-section"><h3>Production / supply-chain relevance</h3><p>'+esc(e.impact)+'</p></div>':'')+'<div class="detail-section"><h3>Original sources</h3><ul class="source-list">'+sourceList(e.sources)+'</ul></div><div class="dialog-note">Last saved research: '+esc(timestamp(data.updatedAt||data.asOf))+'. A call does not confirm participation or lost production. Unknown end dates are not shown as an assumed continuous shutdown.</div>';$('detail-dialog').showModal();$('close-dialog').focus();}
  document.addEventListener('click',event=>{const b=event.target.closest('[data-event]'),w=event.target.closest('[data-watch]');if(b){const e=events.find(e=>e.id===b.dataset.event);if(e)showDetail(e);}if(w){const e=watchlist.find(e=>e.id===w.dataset.watch);if(e)showDetail(e,true);}});
  $('close-dialog').addEventListener('click',()=>$('detail-dialog').close());$('detail-dialog').addEventListener('click',event=>{if(event.target===$('detail-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
  ['region','country','category','relevance','state'].forEach(id=>$(id).addEventListener('change',()=>{render();if(id==='country'){if($('country').value==='all')moveMapCamera([0,0,1000,450],'world');else focusMapCountry($('country').value);}}));$('search').addEventListener('input',render);$('reset').addEventListener('click',()=>{$('search').value='';['region','country','category','relevance'].forEach(id=>$(id).value='all');$('state').value='active';render();moveMapCamera([0,0,1000,450],'world');});
  $('prev-month').addEventListener('click',()=>{if(month>minMonth){month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()-1,1,12));render();}});$('next-month').addEventListener('click',()=>{if(month<maxMonth){month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,1,12));render();}});['map','month','agenda'].forEach(v=>$(v+'-view').addEventListener('click',()=>{view=v;render();}));
  function download(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
  const icsEscape=v=>String(v??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  function foldLine(line){const parts=[];let segment='',size=0;for(const character of line){const bytes=new TextEncoder().encode(character).length;if(size+bytes>74){parts.push(segment);segment=' ';size=1;}segment+=character;size+=bytes;}parts.push(segment);return parts.join('\r\n');}
  function sourceDescription(e){return (e.sources||[]).map(s=>(s.name||'Source')+(s.published?' (published/updated '+s.published+')':'')+': '+s.url);}
  $('export-ics').addEventListener('click',()=>{const selected=selectedEvents();if(!selected.length)return;const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Auto Strike Watch//Worldwide Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Auto Strike Watch — snapshot '+data.asOf],stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    selected.forEach(e=>{const end=dateObject(e.endDate||e.date);end.setUTCDate(end.getUTCDate()+1);const s=stateOf(e),description=[typeNames[e.category],stateNames[s],e.status,e.summary,e.impact,e.time?'Published time: '+e.time:'','Last checked: '+(e.lastChecked||data.asOf),'Snapshot only. No subscription to later changes. All-day placement does not establish duration or production loss.',...sourceDescription(e)].filter(Boolean).join('\n\n');const status=s==='cancelled'?'CANCELLED':(['risk','postponed','past','unverified'].includes(s)||e.status==='Conditional deadline'?'TENTATIVE':'CONFIRMED');lines.push('BEGIN:VEVENT','UID:'+icsEscape(e.id)+'@auto-strike-watch.local','DTSTAMP:'+stamp,'SEQUENCE:'+(Number(data.revision)||0),'DTSTART;VALUE=DATE:'+e.date.replaceAll('-',''),'DTEND;VALUE=DATE:'+isoDate(end).replaceAll('-',''),'SUMMARY:'+icsEscape('['+stateNames[s]+'] '+e.title),'DESCRIPTION:'+icsEscape(description),'LOCATION:'+icsEscape([e.site,e.country].filter(Boolean).join(', ')),'TRANSP:TRANSPARENT','STATUS:'+status);if(e.sources?.[0]?.url)lines.push('URL:'+e.sources[0].url);lines.push('END:VEVENT');});
    lines.push('END:VCALENDAR');download('auto-strike-watch-'+data.asOf+'.ics',lines.map(foldLine).join('\r\n')+'\r\n','text/calendar;charset=utf-8');toast('Filtered calendar snapshot downloaded. Future changes are not subscribed.');});
  $('export-csv').addEventListener('click',()=>{const selected=selectedEvents();if(!selected.length)return;const columns=['Start date','End date','Entry type','State','Title','Company','Region','Country','Site','Relevance','Scope','Status detail','Summary','Impact / uncertainty','Published time','Last checked','Sources with dates','Snapshot date','Revision'];const safe=value=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const rows=[columns,...selected.map(e=>[e.date,e.endDate||'',typeNames[e.category],stateNames[stateOf(e)],e.title,e.company,regionFor(e),e.country,e.site,relevanceNames[e.relevance],e.scope,e.status,e.summary,e.impact,e.time,e.lastChecked||data.asOf,sourceDescription(e).join(' | '),data.asOf,data.revision])];download('auto-strike-watch-'+data.asOf+'.csv','\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('Filtered CSV downloaded with status, source dates and last-checked dates.');});
  loadMap();refresh(true);setInterval(()=>{if(!document.hidden)refresh();},5*60*1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
