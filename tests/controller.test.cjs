const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOutputGuard}=require('../controller-core.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function mock(options={}){
  const calls=[];
  const api={_apiModeSessionDepth:0,async beginOutputSession(){calls.push('start');api._apiModeSessionDepth++;
    return async()=>{calls.push('exit');api._apiModeSessionDepth--;};},
    async sendOutput(frame){calls.push(Array.from(frame));if(options.failFrame&&frame.some(Boolean))throw Error('write failed');}};
  const state={status:'ready',firmware:'2.3.2',supported:true};
  return {api,state,calls,guard:createOutputGuard(api,state,{idleMs:40,deadlineMs:50})};
}
test('no output on initialization or rejected approval',async()=>{
  const m=mock();assert.equal(m.guard.status().active,false);await assert.rejects(m.guard.start('no'));assert.deepEqual(m.calls,[]);await m.guard.dispose();
});
test('normal output has neutral before and after, and exits API mode',async()=>{
  const m=mock();await m.guard.start('ENABLE_MANUAL_OUTPUT');const values=Array(38).fill(0);values[16]=100;
  await m.guard.send(values,Date.now()+150);const result=await m.guard.stop();
  assert.equal(result.released,true);assert.equal(m.api._apiModeSessionDepth,0);assert.equal(m.calls[1].every(x=>x===0),true);
  assert.equal(m.calls[2][16],100);assert.equal(m.calls.at(-2).every(x=>x===0),true);assert.equal(m.calls.at(-1),'exit');await m.guard.dispose();
});
test('negative stick axes are encoded as signed report bytes',async()=>{
  const m=mock();await m.guard.start('ENABLE_MANUAL_OUTPUT');const values=Array(38).fill(0);values[11]=-100;
  await m.guard.send(values,Date.now()+100);assert.equal(m.calls.at(-1)[11],156);await m.guard.dispose();
});

test('physical initial frame avoids dropping held controls when entering CV output',async()=>{
  const m=mock(),values=Array(38).fill(0);values[7]=100;values[11]=-40;
  await m.guard.start('ENABLE_MANUAL_OUTPUT',values);assert.equal(m.calls[1][7],100);assert.equal(m.calls[1][11],216);await m.guard.dispose();
});
test('expired, malformed and reserved controller values are rejected',async()=>{
  const m=mock();await m.guard.start('ENABLE_MANUAL_OUTPUT');await assert.rejects(m.guard.send(Array(38).fill(0),Date.now()-1));
  await assert.rejects(m.guard.send([1],Date.now()+100));const reserved=Array(38).fill(0);reserved[37]=1;
  await assert.rejects(m.guard.send(reserved,Date.now()+100));assert.equal(m.calls.length,2);await m.guard.dispose();
});
test('firmware must match the reviewed hardware-output version',async()=>{
  const m=mock();m.state.firmware='2.3.3';await assert.rejects(m.guard.start('ENABLE_MANUAL_OUTPUT'));assert.deepEqual(m.calls,[]);await m.guard.dispose();
});

test('supported 2.4.0 transport uses the same 38-channel output frame',async()=>{
  const m=mock();m.state.firmware='2.4.0';await m.guard.start('ENABLE_MANUAL_OUTPUT');
  const values=Array(38).fill(0);values[7]=100;values[9]=18;values[10]=-15;
  await m.guard.send(values,Date.now()+150);assert.equal(m.calls.at(-1).length,38);assert.equal(m.calls.at(-1)[10],241);await m.guard.dispose();
});
test('inactivity releases and disarms output',async()=>{
  const m=mock();await m.guard.start('ENABLE_MANUAL_OUTPUT');await wait(125);assert.equal(m.guard.status().active,false);
  assert.equal(m.api._apiModeSessionDepth,0);assert.equal(m.calls.at(-1),'exit');await m.guard.dispose();
});
test('failed frame still attempts neutral and cleanup',async()=>{
  const m=mock({failFrame:true});await m.guard.start('ENABLE_MANUAL_OUTPUT');const values=Array(38).fill(0);values[16]=100;
  await assert.rejects(m.guard.send(values,Date.now()+100));assert.equal(m.api._apiModeSessionDepth,0);assert.equal(m.calls.at(-1),'exit');await m.guard.dispose();
});
test('late session entry after timeout is cleaned up and uncertainty stays latched',async()=>{
  const m=mock();m.api.beginOutputSession=async()=>{await wait(90);m.api._apiModeSessionDepth++;return async()=>{m.api._apiModeSessionDepth--;};};
  await assert.rejects(m.guard.start('ENABLE_MANUAL_OUTPUT'));await wait(90);assert.equal(m.api._apiModeSessionDepth,0);
  assert.equal(m.guard.status().uncertain,true);await assert.rejects(m.guard.start('ENABLE_MANUAL_OUTPUT'));await m.guard.dispose();
});
test('failure to release latches uncertainty',async()=>{
  const m=mock();await m.guard.start('ENABLE_MANUAL_OUTPUT');m.api.sendOutput=async()=>{throw Error('offline');};
  const result=await m.guard.stop();assert.equal(result.released,false);assert.equal(result.uncertain,true);assert.equal(m.api._apiModeSessionDepth,0);await m.guard.dispose();
});
