import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {norm,parseSuppliers,csvExport,point} from './core.mjs';
import {AccessError,ConflictError,configured} from './auth-core.mjs';

import {createScreeningPanel} from './screening-panel.mjs';
import {matchSuppliers} from './screen-matches.mjs';
const strikeContext = {};
vm.runInNewContext(await readFile(new URL('../strike-core.js', import.meta.url),'utf8'),strikeContext);
const {StrikeCore} = strikeContext;
const emptyCalendar = {events:[],watchlist:[],asOf:'2026-11-17'};
const source=await readFile(new URL('./app.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
class Element {
  constructor(id=''){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.children=[];this.style={};this.attrs={};this.classList={toggle(){}};this.listeners={};this.open=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  add(node){this.append(node);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this.listeners[k]=v;}
  setPointerCapture(){}
  getBoundingClientRect(){return {width:300,height:600};}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
async function fixture({configuredService=true,role='owner',loadFailure=false,cityPartCount=1,failedCityPart=null,detailedMap=false,deferMap=false,teardownFailure=false,assess=()=>"",hazardLoad=async()=>{throw Error("Unavailable");},sharedRows=[],screeningLoad=async()=>({calendar:emptyCalendar,coverage:'Live calendar'}),projectLoad=async()=>null}={}){
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  nodes.get('workspaceMain').hidden=true;nodes.get('loginForm').hidden=true;
  const editable=new Set([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*data-edit[^>]*>/g)].map(m=>nodes.get(m[1])));
  let saves=0,identity=null;
  const mapCalls={created:0,destroyed:0,updates:[],fits:[],focused:[],options:null};
  let completeMap;
  const createSupplierMap=async options=>{
    mapCalls.created++;mapCalls.options=options;
    if(!detailedMap)throw Error('Detailed map unavailable in this fixture.');
    const controller={update:rows=>mapCalls.updates.push(structuredClone(rows)),fit:rows=>mapCalls.fits.push(structuredClone(rows)),focus:row=>mapCalls.focused.push(row.id),destroy:()=>{mapCalls.destroyed++;if(teardownFailure)throw Error('Map teardown failed');},resize(){},world(){},europe(){},zoom(){}};
    if(deferMap)await new Promise(resolve=>completeMap=resolve);
    options.onReady();return controller;
  };
  const dataset={id:'main',revision:2,suppliers:sharedRows};
  class Auth {
    constructor(){this.session=null;}
    async signIn(email,password){if(password!=='valid-password')throw new AccessError('Sign-in failed.');return {id:'member',email,name:'Test member',role};}
    async signOut(){this.session=null;}
    async loadScreeningRegister(){return projectLoad();}
    async verify(){return {id:'member',email:'member@example.com',name:'Test member',role};}
    async loadShared(){if(loadFailure)throw Error('Service unavailable.');return structuredClone(dataset);}
    async saveShared(rows,revision){saves++;assert.equal(revision,dataset.revision);dataset.suppliers=structuredClone(rows);dataset.revision++;return structuredClone(dataset);}
  }
  let cityRequests=0,maxCityRequests=0,totalCityRequests=0;
  const parts=Array.from({length:cityPartCount},(_,i)=>'part-'+String(i+1).padStart(3,'0')+'.json');
  const fetcher=async path=>{
    if(path==='./config.json')return {ok:true,json:async()=>configuredService?{supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'sb_publishable_test'}:{}};
    if(path==='./cities/manifest.json')return {ok:true,json:async()=>({recordCount:parts.length,parts})};
    if(path.startsWith('./cities/part-')){
      totalCityRequests++;cityRequests++;maxCityRequests=Math.max(maxCityRequests,cityRequests);
      await new Promise(resolve=>setTimeout(resolve,0));cityRequests--;
      return {ok:!path.endsWith(failedCityPart||'MISSING'),json:async()=>[['Prague','Prague','Praha',50.0755,14.4378,'CZ','52']]};
    }
    if(path==='./world-map.json')return {ok:true,json:async()=>[]};
    throw Error('Unexpected fetch '+path);
  };
  const context=vm.createContext({createScreeningPanel,projectAssessment:assess,loadHazardLeads:hazardLoad,matchSuppliers,loadCalendar:screeningLoad,readPrivateRegister:JSON.parse,console,Map,Set,Intl,Number,String,Object,Array,Math,Date,URL,Blob,AbortController,AbortSignal,Promise,Error,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},norm,parseSuppliers,csvExport,point,AccessError,ConflictError,configured,AuthClient:Auth,createSupplierMap,setIdentity:v=>identity=v,confirm:()=>true,setInterval:()=>0,setTimeout,clearTimeout,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{StrikeCore,addEventListener(){}},document:{visibilityState:'visible',getElementById:id=>{if(!nodes.has(id))throw Error('Missing DOM id '+id);return nodes.get(id);},querySelectorAll:()=>[...editable,...[...nodes.values()].flatMap(n=>n.children).filter(n=>n?.attrs?.['data-edit']!==undefined)],createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){}},fetch:fetcher});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/start\(\);\s*$/,'globalThis.ready=start();')+'\nglobalThis.state=()=>({rows,dirty,identity,loaded,view,detailReady});',context);
  await context.ready;
  const login=async password=>{nodes.get('loginEmail').value='member@example.com';nodes.get('loginPassword').value=password;await nodes.get('loginForm').onsubmit({preventDefault(){}});};
  return {nodes,context,login,mapCalls,setRole:value=>{role=value;},completeMap:()=>completeMap?.(),saves:()=>saves,identity:()=>identity,cityRequests:()=>totalCityRequests,maxCityRequests:()=>maxCityRequests};
}
test('unconfigured deployment stays locked and does not offer a pretend login',async()=>{const f=await fixture({configuredService:false});assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('loginForm').hidden,true);assert.match(f.nodes.get('authNotice').textContent,/setup is not finished/i);assert.equal(f.context.state().rows.length,0);});
test('failed login stays locked and clears password',async()=>{const f=await fixture();await f.login('wrong');assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('loginPassword').value,'');assert.equal(f.identity(),null);});
test('owner imports DUNS safely, maps an offline city, and saves only on explicit action',async()=>{const f=await fixture();await f.login('valid-password');assert.equal(f.nodes.get('workspaceMain').hidden,false);f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nSupplier A,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();assert.equal(f.context.state().rows[0].duns,'001234567');assert.equal(f.context.state().rows[0].lat,50.0755);assert.equal(f.context.state().rows[0].precision,'Approximate city');assert.equal(f.saves(),0);assert.equal(f.context.state().dirty,true);await f.nodes.get('saveButton').onclick();assert.equal(f.saves(),1);assert.equal(f.context.state().dirty,false);});
test('viewer cannot import or save even if handlers are invoked directly',async()=>{const f=await fixture({role:'viewer'});await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nSupplier A,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();await f.nodes.get('saveButton').onclick();assert.equal(f.context.state().rows.length,0);assert.equal(f.saves(),0);assert.equal(f.nodes.get('importButton').disabled,true);});
test('failed initial dataset load does not allow editing an assumed empty list',async()=>{const f=await fixture({loadFailure:true});await f.login('valid-password');assert.equal(f.context.state().loaded,false);assert.equal(f.nodes.get('importButton').disabled,true);assert.match(f.nodes.get('saveState').textContent,/not loaded/);});
test('logout removes working supplier data and private form contents',async()=>{const f=await fixture();await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nPrivate Supplier,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();await f.nodes.get('logoutButton').onclick();assert.equal(f.context.state().rows.length,0);assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('pasteInput').value,'');assert.equal(f.nodes.get('tableBody').children.length,0);assert.equal(f.identity(),null);});
test('map dragging follows the pointer equally on both axes in a tall viewport',async()=>{const f=await fixture();const map=f.nodes.get('map');map.listeners.pointerdown({button:0,clientX:0,clientY:0,pointerId:1,target:{closest:()=>null}});map.listeners.pointermove({clientX:30,clientY:30});assert.deepEqual(Array.from(f.context.state().view),[-100,-100,1000,500]);map.listeners.lostpointercapture();map.listeners.pointermove({clientX:60,clientY:60});assert.deepEqual(Array.from(f.context.state().view),[-100,-100,1000,500]);});
test('correcting an invalid location clears only the resolved coordinate warning',async()=>{const f=await fixture();await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nSupplier A,bad,Czechia,Praha,999,14\nSupplier B,001234567,Germany,Unknown town,999,14';f.nodes.get('importButton').onclick();const [offline,manual]=f.context.state().rows;assert.equal(offline.lat,50.0755);assert.equal(offline.warnings.length,1);assert.match(offline.warnings[0],/DUNS/);assert.equal(manual.warnings[0],'Invalid coordinates');f.context.edit(manual.id);f.nodes.get('editLat').value='52.5';f.nodes.get('editLon').value='13.4';f.nodes.get('editForm').onsubmit({preventDefault(){}});assert.equal(manual.lat,52.5);assert.equal(manual.warnings.length,0);});

test('city shards load only after login, with at most four requests active',async()=>{const f=await fixture({cityPartCount:9});assert.equal(f.cityRequests(),0);await f.login('valid-password');assert.equal(f.cityRequests(),9);assert.equal(f.maxCityRequests(),4);await f.nodes.get('logoutButton').onclick();await f.login('valid-password');assert.equal(f.cityRequests(),9);});
test('missing city shard disables offline matches while imported coordinates remain usable',async()=>{const f=await fixture({cityPartCount:5,failedCityPart:'part-002.json'});await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nNeeds lookup,001234567,Czechia,Praha,,\nProvided,001234568,Czechia,Praha,50,14';f.nodes.get('importButton').onclick();assert.equal(f.context.state().rows[0].lat,null);assert.equal(f.context.state().rows[1].lat,50);assert.equal(f.context.state().loaded,true);});


test('detailed maps initialize only after successful login and keep all sites when the register is filtered',async()=>{
 const f=await fixture({detailedMap:true});assert.equal(f.mapCalls.created,0);
 await f.login('wrong');assert.equal(f.mapCalls.created,0);
 await f.login('valid-password');assert.equal(f.mapCalls.created,1);assert.equal(f.context.state().detailReady,true);
 f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nSupplier A,001234567,Czechia,Prague,50,14\nSupplier B,001234568,Germany,Berlin,52,13';f.nodes.get('importButton').onclick();
 assert.equal(f.mapCalls.updates.at(-1).length,2);
 f.nodes.get('search').value='Supplier B';f.nodes.get('search').listeners.input();
 assert.deepEqual(f.mapCalls.updates.at(-1).map(row=>row.name),['Supplier A','Supplier B']);assert.equal(f.nodes.get('tableBody').children.length,1);
 await f.nodes.get('logoutButton').onclick();assert.equal(f.mapCalls.destroyed,1);assert.equal(f.context.state().detailReady,false);assert.equal(f.nodes.get('map').hidden,false);
});
test('signing out during map startup discards the late map and keeps private details cleared',async()=>{
 const f=await fixture({detailedMap:true,deferMap:true});await f.login('valid-password');
 await f.nodes.get('logoutButton').onclick();f.completeMap();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(f.mapCalls.destroyed,1);assert.equal(f.mapCalls.updates.length,0);assert.equal(f.context.state().detailReady,false);assert.equal(f.nodes.get('mapPopup').hidden,true);
});
test('a detailed-map failure leaves the basic map and working supplier list available',async()=>{
 const f=await fixture();await f.login('valid-password');
 assert.equal(f.context.state().detailReady,false);assert.equal(f.nodes.get('map').hidden,false);assert.match(f.nodes.get('mapStatus').textContent,/basic world map/);assert.equal(f.context.state().loaded,true);
});

test('sign-out still clears private data if map teardown fails',async()=>{const f=await fixture({detailedMap:true,teardownFailure:true});await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nPrivate Supplier,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();await f.nodes.get('logoutButton').onclick();assert.equal(f.context.state().rows.length,0);assert.equal(f.identity(),null);assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('mapPopup').hidden,true);});
const supplierRow = (id,name) => ({id,name,duns:'01023456'+id.slice(-1),city:'Brno',country:'Czechia',warnings:[],lat:49,lon:16});
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const registerFor = (company,title='Reviewed factory action',active=false) => ({
  ...emptyCalendar, asOf:today,
  events:[{id:'action',title,company,country:'Czechia',site:'Brno',scope:'named-site',
    state:active?'ongoing':'risk',category:active?'strike':'risk',date:active?today:undefined,relevance:'supplier',
    screening:{decision:active?'candidate':'watch',reason:active?'Confirmed strike at the plant.':'Await a dated strike call.'},
    lastChecked:today,sources:[{name:'Employer statement',published:today,url:'https://example.org/notice'}]}],
  screeningRules:{summary:'Verify the named site.'},coverageNote:'Trade union and employer registers checked.'
});
const nodeText = el => [el.textContent,...el.children.map(nodeText)].join(' ');
const descendants = el => [el,...el.children.flatMap(descendants)];
const settled = () => new Promise(resolve=>setTimeout(resolve,0));
const findings = f => f.nodes.get('screeningResults');
function openEvidence(f) {
  for(const detail of descendants(findings(f)).filter(n=>n.className==='scan-evidence')) {
    detail.open=true;detail.listeners.toggle();
  }
  return nodeText(findings(f));
}

test('one action scans the entire list, groups overlapping source evidence and updates the unfiltered map',async()=>{
  const requests=[],hazardRequests=[];
  const rows=[supplierRow('s1','Example Automotive GmbH'),supplierRow('s2','Elsewhere AG')];
  const calendar=registerFor('Example Automotive','Union reports an active plant stoppage',true);
  const f=await fixture({sharedRows:rows,detailedMap:true,
    screeningLoad:async(...args)=>{requests.push(args);return {calendar,coverage:'Live calendar'};},
    projectLoad:async()=>registerFor('Elsewhere','Project watch'),
    hazardLoad:async(list,options)=>{hazardRequests.push([list.length,options.force]);return {
      coverage:'Live sample',checkedAt:today,matches:[{supplier:list[0],event:calendar.events[0],decision:'unreviewed',kind:'locality',basis:'City only',reason:'Local hazard lead.'}]};}
  });
  assert.equal(requests.length,0);
  await f.login('valid-password');await settled();
  f.nodes.get('search').value='Elsewhere';f.nodes.get('search').listeners.input();
  await f.nodes.get('refreshScreening').onclick();
  assert.deepEqual(hazardRequests,[[2,false],[2,true]]);
  assert.ok(requests.every(args=>args.length===0));
  assert.match(f.nodes.get('scanStatus').textContent,/2 suppliers scanned.*1 red.*1 yellow/);
  assert.deepEqual(descendants(findings(f)).filter(n=>n.className==='scan-dot').map(n=>n.attrs['data-level']),['red','yellow']);
  const details=openEvidence(f);
  for(const expected of ['Example Automotive GmbH','Elsewhere AG','Active site incident','Needs review','Union reports','Project watch','Employer statement','Global Incident Tracker','Local hazard lead.']) assert.ok(details.includes(expected),expected);
  assert.deepEqual(f.mapCalls.updates.at(-1).map(r=>r.screeningLevel),['red','yellow']);
  assert.ok(!f.context.state().rows.some(r=>Object.hasOwn(r,'screeningLevel')),'scan indicators are transient');
  assert.doesNotMatch(html,/id="checkTracker"/);
  f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nNew Supplier,001234567,Czechia,Brno';
  f.nodes.get('importButton').onclick();await settled();
  assert.doesNotMatch(nodeText(findings(f)),/Example Automotive|Elsewhere/);
});

test('partial or unavailable sources remain explicit and a local file can supply independent evidence',async()=>{
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    screeningLoad:async()=>{throw Error('Calendar connection unavailable.');},projectLoad:async()=>{throw Error('Register unavailable.');}});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('scanStatus').textContent,/unavailable/i);
  assert.match(f.nodes.get('scanCoverage').textContent,/unavailable/i);
  assert.doesNotMatch(nodeText(findings(f)),/no supplier signals/i);
  const file={name:'register.json',size:500,text:async()=>JSON.stringify(registerFor('Private Supplier','Private observation'))};
  await f.nodes.get('privateRegister').onchange({target:{files:[file]}});
  assert.match(openEvidence(f),/Private observation/);
  assert.equal(f.nodes.get('removeRegister').hidden,false);
  f.nodes.get('removeRegister').onclick();
  assert.doesNotMatch(nodeText(findings(f)),/Private observation|Private Supplier/);
  assert.equal(f.nodes.get('removeRegister').hidden,true);
});

test('signout discards delayed source and file responses without restoring signals',async()=>{
  let publicDone,projectDone,fileDone;
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    screeningLoad:()=>new Promise(r=>publicDone=r),projectLoad:()=>new Promise(r=>projectDone=r)});
  await f.login('valid-password');
  const file={name:'private.json',size:5,text:()=>new Promise(r=>fileDone=r)};
  const uploading=f.nodes.get('privateRegister').onchange({target:{files:[file]}});
  await f.nodes.get('logoutButton').onclick();
  const calendar=registerFor('Private Supplier');
  publicDone({calendar,coverage:'Live calendar'});projectDone(calendar);fileDone(JSON.stringify(calendar));
  await uploading;await settled();
  for(const id of ['screeningResults','screeningSources','scanStatus','scanCoverage','registerStatus']) assert.equal(nodeText(f.nodes.get(id)).trim(),'');
  assert.equal(f.nodes.get('refreshScreening').disabled,true);
});

test('viewers scan their authorized list without requesting private owner sources',async()=>{
  let ownerRequests=0;
  const f=await fixture({role:'viewer',sharedRows:[supplierRow('s1','Example Automotive')],
    screeningLoad:async()=>({calendar:registerFor('Example Automotive'),coverage:'Live calendar'}),
    projectLoad:()=>{ownerRequests++;},hazardLoad:()=>{ownerRequests++;}});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('scanStatus').textContent,/1 yellow/); assert.equal(ownerRequests,0);
  assert.doesNotMatch(nodeText(f.nodes.get('screeningSources')),/Project register|Global Incident Tracker/);
});

test('membership downgrade discards the old scan and clears confidential results',async()=>{
  let finish;
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    projectLoad:async()=>registerFor('Private Supplier','Restricted internal finding'),
    hazardLoad:()=>new Promise(resolve=>finish=resolve)});
  await f.login('valid-password');await settled();
  f.setRole('viewer');await f.context.recheck();await settled();
  finish({matches:[],recordCount:10,consideredCount:2,coverage:'Private scan'});await settled();
  assert.doesNotMatch(nodeText(f.nodes.get('screeningSources')),/Project register|Private scan/);
  assert.doesNotMatch(nodeText(findings(f)),/Restricted internal finding/);
});

test('owner policy, source provenance, and individual provider decisions remain available after grouping',async()=>{
  let finishProject;
  const calendar=registerFor('Example Automotive','Public finding');
  const project={...registerFor('Example Automotive','Private finding'),assessmentPolicy:{version:'rules v2'},
    screeningRules:{thresholds:{naturalHazards:['Verify roads and power.']}},
    sourceRegistry:[{name:'Private alerting system',role:'Discovery',checkStatus:'Manual review only'}]};
  const f=await fixture({sharedRows:[supplierRow('s1','Example Automotive')],projectLoad:()=>new Promise(r=>finishProject=r),
    screeningLoad:async()=>({calendar,coverage:'Live calendar'}),assess:(match,policy)=>policy.version+' / '+match.decision,
    hazardLoad:async list=>({coverage:'Live tracker sample',checkedAt:today,
      matches:[{supplier:list[0],event:calendar.events[0],decision:'unreviewed',kind:'locality',basis:'City only',reason:'Check facilities.'}]})});
  await f.login('valid-password');await settled();finishProject(project);await settled();
  assert.equal(descendants(findings(f)).filter(n=>n.className==='scan-evidence').length,1);
  const evidence=openEvidence(f);
  for(const expected of ['Public finding','Private finding','Watch / reconfirm','rules v2 / watch','rules v2 / unreviewed','Screening pending'])assert.ok(evidence.includes(expected),expected);
  const coverage=nodeText(f.nodes.get('screeningSources'));
  for(const expected of ['Verify roads and power.','Private alerting system','Discovery','Manual review only'])assert.ok(coverage.includes(expected),expected);
});
