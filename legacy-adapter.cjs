// Adapter for the previously reviewed, official library 1.3.3 / firmware 2.3.2.
function createLegacyApi(library,options={}){
  const raw=new library.CronusZen();
  const state={status:'disconnected',firmware:null,serial:null,supported:false,exportOnly:false,
    minimumFirmware:null,operationalMode:null,attachedDevices:[],transport:options.transport||'compatible-1.3.3'};
  let depth=0,commandQueue=Promise.resolve();
  const listeners=new Map();
  // A transient 'disconnected' disarms every stream listener. Nothing used to re-arm
  // them when the device came back, so physical input went permanently stale and L2
  // output released with "Waiting for fresh physical controller input".
  raw.onStateChange((name)=>{state.status=name;if(name==='disconnected'){depth=0;for(const entry of listeners.values())entry.armed=false;}else if(name==='ready')resumeStream();});
  raw.onCallbackError?.(error=>console.error('[Zen compatible transport]',error));
  function pauseStream(){for(const [callback,entry]of listeners)if(entry.armed){entry.armed=false;raw.removeStreamIoListener(callback);}}
  function resumeStream(){if(state.status!=='ready'||!state.supported)return;
    for(const [callback,entry]of listeners)if(!entry.armed){raw.addStreamIoListener(callback,entry.options);entry.armed=true;}}
  function withPausedStream(operation){
    const task=async()=>{const wasStreaming=[...listeners.values()].some(entry=>entry.armed);pauseStream();
      try{if(wasStreaming)await new Promise(resolve=>setTimeout(resolve,50));return await operation();}finally{resumeStream();}};
    const next=commandQueue.then(task,task);commandQueue=next.catch(()=>{});return next;
  }
  async function connect(){
    state.status='connecting';
    try{
      const granted=await raw.listGrantedDevices();
      if(granted.length)await raw.connectKnown(0);else await raw.connect();
      const info=await raw.initialize();
      state.firmware=info.firmware;state.serial=info.serial;
      state.supported=info.supported===true&&info.support_level!=='ExportOnly';
      state.exportOnly=info.support_level==='ExportOnly';state.minimumFirmware=info.minimum_firmware;
      if(state.supported){
        state.operationalMode=(await raw.readSettings()).operational_mode;
        state.attachedDevices=await raw.attachedDevices();
      }
      state.status='ready';return info;
    }catch(error){state.status='disconnected';await raw.disconnect().catch(()=>{});throw error;}
  }
  const api={get _apiModeSessionDepth(){return depth;},
    connectAndInitialize:connect,
    async disconnect(){pauseStream();await raw.disconnect();depth=0;state.status='disconnected';},
    libraryInfo:()=>raw.libraryInfo(),
    async beginOutputSession(){
      if(!state.supported||state.status!=='ready')throw Error('Compatible device session is not ready');
      if(depth!==0)throw Error('API mode already active');
      await raw.enterApiMode();depth=1;let ended=false;
      return async()=>{if(!ended){ended=true;try{await raw.exitApiMode();}finally{depth=0;}}};
    },
    sendOutput:values=>raw.sendOutput(values),
    readSlots:()=>withPausedStream(()=>raw.readSlots()),readSlotsForExport:()=>withPausedStream(()=>raw.readSlots()),
    readBytecodeForExport:slot=>withPausedStream(()=>raw.readBytecode(slot)),
    runScript:bytes=>withPausedStream(()=>raw.runScript(bytes,null)),unloadGpc:()=>withPausedStream(()=>raw.unloadGpc()),
    subscribeStreamio(callback,mask,rawReports,signal){
      if(signal?.aborted)return;
      listeners.set(callback,{options:{mask,raw:rawReports},armed:false});resumeStream();
      signal?.addEventListener('abort',()=>{const entry=listeners.get(callback);listeners.delete(callback);
        if(entry?.armed)raw.removeStreamIoListener(callback);},{once:true});
    }
  };
  return {api,state,masks:{input:library.inputMask,output:library.outputMask}};
}
module.exports={createLegacyApi};
