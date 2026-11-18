const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLegacyApi}=require('../legacy-adapter.cjs');
function fixture(supported=true){
  const calls=[];let raw;
  class Raw{
    constructor(){raw=this;}
    onStateChange(callback){this.onState=callback;}
    onCallbackError(){}
    async listGrantedDevices(){return [{vendorId:0x2008,productId:0x0010}];}
    async connectKnown(index){calls.push(['connect',index]);}
    async initialize(){return {firmware:'2.3.2',supported,minimum_firmware:'2.3.2',support_level:supported?'Full':'ExportOnly'};}
    async readSettings(){return {operational_mode:'Standard'};}
    async attachedDevices(){return [];}
    async disconnect(){calls.push('disconnect');}
    async enterApiMode(){calls.push('enter');}
    async exitApiMode(){calls.push('exit');}
    async readSlots(){calls.push('slots');return [];}
    async readBytecode(){calls.push('backup');return [1,2];}
    addStreamIoListener(callback,options){calls.push(['subscribe',options]);this.listener=callback;}
    removeStreamIoListener(callback){assert.equal(callback,this.listener);calls.push('unsubscribe');}
    libraryInfo(){return {version:'1.3.3'};}
  }
  return {...createLegacyApi({CronusZen:Raw,inputMask:()=>1,outputMask:()=>2}),calls,get raw(){return raw;}};
}
test('compatible adapter uses initialization result without overriding firmware support',async()=>{
  const f=fixture();await f.api.connectAndInitialize();assert.equal(f.state.supported,true);assert.equal(f.state.firmware,'2.3.2');assert.equal(f.state.operationalMode,'Standard');
  assert.deepEqual(f.calls[0],['connect',0]);await f.api.disconnect();assert.equal(f.state.status,'disconnected');
});
test('unsupported initialization stays restricted',async()=>{
  const f=fixture(false);await f.api.connectAndInitialize();assert.equal(f.state.supported,false);assert.equal(f.state.exportOnly,true);await assert.rejects(f.api.beginOutputSession());
});
test('API cleanup is idempotent and preserves session accounting',async()=>{
  const f=fixture();await f.api.connectAndInitialize();const stop=await f.api.beginOutputSession();assert.equal(f.api._apiModeSessionDepth,1);
  await stop();await stop();assert.equal(f.api._apiModeSessionDepth,0);assert.equal(f.calls.filter(x=>x==='exit').length,1);
});
test('monitor subscription is removed on abort',async()=>{
  const f=fixture(),controller=new AbortController();await f.api.connectAndInitialize();f.api.subscribeStreamio(()=>{},3,false,controller.signal);
  controller.abort();assert.equal(f.calls.at(-1),'unsubscribe');
});

test('slot reads pause streaming and resume the physical input listener afterward',async()=>{
  const f=fixture();await f.api.connectAndInitialize();f.api.subscribeStreamio(()=>{},3,false,new AbortController().signal);
  await f.api.readSlots();assert.deepEqual(f.calls.slice(-3),['unsubscribe','slots',['subscribe',{mask:3,raw:false}]]);
});

test('failed metadata requests restore streaming and queued commands remain ordered',async()=>{
  const f=fixture();await f.api.connectAndInitialize();f.api.subscribeStreamio(()=>{},3,false,new AbortController().signal);
  f.raw.readSlots=async()=>{f.calls.push('failed slots');throw Error('read failed');};
  const reads=await Promise.allSettled([f.api.readSlots(),f.api.readBytecodeForExport(1)]);
  assert.equal(reads[0].status,'rejected');assert.equal(reads[1].status,'fulfilled');
  assert.deepEqual(f.calls.slice(-6),['unsubscribe','failed slots',['subscribe',{mask:3,raw:false}],'unsubscribe','backup',['subscribe',{mask:3,raw:false}]]);
});

test('abort during a paused request prevents restarting an abandoned subscription',async()=>{
  const f=fixture(),controller=new AbortController();await f.api.connectAndInitialize();f.api.subscribeStreamio(()=>{},3,false,controller.signal);
  const pending=f.api.readSlots();await new Promise(resolve=>setTimeout(resolve,10));controller.abort();await pending;
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='subscribe').length,1);
});
