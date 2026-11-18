'use strict';

// This function is also injected into the isolated, official Studio renderer.
function createOutputGuard(api, state, options = {}) {
  const deadlineMs = options.deadlineMs || 1200;
  const idleMs = options.idleMs || 250;
  let close = null, uncertain = false, lastFrame = 0;
  let chain = Promise.resolve();
  const neutral = () => new Uint8Array(38);
  const status = () => ({active:!!close, uncertain, sessionDepth:api._apiModeSessionDepth, idleMs});
  function serial(fn) { const next=chain.then(fn,fn); chain=next.catch(()=>{});return next; }
  async function bounded(fn) {
    let timer;
    try {return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{
      timer=setTimeout(()=>{uncertain=true;reject(Error('Device operation timed out; reconnect before output'));},deadlineMs);
    })]);} finally {clearTimeout(timer);}
  }
  async function release(reason) {
    const exit=close; close=null;
    if(!exit) return {released:!uncertain,reason,...status()};
    let neutralOk=false,exitOk=false;const errors=[];
    try {for(let n=0;n<2;n++) {try {await bounded(()=>api.sendOutput(neutral()));neutralOk=true;break;}catch(e){errors.push(String(e));}}}
    finally {try {await bounded(exit);exitOk=true;}catch(e){errors.push(String(e));}}
    if(!neutralOk||!exitOk) uncertain=true;
    return {released:neutralOk&&exitOk,neutralOk,exitOk,errors,reason,...status()};
  }
  async function start(approval,initialValues) {
    if(approval!=='ENABLE_MANUAL_OUTPUT') throw Error('Manual output must be enabled explicitly');
    if(uncertain||close||api._apiModeSessionDepth!==0) throw Error('Output is active or uncertain; disconnect and reconnect');
    if(state.status!=='ready'||!state.supported||!['2.3.2','2.4.0'].includes(state.firmware)) throw Error('Controller output requires supported firmware 2.3.2 or 2.4.0 and a ready Zen');
    if(initialValues!==undefined&&(!Array.isArray(initialValues)||initialValues.length!==38||initialValues.some(x=>!Number.isInteger(x)||x < -100||x>100)||initialValues.slice(34).some(Boolean)))
      throw Error('Invalid initial controller frame');
    const opening=Promise.resolve().then(()=>api.beginOutputSession());
    try {close=await bounded(()=>opening);}
    catch(error) {opening.then(late=>serial(async()=>{if(typeof late==='function'){close=late;await release('late session entry');}})).catch(()=>{});throw error;}
    if(typeof close!=='function'){uncertain=true;throw Error('Missing API cleanup handle');}
    lastFrame=Date.now();
    try {await bounded(()=>api.sendOutput(initialValues?Uint8Array.from(initialValues,v=>v&255):neutral()));}
    catch(error){await release('initial neutral failed');throw error;}
    return status();
  }
  async function send(values,expiresAt) {
    if(!close||uncertain)throw Error('Manual output is disarmed');
    if(!Number.isFinite(expiresAt)||Date.now()>expiresAt)throw Error('Stale controller frame');
    if(!Array.isArray(values)||values.length!==38||values.some(x=>!Number.isInteger(x)||x < -100||x>100)||values.slice(34).some(Boolean))
      throw Error('Expected 38 controller integers, with reserved values zero');
    lastFrame=Date.now();
    try {await bounded(()=>api.sendOutput(Uint8Array.from(values,v=>v&255)));}
    catch(error){await release('frame failed');throw error;}
    return status();
  }
  let timerQueued=false;
  const timer=setInterval(()=>{
    if(close&&Date.now()-lastFrame>idleMs&&!timerQueued){timerQueued=true;serial(async()=>{
      try {if(close&&Date.now()-lastFrame>idleMs)await release('inactivity');}finally{timerQueued=false;}
    });}
  },50);
  timer.unref?.();
  return {status,start:(a,v)=>serial(()=>start(a,v)),send:(v,t)=>serial(()=>send(v,t)),
    stop:reason=>serial(()=>release(reason||'stop')),dispose:async()=>{clearInterval(timer);return serial(()=>release('dispose'));}};
}

module.exports={createOutputGuard};
