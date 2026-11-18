const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createVisionOutputController}=require('../vision-controller.cjs');
function mock(){
  let clock=1000,active=false;
  const calls=[],connection={status:'ready',supported:true,firmware:'2.3.2'};
  const input={values:Array(38).fill(0),at:clock,connected:true};
  const guard={status:()=>({active,uncertain:false}),async start(approval,values){active=true;calls.push({start:values.slice()});},
    async send(values){assert.equal(active,true);calls.push({frame:values.slice()});},async stop(reason){active=false;calls.push({stop:reason});return {released:true};}};
  const cv=createVisionOutputController({getGuard:()=>guard,getInput:()=>input,getConnection:()=>connection,now:()=>clock,startTimer:false});
  const target=(x=410,y=270)=>cv.setFrame({resolution:[640,640],at:clock,objects:[{label:'character',confidence:.9,box:[x-20,y-40,x+20,y+40]}]});
  return {cv,input,calls,connection,guard,target,advance(ms){clock+=ms;},fresh(){input.at=clock;},frames:()=>calls.filter(x=>x.frame)};
}
const enable=m=>m.cv.enable({},'ENABLE_L2_VISION_OUTPUT');
test('CV output is disabled by default and needs explicit enable',async()=>{
  const m=mock();m.input.values[7]=100;m.target();await m.cv.tick();assert.equal(m.calls.length,0);
  await assert.rejects(m.cv.enable({},'no'));assert.equal(m.cv.snapshot().enabled,false);
});
test('enabled CV sends nothing until physical L2 is held',async()=>{
  const m=mock();await enable(m);m.target();await m.cv.tick();assert.equal(m.frames().length,0);assert.equal(m.cv.snapshot().active,false);
});

test('physical L2 telemetry remains visible while output is disabled',()=>{
  const m=mock();m.input.values[7]=100;m.advance(10);const status=m.cv.snapshot();
  assert.equal(status.enabled,false);assert.equal(status.l2,100);assert.equal(status.inputAgeMs,10);assert.equal(status.controllerConnected,true);
});
test('L2 gates signed stick correction and preserves physical buttons, triggers and movement',async()=>{
  const m=mock();m.input.values[7]=100;m.input.values[4]=77;m.input.values[11]=206;m.input.values[19]=100;m.input.values[37]=99;
  await enable(m);m.target();await m.cv.tick();const frame=m.frames()[0].frame;
  assert.equal(frame[7],100);assert.equal(frame[4],77);assert.equal(frame[11],-50);assert.equal(frame[19],100);
  assert(frame[9]>0);assert(frame[10]<0);assert(frame.slice(34).every(x=>x===0));
  assert.deepEqual(m.calls.find(x=>x.start).start,m.input.values.map((x,i)=>i>=34?0:x>127?x-256:x));
  m.input.values[7]=0;await m.cv.tick();assert.equal(m.cv.snapshot().active,false);assert.equal(m.frames().length,1);
});
test('stale target produces physical passthrough rather than old correction',async()=>{
  const m=mock();await enable(m);m.input.values[7]=100;m.input.values[9]=5;m.target();await m.cv.tick();m.advance(401);m.fresh();await m.cv.tick();
  assert.equal(m.frames().at(-1).frame[9],5);assert.equal(m.frames().at(-1).frame[10],0);assert.equal(m.cv.snapshot().tracking,false);
});
test('stale physical reports and missing controller release the session',async()=>{
  const m=mock();await enable(m);m.input.values[7]=100;m.target();await m.cv.tick();m.advance(201);await m.cv.tick();assert.equal(m.cv.snapshot().active,false);
  m.fresh();await m.cv.tick();assert.equal(m.cv.snapshot().active,true);m.input.connected=false;await m.cv.tick();assert.equal(m.cv.snapshot().active,false);
});
test('outside FOV and centered detections do not add correction',async()=>{
  const m=mock();await enable(m);m.input.values[7]=100;m.target(600,600);await m.cv.tick();assert.equal(m.frames().at(-1).frame[9],0);
  m.target(320,320);await m.cv.tick();assert.equal(m.frames().at(-1).frame[10],0);assert.equal(m.cv.snapshot().reason,'Target centered');
});
test('corrections respect cap, direction, inversion and physical stick saturation',async()=>{
  const m=mock();await m.cv.enable({gain:200,maxCorrection:15,smoothing:1,invertY:true},'ENABLE_L2_VISION_OUTPUT');
  m.input.values[7]=100;m.target(440,400);await m.cv.tick();assert.equal(m.frames()[0].frame[9],15);assert.equal(m.frames()[0].frame[10],-15);
  m.input.values[9]=99;await m.cv.tick();assert.equal(m.frames().at(-1).frame[9],100);
});
test('nearest confident detection wins and old IPC frame cannot be made fresh',async()=>{
  const m=mock();await enable(m);m.input.values[7]=100;
  m.cv.setFrame({resolution:[640,640],at:500,objects:[{confidence:.9,box:[390,300,430,340]}]});await m.cv.tick();assert.equal(m.cv.snapshot().tracking,false);
  m.cv.setFrame({resolution:[640,640],objects:[{confidence:.1,box:[310,310,330,330]},{confidence:.9,box:[350,300,390,340]},{confidence:.9,box:[180,300,220,340]}]});
  await m.cv.tick();assert.equal(m.cv.snapshot().target.x,370);
});
test('disconnect disables CV and invalid settings are rejected',async()=>{
  const m=mock();await assert.rejects(m.cv.enable({maxCorrection:0},'ENABLE_L2_VISION_OUTPUT'));await enable(m);
  m.connection.status='disconnected';await m.cv.tick();assert.equal(m.cv.snapshot().enabled,false);
});
test('disable during session entry releases the late session without a corrected frame',async()=>{
  const m=mock();let resolve;m.guard.start=async()=>{await new Promise(r=>resolve=r);};await enable(m);m.input.values[7]=100;m.target();
  const pending=m.cv.tick();await m.cv.disable();resolve();await pending;
  assert.equal(m.frames().length,0);assert.equal(m.cv.snapshot().active,false);assert(m.calls.some(x=>x.stop==='Output mode changed'));
});
