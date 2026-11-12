export const norm = s => String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const aliases={name:['name','supplier','suppliername','company','companyname','dodavatel','nazev','nazevdodavatele','lieferant','lieferantenname'],duns:['duns','dunsnumber','dunsno','dunsnummer','dunsnr'],country:['country','countryname','zeme','stat','land'],city:['city','town','mesto','stadt','ort'],lat:['lat','latitude','sirka'],lon:['lon','lng','longitude','delka']};
function detectDelimiter(text){
 const counts={'\t':0,';':0,',':0};let quoted=false,content=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){content=true;if(quoted&&text[i+1]==='"')i++;else quoted=!quoted;}
  else if(!quoted&&(c==='\r'||c==='\n')){if(content)break;}
  else{if(c.trim())content=true;if(!quoted&&Object.hasOwn(counts,c))counts[c]++;}
 }
 return counts['\t']?'\t':counts[';']>counts[',']?';':',';
}
export function parseDelimited(text){
 text=String(text).replace(/^\uFEFF/,''); const delim=detectDelimiter(text);
 let rows=[],row=[],cell='',quoted=false; for(let i=0;i<text.length;i++){const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delim&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('A quoted cell is unfinished. Check the last quotation mark.'); row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function parseSuppliers(text){const rows=parseDelimited(text);if(rows.length<2)throw Error('Include a header and at least one supplier row.');const headers=rows.shift().map(norm);const indexes=Object.fromEntries(Object.entries(aliases).map(([k,v])=>[k,headers.findIndex(h=>v.includes(h))]));for(const k of ['name','duns','country','city'])if(indexes[k]<0)throw Error(`Missing ${k} column. Use Name, DUNS, Country, City.`);if(rows.length>10000)throw Error('Import up to 10,000 rows at a time.');
 return rows.map((r,i)=>{let get=k=>indexes[k]<0?'':(r[indexes[k]]??'').trim();let duns=get('duns').replace(/^'/,'').replace(/[\s-]/g,'');const latText=get('lat'),lonText=get('lon');let lat=latText?Number(latText.replace(',','.')):null,lon=lonText?Number(lonText.replace(',','.')):null;const validCoord=lat!==null&&lon!==null&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;let warnings=[];if(!/^\d{9}$/.test(duns))warnings.push('DUNS must contain 9 digits; verify the original value');if(!get('name'))warnings.push('Missing supplier name');if(!get('city')||!get('country'))warnings.push('Missing city or country');if((latText||lonText)&&!validCoord)warnings.push('Invalid coordinates');return {id:`s${i+1}`,name:get('name'),duns,country:get('country'),city:get('city'),lat:validCoord?lat:null,lon:validCoord?lon:null,precision:validCoord?'Provided coordinates':'Unresolved',warnings,candidates:[],source:validCoord?'Imported coordinates; not independently verified':''};});
}
export function csvExport(rows){const esc=x=>{let value=String(x??'');if(typeof x!=='number'&&/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';};const cols=['Name','DUNS','Country','City','Latitude','Longitude','Precision','Notes'];return [cols,...rows.map(r=>[r.name,r.duns,r.country,r.city,r.lat??'',r.lon??'',r.precision,r.warnings.join('; ')])].map(r=>r.map(esc).join(',')).join('\r\n');}
export const point=(lat,lon)=>({x:(lon+180)*1000/360,y:(90-lat)*500/180});
