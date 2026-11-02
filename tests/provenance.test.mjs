import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installProvenance } from '../src/host/provenance.js';
test('failure to record provenance must not turn a successful tool into failure',async()=>{
 let wrapper,calls=0;const ctx={on(_event,fn){wrapper=fn;},logger:{warn(){}}};
 installProvenance(ctx,{recordPath(){return 'Z:/unavailable/record.json';},async events(){throw new Error('storage failed');}});
 const result=await wrapper({agent:{session:{id:'test'}},name:'read',callId:'1'},async()=>{calls++;return {isError:false,value:'read result'};});
 assert.equal(result.value,'read result');assert.equal(calls,1);
});
