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


test('detailed maps initialize only after successful login and receive the filtered list',async()=>{
 const f=await fixture({detailedMap:true});assert.equal(f.mapCalls.created,0);
 await f.login('wrong');assert.equal(f.mapCalls.created,0);
 await f.login('valid-password');assert.equal(f.mapCalls.created,1);assert.equal(f.context.state().detailReady,true);
 f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nSupplier A,001234567,Czechia,Prague,50,14\nSupplier B,001234568,Germany,Berlin,52,13';f.nodes.get('importButton').onclick();
 assert.equal(f.mapCalls.updates.at(-1).length,2);
 f.nodes.get('search').value='Supplier B';f.nodes.get('search').listeners.input();
 assert.equal(f.mapCalls.updates.at(-1).length,1);assert.equal(f.mapCalls.updates.at(-1)[0].name,'Supplier B');
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
const supplierRow = (id,name) => ({id,name,duns:'010234567',city:'Brno',country:'Czechia',warnings:[]});
const registerFor = (company, title='Reviewed factory action') => ({
  ...emptyCalendar,
  events:[{id:'action',title,company,country:'Czechia',site:'Brno',scope:'named-site',state:'risk',category:'risk',
    screening:{decision:'watch',reason:'Await a dated strike call.'},lastChecked:'2026-11-17',
    sources:[{name:'Employer statement',published:'2026-11-16',url:'https://example.org/notice'}]}],
  screeningRules:{summary:'Verify the named site.'}, coverageNote:'Trade union and employer registers checked.'
});
const nodeText = el => [el.textContent,...el.children.map(nodeText)].join(' ');
const settled = () => new Promise(resolve=>setTimeout(resolve,0));

test('screening uses all authorized suppliers while table filters are active and reuses sourced upstream decisions',async()=>{
  const calendar=registerFor('Example Automotive');
  const requests=[];
  const f=await fixture({sharedRows:[supplierRow('s1','Example Automotive GmbH'),supplierRow('s2','Elsewhere AG')],
    screeningLoad:async(...args)=>{requests.push(args);return {calendar,coverage:'Saved fallback'};},
    projectLoad:async()=>registerFor('Elsewhere','Separate project action')});
  assert.equal(requests.length,0);
  await f.login('valid-password');await settled();
  f.nodes.get('search').value='Elsewhere';f.nodes.get('search').listeners.input();
  await f.nodes.get('refreshScreening').onclick();
  const publicResult=nodeText(f.nodes.get('publicMatches'));
  for(const detail of ['1 of 2','Example Automotive GmbH','Watch / reconfirm','Await a dated strike call.','Employer statement','2026-11-17','Saved fallback','Verify the named site.']) assert.ok(publicResult.includes(detail),detail);
  assert.match(nodeText(f.nodes.get('projectMatches')),/Separate project action/);
  assert.ok(requests.every(args=>args.length===0),'network calendar loader never receives supplier rows');
  f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nNew Supplier,001234567,Czechia,Brno';
  f.nodes.get('importButton').onclick();await settled();
  assert.match(nodeText(f.nodes.get('publicMatches')),/0 of 1/);
  assert.doesNotMatch(nodeText(f.nodes.get('publicMatches')),/Example Automotive/);
});
test('private register works during public failure and removal clears the local result',async()=>{
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    screeningLoad:async()=>{throw Error('Connection unavailable.');},projectLoad:async()=>{throw Error('Unavailable.');}});
  await f.login('valid-password');await settled();
  assert.match(nodeText(f.nodes.get('publicMatches')),/unavailable/i);
  assert.match(nodeText(f.nodes.get('projectMatches')),/unavailable/i);
  const input=f.nodes.get('privateRegister');
  const file={name:'register.json',size:500,text:async()=>JSON.stringify(registerFor('Private Supplier','Private observation'))};
  await input.onchange({target:{files:[file]}});
  assert.match(nodeText(f.nodes.get('privateMatches')),/Private observation/);
  assert.equal(f.nodes.get('removeRegister').hidden,false);
  f.nodes.get('removeRegister').onclick();assert.equal(nodeText(f.nodes.get('privateMatches')).trim(),'');
  assert.equal(f.nodes.get('removeRegister').hidden,true);
});
test('signout invalidates delayed public, owner register and local file results',async()=>{
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
  for(const id of ['publicMatches','privateMatches','projectMatches','registerStatus']) assert.equal(nodeText(f.nodes.get(id)).trim(),'');
  assert.equal(f.nodes.get('refreshScreening').disabled,true);
});
test('viewer can screen the authorized list without requesting the owner project register',async()=>{
  let projectRequests=0;
  const calendar=registerFor('Example Automotive');
  const f=await fixture({role:'viewer',sharedRows:[supplierRow('s1','Example Automotive')],
    screeningLoad:async()=>({calendar,coverage:'Live calendar'}),projectLoad:()=>{projectRequests++;return calendar;}});
  await f.login('valid-password');await settled();
  assert.match(nodeText(f.nodes.get('publicMatches')),/1 of 1/);
  assert.equal(projectRequests,0);
});
test('owner screening automatically checks live discovery and manual recheck can force a fresh read',async()=>{
  const requests=[];
  const f=await fixture({sharedRows:[supplierRow('s1','Supplier')],hazardLoad:async(list,options)=>{
    requests.push(options.force);
    if(options.force)throw Error('Tracker did not respond.');
    return {coverage:'Latest public incident sample; six-hour window',recordCount:25,consideredCount:4,
      matches:[],checkedAt:'2026-11-18T06:00:00Z',sourceURL:'https://example.org/'};
  }});
  await f.login('valid-password');await settled();
  assert.deepEqual(requests,[false]);
  await f.nodes.get('refreshScreening').onclick();
  assert.deepEqual(requests,[false,false]);
  const text=nodeText(f.nodes.get('trackerResults'));
  for(const detail of ['six-hour window','25','4','Supplier leads · 0','06:00:00Z'])assert.ok(text.includes(detail),detail);
  await f.nodes.get('checkTracker').onclick();
  assert.deepEqual(requests,[false,false,true]);
  assert.match(nodeText(f.nodes.get('trackerResults')),/unavailable/i);
  assert.doesNotMatch(nodeText(f.nodes.get('trackerResults')),/Supplier leads · 0/);
});
test('membership downgrade clears owner findings and discards in-flight discovery results',async()=>{
  let finish;
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    projectLoad:async()=>registerFor('Private Supplier','Restricted internal finding'),
    hazardLoad:()=>new Promise(resolve=>finish=resolve)});
  await f.login('valid-password');await settled();
  assert.match(nodeText(f.nodes.get('projectMatches')),/Restricted internal finding/);
  f.setRole('viewer');await f.context.recheck();await settled();
  finish({matches:[],recordCount:10,consideredCount:2,coverage:'Private scan'});
  await settled();
  assert.equal(f.nodes.get('trackerPanel').hidden,true);
  assert.equal(nodeText(f.nodes.get('trackerResults')).trim(),'');
  assert.equal(nodeText(f.nodes.get('projectMatches')).trim(),'');
});
test('project rules retain nested categories and operational review leads are distinct from site matches',async()=>{
  const calendar=registerFor('Example Automotive');
  const primary=calendar.events[0];
  calendar.events.push({...primary,id:'group',site:'',scope:'company and regional workplaces',title:'Bargaining across locations'});
  calendar.screeningRules={summary:'Named facility check.',thresholds:{naturalHazards:['Verify road and power disruptions.']}};
  const f=await fixture({sharedRows:[supplierRow('s1','Example Automotive')],projectLoad:async()=>calendar});
  await f.login('valid-password');await settled();
  const output=nodeText(f.nodes.get('projectMatches'));
  for(const detail of ['Company and city match (1)','Company only · site unverified (1)','natural Hazards','Verify road and power disruptions.'])assert.ok(output.includes(detail),detail);
});
test('late project policy annotates public, owner and tracker results while keeping each original decision',async()=>{
  let finishProject;
  const calendar=registerFor('Example Automotive');
  const project={...calendar,assessmentPolicy:{version:'rules v2'},
    sourceRegistry:[{name:'Private alerting system',role:'Discovery',checkStatus:'Manual review only'}]};
  const f=await fixture({sharedRows:[supplierRow('s1','Example Automotive')],
    projectLoad:()=>new Promise(resolve=>finishProject=resolve),
    screeningLoad:async()=>({calendar,coverage:'Live calendar'}),
    assess:(match,policy)=>policy.version+' / '+match.decision,
    hazardLoad:async list=>({coverage:'Live tracker sample',recordCount:1,consideredCount:1,checkedAt:'2026-11-18T10:00:00Z',
      matches:[{supplier:list[0],event:calendar.events[0],decision:'unreviewed',kind:'locality',basis:'City only',reason:'Check facilities.'}]})});
  await f.login('valid-password');await settled();
  finishProject(project);await settled();
  for(const id of ['publicMatches','projectMatches']){
    const output=nodeText(f.nodes.get(id));
    assert.match(output,/Watch \/ reconfirm/);
    assert.match(output,/Project assessment · rules v2 \/ watch/);
  }
  const tracker=nodeText(f.nodes.get('trackerResults'));
  assert.match(tracker,/Screening pending/);
  assert.match(tracker,/Project assessment · rules v2 \/ unreviewed/);
  const own=nodeText(f.nodes.get('projectMatches'));
  for(const detail of ['Private alerting system','Discovery','Manual review only'])assert.ok(own.includes(detail),detail);
});
