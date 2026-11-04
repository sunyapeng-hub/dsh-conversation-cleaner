import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installProvenance } from '../src/host/provenance.js';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'provenance-ownership-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const output=path.join(root,'generated.txt'),proof=path.join(root,'proof','session.json');
  let wrapper,call=0;
  installProvenance({on(_event,fn){wrapper=fn;},logger:{warn(){}}},{recordPath(){return proof;},async events(){return [];}});
  const session={id:'synthetic-provenance',header:{cwd:root}};
  const run=(name,next)=>wrapper({agent:{session},callId:String(++call),name,arguments:{file_path:output}},next);
  const write=(operation,content)=>run('write',async()=>{await fs.writeFile(output,content);return {isError:false,value:{path:output,operation}};});
  const edit=()=>run('edit',async()=>{await fs.appendFile(output,' Agent edit.');return {isError:false,value:{path:output,operation:'update'}};});
  const read=()=>run('read',async()=>({isError:false,value:{path:output}}));
  const record=async()=>JSON.parse(await fs.readFile(proof,'utf8'));
  await write('create','Agent original.');
  return {root,output,proof,run,write,edit,read,record};
}

test('replacement followed by an Agent update loses output ownership permanently',async t=>{
  const f=await fixture(t);
  await fs.rename(f.output,path.join(f.root,'original.txt'));
  await fs.writeFile(f.output,'User replacement.');
  await f.run('edit',async()=>{
    assert.deepEqual((await f.record()).outputs,[],'ownership must be removed before the tool runs');
    await fs.appendFile(f.output,' Agent edit.');
    return {isError:false,value:{path:f.output,operation:'update'}};
  });
  assert.deepEqual((await f.record()).outputs,[]);
  await f.edit();
  assert.deepEqual((await f.record()).outputs,[]);
  assert.equal(await fs.readFile(f.output,'utf8'),'User replacement. Agent edit. Agent edit.');
});

test('reading an externally rewritten output revokes its ownership before a later edit',async t=>{
  const f=await fixture(t);
  await fs.appendFile(f.output,' External user changes.');
  await f.read();
  assert.deepEqual((await f.record()).outputs,[]);
  await f.edit();
  const record=await f.record();
  assert.deepEqual(record.outputs,[]);
  assert.ok(record.references.includes(f.output));
  assert.equal(record.complete,true);
  assert.equal(record.unknown,false);
});

test('consecutive Agent edits retain output ownership',async t=>{
  const f=await fixture(t);
  await f.edit();await f.read();await f.edit();
  const record=await f.record();
  assert.deepEqual(record.outputs.map(o=>o.path),[f.output]);
  assert.equal(record.complete,true);
  assert.equal(record.unknown,false);
});

test('a genuine create after an output was removed establishes new ownership',async t=>{
  const f=await fixture(t);
  await fs.unlink(f.output);
  await f.write('create','New Agent output.');
  await f.edit();
  assert.deepEqual((await f.record()).outputs.map(o=>o.path),[f.output]);
});

test('failed identity observation revokes only that output and preserves the tool result',async t=>{
  const f=await fixture(t);
  const other=path.join(f.root,'other.txt');
  await f.run('write',async()=>{await fs.writeFile(other,'Another Agent output.');return {isError:false,value:{path:other,operation:'create'}};});
  await fs.unlink(f.output);await fs.mkdir(f.output);
  const result={isError:false,value:'tool succeeded'};
  let calls=0;
  const actual=await f.run('edit',async()=>{calls++;return result;});
  assert.equal(actual,result);
  assert.equal(calls,1);
  assert.deepEqual((await f.record()).outputs.map(o=>o.path),[other]);
});

async function nativeEdit(f) {
  return f.run('edit',async()=>{
    const before=await fs.readFile(f.output,'utf8'),after=before+' Native Agent edit.';
    await fs.writeFile(f.output,after);
    return {isError:false,value:{path:f.output,before,after}};
  });
}

test('native edit path/before/after results retain continuous ownership without becoming unknown',async t=>{
  const f=await fixture(t);
  await nativeEdit(f);await nativeEdit(f);
  const record=await f.record();
  assert.equal(record.unknown,false);
  assert.equal(record.complete,true);
  assert.deepEqual(record.outputs.map(o=>o.path),[f.output]);
});

test('native edit after replacement and read never adopts the user file or makes provenance unknown',async t=>{
  const f=await fixture(t);
  await fs.rename(f.output,path.join(f.root,'original.txt'));
  await fs.writeFile(f.output,'User replacement.');
  await f.read();await nativeEdit(f);await nativeEdit(f);
  const record=await f.record();
  assert.equal(record.unknown,false);
  assert.equal(record.complete,true);
  assert.deepEqual(record.outputs,[]);
  assert.ok(record.references.includes(f.output));
  assert.equal(await fs.readFile(f.output,'utf8'),'User replacement. Native Agent edit. Native Agent edit.');
});

test('edit results claiming create never grant ownership',async t=>{
  const f=await fixture(t);
  await fs.rename(f.output,path.join(f.root,'original.txt'));
  await fs.writeFile(f.output,'User replacement.');
  await f.run('edit',async()=>({isError:false,value:{path:f.output,operation:'create'}}));
  const record=await f.record();
  assert.deepEqual(record.outputs,[]);
  assert.equal(record.unknown,true);
});

test('incomplete native edit shapes stay unknown',async t=>{
  const f=await fixture(t);
  await f.run('edit',async()=>({isError:false,value:{path:f.output,before:'before',after:42}}));
  assert.equal((await f.record()).unknown,true);
});
