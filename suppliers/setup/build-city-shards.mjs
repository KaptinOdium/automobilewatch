import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Run with: node setup/build-city-shards.mjs [path/to/cities.json]
// The original gazetteer stays local; deploy only cities/ and this generator.
const root=fileURLToPath(new URL('../',import.meta.url));
const input=process.argv[2]?resolve(process.argv[2]):resolve(root,'cities.json');
const output=resolve(root,'cities');
const limit=180000;
const records=JSON.parse(await readFile(input,'utf8'));
if(!Array.isArray(records)||!records.length)throw Error('Expected a nonempty array of city rows.');
const groups=[];let group=[],bytes=2;
for(const row of records){
  if(!Array.isArray(row))throw Error('Every city record must be an array.');
  const encoded=JSON.stringify(row),size=Buffer.byteLength(encoded,'utf8');
  if(size+2>limit)throw Error('A city record exceeds the shard byte limit.');
  if(group.length&&bytes+1+size>limit){groups.push(group);group=[];bytes=2;}
  bytes+=size+(group.length?1:0);group.push(encoded);
}
if(group.length)groups.push(group);
await mkdir(output,{recursive:true});
const parts=[];
for(let i=0;i<groups.length;i++){
  const name='part-'+String(i+1).padStart(3,'0')+'.json';
  await writeFile(resolve(output,name),'['+groups[i].join(',')+']','utf8');
  parts.push(name);
}
const manifest={recordCount:records.length,maxPartBytes:limit,sourceSha256:createHash('sha256').update(JSON.stringify(records),'utf8').digest('hex'),parts};
await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(`Created ${parts.length} city shards, each at most ${limit} bytes, preserving ${records.length} records.`);
