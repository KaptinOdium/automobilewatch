import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {norm,parseSuppliers,csvExport,point} from './core.mjs';
import {AccessError,ConflictError,configured} from './auth-core.mjs';

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
async function fixture({configuredService=true,role='owner',loadFailure=false,cityPartCount=1,failedCityPart=null}={}){
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  nodes.get('workspaceMain').hidden=true;nodes.get('loginForm').hidden=true;
  const editable=new Set([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*data-edit[^>]*>/g)].map(m=>nodes.get(m[1])));
  let saves=0,identity=null;
  const dataset={id:'main',revision:2,suppliers:[]};
  class Auth {
    constructor(){this.session=null;}
    async signIn(email,password){if(password!=='valid-password')throw new AccessError('Sign-in failed.');return {id:'member',email,name:'Test member',role};}
    async signOut(){this.session=null;}
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
  const context=vm.createContext({console,Map,Set,Intl,Number,String,Object,Array,Math,Date,URL,Blob,AbortController,AbortSignal,Promise,Error,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},norm,parseSuppliers,csvExport,point,AccessError,ConflictError,configured,AuthClient:Auth,setIdentity:v=>identity=v,confirm:()=>true,setInterval:()=>0,setTimeout,clearTimeout,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{addEventListener(){}},document:{visibilityState:'visible',getElementById:id=>{if(!nodes.has(id))throw Error('Missing DOM id '+id);return nodes.get(id);},querySelectorAll:()=>[...editable,...[...nodes.values()].flatMap(n=>n.children).filter(n=>n?.attrs?.['data-edit']!==undefined)],createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){}},fetch:fetcher});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/start\(\);\s*$/,'globalThis.ready=start();')+'\nglobalThis.state=()=>({rows,dirty,identity,loaded,view});',context);
  await context.ready;
  const login=async password=>{nodes.get('loginEmail').value='member@example.com';nodes.get('loginPassword').value=password;await nodes.get('loginForm').onsubmit({preventDefault(){}});};
  return {nodes,context,login,saves:()=>saves,identity:()=>identity,cityRequests:()=>totalCityRequests,maxCityRequests:()=>maxCityRequests};
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
