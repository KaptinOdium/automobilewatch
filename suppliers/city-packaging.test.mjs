import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('city shards preserve the complete multilingual gazetteer within the byte limit',async()=>{
  const base=new URL('./cities/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  const records=[];
  assert.equal(new Set(manifest.parts).size,manifest.parts.length);
  assert.equal(manifest.recordCount,34214);
  for(const path of manifest.parts){
    assert.match(path,/^part-\d{3,}\.json$/);
    const bytes=await readFile(new URL(path,base));
    assert.ok(bytes.length<=180000,`${path} exceeds the upload limit`);
    const part=JSON.parse(bytes.toString('utf8'));
    assert.ok(Array.isArray(part)&&part.length>0);
    records.push(...part);
  }
  assert.equal(records.length,manifest.recordCount);
  assert.equal(createHash('sha256').update(JSON.stringify(records),'utf8').digest('hex'),manifest.sourceSha256);
  assert.ok(records.some(row=>String(row[2]).split(',').includes('Praha')));
  assert.ok(records.some(row=>/[\u4e00-\u9fff]/u.test(String(row[2]))));
  assert.ok(records.some(row=>/[\u0400-\u04ff]/u.test(String(row[2]))));
});
