const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {installStudioController}=require('../studio-controller.cjs');
test('explicit reconnect replaces stale subscription and disconnect clears report timestamps',async()=>{
  const asset=pathToFileURL(path.join(__dirname,'fixtures/cronus-zen-service-test.js')).href;
  global.window={};global.document={querySelectorAll:()=>[{href:asset}]};
  const guard=()=>({status:()=>({active:false,uncertain:false}),async stop(){return {released:true};},async dispose(){}});
  const cv=()=>({snapshot:()=>({enabled:false}),async disable(){}});
  try{
    await installStudioController(guard,null,null,cv);
    const first=await window.__zenWorkbench.command('connect');assert.equal(first.inputReport.input_values[7],10);
    const second=await window.__zenWorkbench.command('connect');assert.equal(second.inputReport.input_values[7],20);
    const fixture=require('./fixtures/cronus-zen-service-test.js');assert.deepEqual(fixture.counters(),{count:2,aborted:1});
    const disconnected=await window.__zenWorkbench.command('disconnect');assert.equal(disconnected.reportAt,null);assert.equal(disconnected.inputReport,null);
  }finally{delete global.window;delete global.document;}
});

async function check240Compatibility(operation){
  const asset=pathToFileURL(path.join(__dirname,'fixtures/cronus-zen-service-test.js')).href;
  const fixture=require('./fixtures/cronus-zen-service-test.js');fixture.reset({status:'ready',firmware:null,supported:false});
  global.window={};global.document={querySelectorAll:()=>[{href:asset}]};
  let migrations=0;
  const guard=()=>({status:()=>({active:false,uncertain:false}),async stop(){return {released:true};},async dispose(){}});
  const cv=({getConnection,getInput})=>({snapshot:()=>({enabled:false}),async disable(){},async enable(){return {enabled:getConnection().supported,l2:getInput().values?.[7]};}});
  const compatible=(_library,options)=>{
    migrations++;assert.equal(options.transport,'compatible-1.4.1');
    const state={status:'disconnected',firmware:'2.4.0',supported:true,transport:options.transport};
    return {state,masks:{input:()=>1,output:()=>2},api:{async connectAndInitialize(){state.status='ready';},
      subscribeStreamio(callback){const values=Array(38).fill(0);values[7]=100;callback({Input:{input_values:values,connected_controller_raw:1}});}}};
  };
  try{
    await installStudioController(guard,compatible,null,cv,{});
    fixture.state.firmware='2.4.0';
    const result=await window.__zenWorkbench.command(operation);
    assert.equal(migrations,1);
    if(operation==='status'){assert.equal(result.supported,true);assert.equal(result.inputReport.input_values[7],100);await window.__zenWorkbench.command('status');assert.equal(migrations,1);}
    else {assert.equal(result.enabled,true);assert.equal(result.l2,100);}
  }finally{delete global.window;delete global.document;}
}
test('late firmware metadata selects the supported 2.4.0 library during status polling',()=>check240Compatibility('status'));
test('vision enable recovers 2.4.0 compatibility before checking the output gate',()=>check240Compatibility('visionEnable'));

test('bundled local transport connects without importing the live vendor page',async()=>{
  const fixture=require('./fixtures/cronus-zen-service-test.js');fixture.reset({firmware:'2.4.0'});
  global.window={};global.document={querySelectorAll(){throw Error('Live vendor DOM must not be accessed');}};
  const guard=()=>({status:()=>({active:false,uncertain:false}),async stop(){return {released:true};},async dispose(){}});
  const cv=()=>({snapshot:()=>({enabled:false}),async disable(){}});
  try{
    await installStudioController(guard,null,null,cv,null,{asset:'bundled-official-library-1.4.1',api:fixture.api,state:fixture.state,masks:{input:()=>1,output:()=>2}});
    const result=await window.__zenWorkbench.command('connect');assert.equal(result.asset,'bundled-official-library-1.4.1');assert.equal(result.inputReport.input_values[7],10);
    await window.__zenWorkbench.command('disconnect');
  }finally{delete global.window;delete global.document;}
});
