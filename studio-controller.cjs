function installStudioController(createOutputGuard,createLegacyApi,legacyLibrary,createVisionOutputController,compatible240Library,localTransport) {
  return (async()=>{
    if(window.__zenWorkbench) return {installed:true};
    const asset=localTransport?.asset||[...document.querySelectorAll('link[href]')].map(x=>x.href)
      .find(x=>/\/cronus-zen-service-[^/]+\.js$/.test(x));
    if(!asset)throw Error('Studio service asset was not found; the vendor page may have changed');
    const module=localTransport?{api:localTransport.api,state:localTransport.state}:await import(asset);
    let api=Object.values(module).find(x=>x&&typeof x.beginOutputSession==='function'&&typeof x.connectAndInitialize==='function');
    let state=Object.values(module).find(x=>x&&typeof x==='object'&&'status' in x&&'firmware' in x&&'supported' in x);
    if(!api||!state)throw Error('Studio API shape changed; connection adapter needs review');
    let guard=createOutputGuard(api,state),compatibleMasks=localTransport?.masks||null;
    let input=null,output=null,receivedAt=null,inputAt=null,abort=null,subscribedAt=0,lastStreamRestart=0;
    const vision=createVisionOutputController({getGuard:()=>guard,getConnection:()=>state,
      getInput:()=>({values:input?.input_values,at:inputAt,
        connected:!!input&&(input.connected_controller_raw>0||input.connection_flags?.joypad===true)})});
    const plain=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
    function subscribe() {
      if(abort||state.status!=='ready'||!state.supported)return;
      const findMask=name=>Object.values(module).find(fn=>typeof fn==='function'&&Function.prototype.toString.call(fn).includes('.'+name+'('));
      const inputMask=compatibleMasks?.input||findMask('STREAMIO_MASK_INPUT'),outputMask=compatibleMasks?.output||findMask('STREAMIO_MASK_OUTPUT');
      if(!inputMask||!outputMask)throw Error('Controller stream masks are unavailable');
      abort=new AbortController();subscribedAt=Date.now();
      api.subscribeStreamio(report=>{
        if('Input' in report){input=plain(report.Input);inputAt=Date.now();}
        if('Output' in report)output=plain(report.Output);
        receivedAt=Date.now();
      },inputMask()|outputMask(),false,abort.signal);
    }
    // Watchdog: the controller stream can stop delivering reports while the
    // subscription still looks alive, which strands physical input (and L2) stale
    // forever. Tear it down and re-subscribe once reports stall.
    function recoverStalledStream(){
      if(!abort||state.status!=='ready'||!state.supported)return;
      const last=Number.isFinite(inputAt)?inputAt:subscribedAt;
      if(!last||Date.now()-last<=2000||Date.now()-lastStreamRestart<3000)return;
      lastStreamRestart=Date.now();abort.abort();abort=null;subscribe();
    }
    function snapshot(){return plain({status:state.status,firmware:state.firmware,supported:state.supported,
      serial:state.serial,operationalMode:state.operationalMode,exportOnly:state.exportOnly,minimumFirmware:state.minimumFirmware,output:guard.status(),inputReport:input,
      outputReport:output,reportAt:receivedAt,visionOutput:vision.snapshot(),asset,attachedDevices:state.attachedDevices,transport:state.transport||'current-vendor'});}
    async function selectCompatibleTransport(){
      if(!createLegacyApi||state.supported)return;
      const profile=state.firmware==='2.3.2'?{library:legacyLibrary,transport:'compatible-1.3.3'}:
        state.firmware==='2.4.0'?{library:compatible240Library,transport:'compatible-1.4.1'}:null;
      if(!profile?.library||state.transport===profile.transport)return;
      await vision.disable('Changing transport');await guard.dispose();abort?.abort();abort=null;await api.disconnect();
      input=null;output=null;inputAt=null;receivedAt=null;
      const compatible=createLegacyApi(profile.library,{transport:profile.transport});api=compatible.api;state=compatible.state;compatibleMasks=compatible.masks;
      guard=createOutputGuard(api,state);await api.connectAndInitialize();
    }
    async function connect(){
      await vision.disable('Reconnecting controller stream');await guard.stop('Reconnect');
      abort?.abort();abort=null;input=null;output=null;inputAt=null;receivedAt=null;
      if(state.status!=='ready'&&state.status!=='connecting')await api.connectAndInitialize();
      const deadline=Date.now()+30000;
      while(state.status==='connecting'){
        if(Date.now()>deadline)throw Error('Device connection timed out');
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      if(state.status==='ready')await selectCompatibleTransport();
      subscribe();return snapshot();
    }
    window.__zenWorkbench={async command(operation,payload={}){
      switch(operation){
        case 'capabilities':{
          const name=Object.values(module).find(fn=>typeof fn==='function'&&Function.prototype.toString.call(fn).includes('.getUsbDeviceName('));
          const masks=compatibleMasks?[compatibleMasks.input(),compatibleMasks.output()]:Object.values(module).filter(fn=>typeof fn==='function'&&/\.STREAMIO_MASK_(INPUT|OUTPUT)\(/.test(Function.prototype.toString.call(fn))).map(fn=>fn());
          return {library:api.libraryInfo(),deviceName:name?name(0x2008,0x0010):null,streamMasks:masks};
        }
        case 'status':if(state.status==='ready')await selectCompatibleTransport();recoverStalledStream();subscribe();return snapshot();
        case 'connect':return connect();
        case 'disconnect':{
          await vision.disable('Device disconnected');const release=await guard.stop('disconnect');abort?.abort();abort=null;
          await api.disconnect();await guard.dispose();guard=createOutputGuard(api,state);
          input=null;output=null;inputAt=null;receivedAt=null;return {...snapshot(),release};
        }
        case 'visionEnable':if(state.status==='ready')await selectCompatibleTransport();subscribe();return vision.enable(payload.settings,payload.approval);
        case 'visionDisable':return vision.disable('Vision output disabled');
        case 'visionFrame':vision.setFrame(payload);return vision.snapshot();
        case 'arm':if(vision.snapshot().enabled)throw Error('Disable L2 vision output before manual controls');return guard.start(payload.approval);
        case 'frame':if(vision.snapshot().enabled)throw Error('L2 vision output owns controller output');return guard.send(payload.values,payload.expiresAt);
        case 'stop':await vision.disable('Output stopped');return guard.stop('Output stopped');
        case 'slots':return plain(await (state.supported?api.readSlots():api.readSlotsForExport()));
        case 'backup':{
          if(!Number.isInteger(payload.slot)||payload.slot<1||payload.slot>8)throw Error('Invalid slot');
          const value=await api.readBytecodeForExport(payload.slot);
          const bytes=value?.data??value;return Array.from(bytes);
        }
        case 'run':{
          if(payload.approval!=='RUN_COMPILED_SCRIPT')throw Error('Explicit script run required');
          if(typeof payload.hex!=='string'||!payload.hex.length||payload.hex.length>524288||!/^(?:[0-9a-fA-F]{2})+$/.test(payload.hex))throw Error('Invalid compiled bytecode');
          await vision.disable('Running a GPC script');await guard.stop('run script');
          const bytes=Uint8Array.from(payload.hex.match(/../g),x=>parseInt(x,16));
          await api.runScript(bytes);return {running:true,bytes:bytes.length};
        }
        case 'unload':await vision.disable('Unloading GPC');await guard.stop('unload');await api.unloadGpc();return {running:false};
        default:throw Error('Unsupported device operation');
      }
    }};
    return {installed:true,asset,...snapshot()};
  })();
}
module.exports={installStudioController};
