const {app,BrowserWindow,ipcMain,dialog,session,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {createOutputGuard}=require('./controller-core.cjs');
const {installStudioController}=require('./studio-controller.cjs');
const {createLegacyApi}=require('./legacy-adapter.cjs');
const {createVisionOutputController}=require('./vision-controller.cjs');
app.disableHardwareAcceleration();
const ORIGIN='https://zenstudio.collectivemindsstore.com';
let window,studio,studioReady,vision,closing=false,preferences,compiled=null,appScriptRunning=false,lastVisionFrame=null,lastVisionAt=0;
let hidConfigured=false,visionOutputEnabled=false;
let lastVisionUiAt=0,pendingVisionFrame=null,visionForwarding=false;
let visionPerformanceSamples=null;
const allowedIds=new Set();
let commandChain=Promise.resolve();
const visionBenchmarkMode=process.argv.includes('--vision-benchmark');
const smoke=process.argv.includes('--smoke-test')||visionBenchmarkMode;
const probe=process.argv.includes('--probe-studio');
const connectProbe=process.argv.includes('--connect-probe');
const autoConnect=process.argv.includes('--connect');
const autoStartVision=process.argv.includes('--start-vision');
if(smoke)app.setPath('userData',process.env.ZEN_SMOKE_PROFILE||path.join(app.getPath('temp'),'zen-workbench-self-test',String(process.pid)));
const isZen=device=>device.vendorId===0x2008&&device.productId===0x0010;
const allowedDeviceOps=new Set(['status','connect','disconnect','arm','frame','stop','slots','backup','run','unload','visionEnable','visionDisable','visionFrame']);
const transportUrl=pathToFileURL(path.join(__dirname,'transport.html')).href;
const trustedOrigin=value=>{try{return value==='file://'||new URL(value).protocol==='file:';}catch{return false;}};
const log=(message,level='info')=>window&&!window.isDestroyed()&&window.webContents.send('zen:log',{at:Date.now(),level,message});

async function ensureStudio(){
  if(studioReady)return studioReady;
  studioReady=(async()=>{
    const ses=session.fromPartition('persist:zen-workbench-device');
    if(!hidConfigured){
    ses.setPermissionCheckHandler((contents,permission,origin)=>
      !!studio&&contents?.id===studio.webContents.id&&permission==='hid'&&trustedOrigin(origin));
    ses.setDevicePermissionHandler(details=>details.deviceType==='hid'&&trustedOrigin(details.origin)
      &&isZen(details.device)&&(connectProbe||autoConnect||allowedIds.has(details.device.deviceId)));
    ses.on('select-hid-device',async(event,details,callback)=>{
      event.preventDefault();
      if(!trustedOrigin(details.frame.url)){callback('');return;}
      const devices=details.deviceList.filter(isZen);
      if(!devices.length){callback('');log('No Cronus HID device found. Connect PROG USB in normal mode.','warning');return;}
      if((connectProbe||autoConnect)&&devices.length===1){allowedIds.add(devices[0].deviceId);callback(devices[0].deviceId);return;}
      const result=await dialog.showMessageBox(window,{type:'question',title:'Connect Cronus Zen',
        message:'Select the Cronus device to connect',detail:'This grants this app access to the selected Zen for this session.',
        buttons:[...devices.map(d=>d.name||'Cronus Zen'),'Cancel'],cancelId:devices.length,noLink:true});
      const chosen=devices[result.response];if(chosen)allowedIds.add(chosen.deviceId);
      callback(chosen?.deviceId||'');
    });
    hidConfigured=true;
    }
    studio=new BrowserWindow({width:1180,height:820,show:false,title:'Zen device connection',
      backgroundColor:'#14171d',webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,
        sandbox:true,webSecurity:true,backgroundThrottling:false}});
    studio.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    studio.webContents.on('will-navigate',(event,url)=>{if(url!==transportUrl)event.preventDefault();});
    studio.on('close',event=>{if(!closing){event.preventDefault();studio.hide();}});
    studio.on('closed',()=>{studio=null;studioReady=null;compiled=null;});
    await studio.loadFile(path.join(__dirname,'transport.html'));
    const [legacyFactory,legacyWasm,factory240,wasm240]=await Promise.all([
      fs.readFile(path.join(__dirname,'legacy','factory.js.txt'),'utf8'),fs.readFile(path.join(__dirname,'legacy','device.wasm')),
      fs.readFile(path.join(__dirname,'compatible-240','factory.js.txt'),'utf8'),fs.readFile(path.join(__dirname,'compatible-240','device.wasm'))]);
    const expression=`(async()=>{const legacy=await (${legacyFactory.trim()})(${JSON.stringify(legacyWasm.toString('base64'))});const compatible240=await (${factory240.trim()})(${JSON.stringify(wasm240.toString('base64'))});const local=(${createLegacyApi.toString()})(compatible240,{transport:'compatible-1.4.1'});local.asset='bundled-official-library-1.4.1';return (${installStudioController.toString()})(${createOutputGuard.toString()},${createLegacyApi.toString()},legacy,${createVisionOutputController.toString()},compatible240,local);})()`;
    const result=await studio.webContents.executeJavaScript(expression,true);
    log('Zen service loaded from '+result.asset);
    return studio;
  })().catch(error=>{const failed=studio;studio=null;studioReady=null;failed?.destroy();throw error;});
  return studioReady;
}
async function device(operation,payload={}){
  if(operation==='status'&&!studioReady&&!smoke)return {status:'disconnected',firmware:null,output:{active:false,uncertain:false,sessionDepth:0}};
  const received=Date.now();
  const task=async()=>{
    if(smoke)return fakeDevice(operation,payload);
    const target=await ensureStudio();
    if(operation==='frame')payload={...payload,expiresAt:Math.min(received+150,payload.expiresAt||received+150)};
    const expression=`window.__zenWorkbench.command(${JSON.stringify(operation)},${JSON.stringify(payload)})`;
    return target.webContents.executeJavaScript(expression,operation==='connect');
  };
  const next=commandChain.then(task,task);commandChain=next.catch(()=>{});return next;
}
let fakeArmed=false,fakeReady=false,fakeVision={enabled:false};
function fakeDevice(operation,payload){
  if(operation==='connect')fakeReady=true;
  if(operation==='disconnect')fakeReady=false;
  if(operation==='visionEnable'){
    if(payload.settings?.gain<1)throw Error('Invalid CV output setting: gain');
    return fakeVision={enabled:true,active:false,reason:'Ready — hold physical L2',settings:payload.settings};
  }
  if(operation==='visionDisable')fakeVision={enabled:false};
  if(operation==='arm')fakeArmed=true;
  if(['stop','disconnect'].includes(operation)){fakeArmed=false;fakeVision={enabled:false};}
  if(operation==='slots')return [{slot:1,name:'Test slot',content_type:'Script',bytecode_size:48}];
  return {status:fakeReady?'ready':'disconnected',firmware:fakeReady?'2.3.2':null,supported:true,serial:null,visionOutput:fakeVision,output:{active:fakeArmed,uncertain:false,sessionDepth:fakeArmed?1:0},inputReport:null,outputReport:null,reportAt:null};
}
async function loadPreferences(){
  const defaults=JSON.parse(await fs.readFile(path.join(__dirname,'config.json'),'utf8'));
  try{return {...defaults,...JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'preferences.json'),'utf8'))};}
  catch{return defaults;}
}
async function compile(request){
  const {compileGpc}=await import(pathToFileURL(path.join(__dirname,'compiler','api.mjs')).href);
  const result=await compileGpc(request);
  if(request.operation==='compile'||!request.operation){
    compiled=result.result?.success&&result.result.data?.success?{source:request.source,hex:result.result.data.bytecode}:null;
  }
  return result;
}
async function pickFile(filters){const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters});return result.canceled?null:result.filePaths[0];}
async function trainingStatus(){
  const result={root:preferences.trainingRoot,status:null,audit:null,evaluation:null,rows:[]};
  try{result.status=JSON.parse(await fs.readFile(path.join(preferences.trainingRoot,'training-status.json'),'utf8'));}catch{}
  try{result.audit=JSON.parse(await fs.readFile(path.join(preferences.trainingRoot,'training-data-validation.json'),'utf8'));}catch{}
  try{result.evaluation=JSON.parse(await fs.readFile(path.join(preferences.trainingRoot,'evaluation-split-report.json'),'utf8'));}catch{}
  try{const csv=await fs.readFile(path.join(preferences.trainingRoot,'runs','full-yolov8n','results.csv'),'utf8');
    const lines=csv.trim().split(/\r?\n/),keys=lines.shift().split(',').map(x=>x.trim());
    result.rows=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[keys[i],Number(v.trim())])));
  }catch{}
  return result;
}
function disableVisionOutput(){const wasEnabled=visionOutputEnabled;visionOutputEnabled=false;
  pendingVisionFrame=null;
  return wasEnabled&&studioReady?device('visionDisable').catch(error=>log(error.message,'error')):Promise.resolve({released:true});}
function forwardVisionFrame(payload){
  pendingVisionFrame=payload;if(visionForwarding)return;visionForwarding=true;
  (async()=>{try{
    while(visionOutputEnabled&&pendingVisionFrame){const frame=pendingVisionFrame;pendingVisionFrame=null;await device('visionFrame',frame);}
  }catch(error){log(error.message,'error');}finally{visionForwarding=false;}})();
}
async function stopVision(){await disableVisionOutput();if(vision){vision.kill();vision=null;}return {stopped:true};}
async function startVision(payload){
  if(vision)throw Error('Stop the current vision session first');
  lastVisionFrame=null;lastVisionAt=0;
  const model=payload.model||preferences.model;
  await fs.access(model);
  const confidence=Number(payload.confidence??0.35);
  if(!(confidence>0&&confidence<1))throw Error('Confidence must be between zero and one');
  const worker=app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked','vision_worker.py'):path.join(__dirname,'vision_worker.py');
  const args=[worker,'--model',model,'--confidence',String(confidence),'--device',payload.gpu?'0':'cpu'];
  if(payload.windowTitle)args.push('--window',String(payload.windowTitle));
  else{if(!payload.source)throw Error('Choose an image or video first');await fs.access(payload.source);args.push('--source',payload.source);}
  vision=spawn(preferences.python,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1'}});
  const child=vision;let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',text=>{
    buffer+=text;let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      try{const data=JSON.parse(line);if(data.type==='frame'){
        if(visionPerformanceSamples)visionPerformanceSamples.push({receivedAt:Date.now(),fps:data.fps,inferenceMs:data.inferenceMs,captureWaitMs:data.captureWaitMs,
          captureBackend:data.captureBackend,inferenceBackend:data.inferenceBackend,resolution:data.resolution,preview:!!data.jpeg});
        lastVisionFrame=data;lastVisionAt=Number.isFinite(data.capturedAt)?Math.min(Date.now(),data.capturedAt):Date.now();
        if(visionOutputEnabled)forwardVisionFrame({objects:data.objects,resolution:data.resolution,at:lastVisionAt});
      }
      // Controller detections retain their full rate; preview/DOM traffic is 8 Hz.
      if(data.type!=='frame'||data.jpeg||Date.now()-lastVisionUiAt>=125){
        lastVisionUiAt=Date.now();if(!window.isDestroyed())window.webContents.send('zen:vision',data);
      }}catch{if(line.trim())log(line);}}
  });
  child.stderr.setEncoding('utf8');child.stderr.on('data',text=>log(text.trim(),'warning'));
  child.on('error',error=>log('Vision: '+error.message,'error'));
  child.on('close',code=>{if(vision===child){vision=null;disableVisionOutput();}log('Vision worker stopped (code '+code+')');
    if(!window.isDestroyed())window.webContents.send('zen:vision',{type:'ended',code});});
  return {started:true};
}
async function handle(event,operation,payload={}){
  if(event.sender.id!==window.webContents.id||event.senderFrame.url!==pathToFileURL(path.join(__dirname,'ui','index.html')).href)
    throw Error('Untrusted app request');
  if(allowedDeviceOps.has(operation)){
    if(operation==='visionEnable'){
      if(!vision||vision.exitCode!==null)throw Error('Start continuous vision capture first');
      const result=await device(operation,payload);visionOutputEnabled=true;
      if(lastVisionFrame)await device('visionFrame',{objects:lastVisionFrame.objects,resolution:lastVisionFrame.resolution,at:lastVisionAt});
      return result;
    }
    if(operation==='visionDisable'){visionOutputEnabled=false;return device(operation,payload);}
    if(['stop','disconnect','run','unload'].includes(operation))visionOutputEnabled=false;
    if(operation==='run'){
      if(!compiled||payload.source!==compiled.source)throw Error('Build the current source successfully before running it');
      const result=await device('run',{hex:compiled.hex,approval:payload.approval});appScriptRunning=true;return result;
    }
    if(operation==='backup'){
      const bytes=await device('backup',payload);
      if(!Array.isArray(bytes)||!bytes.every(x=>Number.isInteger(x)&&x>=0&&x<=255))throw Error('Unexpected bytecode response');
      const target=await dialog.showSaveDialog(window,{defaultPath:`zen-slot-${payload.slot}.bin`,filters:[{name:'Compiled bytecode',extensions:['bin']}]});
      if(target.canceled)return null;await fs.writeFile(target.filePath,Buffer.from(bytes));return {path:target.filePath,bytes:bytes.length};
    }
    if(operation==='disconnect'&&appScriptRunning){await device('unload');appScriptRunning=false;}
    const result=await device(operation,payload);if(operation==='unload')appScriptRunning=false;
    if(operation==='status'&&result.visionOutput?.enabled===false)visionOutputEnabled=false;return result;
  }
  switch(operation){
    case 'compile':return compile(payload);
    case 'openScript':{const filename=await pickFile([{name:'GPC scripts',extensions:['gpc','txt']}]);if(!filename)return null;
      const stat=await fs.stat(filename);if(stat.size>1000000)throw Error('Script exceeds one million bytes');
      return {path:filename,source:await fs.readFile(filename,'utf8')};}
    case 'saveScript':{if(typeof payload.source!=='string'||payload.source.length>1000000)throw Error('Invalid source');
      const target=await dialog.showSaveDialog(window,{defaultPath:payload.path||'untitled.gpc',filters:[{name:'GPC script',extensions:['gpc']}]});
      if(target.canceled)return null;await fs.writeFile(target.filePath,payload.source,'utf8');return {path:target.filePath};}
    case 'saveBinary':{if(!compiled)throw Error('Build a script first');const target=await dialog.showSaveDialog(window,{defaultPath:'compiled.bin',filters:[{name:'Zen bytecode',extensions:['bin']}]});
      if(target.canceled)return null;await fs.writeFile(target.filePath,Buffer.from(compiled.hex,'hex'));return {path:target.filePath};}
    case 'openModel':return pickFile([{name:'YOLOv8 weights',extensions:['pt']}]);
    case 'openVideo':return pickFile([{name:'Image or video',extensions:['mp4','mkv','avi','mov','jpg','jpeg','png','webp']}]);
    case 'visionStart':return startVision(payload);
    case 'visionStop':return stopVision();
    case 'trainingStatus':return trainingStatus();
    case 'openTrainingFolder':return shell.openPath(preferences.trainingRoot);
    case 'studioShow':{const target=await ensureStudio();target.show();return {opened:true};}
    case 'getPreferences':return preferences;
    case 'setPreferences':{
      const next={...preferences};for(const key of ['python','trainingRoot','model'])if(typeof payload[key]==='string'&&payload[key].length<2048)next[key]=payload[key];
      preferences=next;await fs.writeFile(path.join(app.getPath('userData'),'preferences.json'),JSON.stringify(next,null,2));return next;
    }
    default:throw Error('Unsupported app operation');
  }
}
async function smokeTest(){
  const results=[];
  const good=await compile({source:'main { set_val(PS4_CROSS, get_val(PS4_CROSS)); }',operation:'compile'});
  if(!good.result?.data?.success)throw Error('Valid GPC failed compilation');results.push('real GPC compilation');
  const bad=await compile({source:'main { this is invalid; }',operation:'compile'});
  if(bad.result?.success&&bad.result?.data?.success)throw Error('Invalid GPC was accepted');results.push('invalid GPC diagnostics');
  const dom=await window.webContents.executeJavaScript(`(async()=>{
    const tabs=[...document.querySelectorAll('[data-page]')];
    for(const tab of tabs){tab.click();await new Promise(r=>setTimeout(r,30));}
    document.querySelector('[data-page="editor"]').click();
    document.getElementById('source').value='main { set_val(PS4_CROSS, 0); }';
    document.getElementById('source').dispatchEvent(new Event('input'));
    await window.workbench.build('compile');
    return {tabs:tabs.length,build:document.getElementById('build-summary').textContent,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
  if(dom.tabs!==6||!dom.build.includes('Build succeeded')||dom.horizontalOverflow)throw Error('UI smoke check failed: '+JSON.stringify(dom));
  results.push('all six workspace pages','renderer-to-main compiler IPC','no horizontal overflow');
  const formatted=await window.webContents.executeJavaScript(`window.workbench.build('format').then(result=>result.result.success)`);
  if(!formatted)throw Error('Renderer format failed');results.push('real GPC formatting through UI');
  if(process.env.ZEN_SMOKE_VISION_MODEL&&process.env.ZEN_SMOKE_VISION_SOURCE){
    lastVisionFrame=null;
    const payload={model:process.env.ZEN_SMOKE_VISION_MODEL,source:process.env.ZEN_SMOKE_VISION_SOURCE,gpu:false,confidence:0.35};
    await window.webContents.executeJavaScript(`(async()=>{
      window.workbench.applyStatus(await window.zen.invoke('connect'));
      document.getElementById('model-path').value=${JSON.stringify(payload.model)};
      document.getElementById('video-path').value=${JSON.stringify(payload.source)};
      document.getElementById('vision-source').value='file';
      await window.workbench.startVision();
      document.getElementById('cv-gain').value='0';document.getElementById('cv-enable').click();
      await new Promise(resolve=>setTimeout(resolve,200));
      if(document.getElementById('cv-output-error').classList.contains('hidden')||!document.getElementById('cv-output-error').textContent.includes('Invalid CV output setting'))throw Error('Inline enable error missing');
      document.getElementById('cv-gain').value='50';document.getElementById('cv-enable').click();
      await new Promise(resolve=>setTimeout(resolve,200));
      if(document.getElementById('cv-output-state').textContent!=='READY · HOLD L2')throw Error('L2 output enable failed');
      document.getElementById('cv-disable').click();await new Promise(resolve=>setTimeout(resolve,100));
      if(document.getElementById('cv-output-state').textContent!=='DISABLED')throw Error('L2 output disable failed');
    })()`);
    results.push('L2 vision enable and disable through renderer IPC with fake device');
    results.push('failed vision enable displays the actual error inline');
    const deadline=Date.now()+60000;
    while(!lastVisionFrame&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    if(!lastVisionFrame)throw Error('Packaged vision worker did not return a preview');
    if(lastVisionFrame.resolution.length!==2||!Array.isArray(lastVisionFrame.objects))throw Error('Malformed vision preview');
    results.push('packaged Python vision IPC and annotated preview');await stopVision();
    await window.webContents.executeJavaScript(`(async()=>{await new Promise(resolve=>setTimeout(resolve,200));
      if(document.getElementById('vision-fps').textContent!=='— FPS')throw Error('Stopped vision left a stale FPS value');})()`);
    results.push('stopped vision clears stale FPS');
  }
  await window.webContents.executeJavaScript(`document.querySelector('[data-page="vision"]').click();document.getElementById('cv-enable').scrollIntoView({block:'center'});`);
  await new Promise(resolve=>setTimeout(resolve,150));
  await fs.writeFile(path.resolve(__dirname,'..','zen-workbench-vision-preview.png'),(await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('[data-page="overview"]').click();document.querySelector('main').scrollTop=0;`);
  await new Promise(resolve=>setTimeout(resolve,350));
  const image=await window.webContents.capturePage();
  const output=path.resolve(__dirname,'..','zen-workbench-smoke.json');
  await fs.writeFile(output,JSON.stringify({passed:true,checks:results,dom},null,2));
  await fs.writeFile(path.resolve(__dirname,'..','zen-workbench-preview.png'),image.toPNG());
  console.log(JSON.stringify({passed:true,checks:results,output}));
  app.exit(0);
}

async function benchmarkVision(){
  visionPerformanceSamples=[];
  const payload={model:process.env.ZEN_BENCHMARK_MODEL||preferences.model,windowTitle:process.env.ZEN_BENCHMARK_WINDOW||'PS Remote Play',gpu:true,confidence:.35};
  await window.webContents.executeJavaScript(`(async()=>{
    window.workbench.setPage('vision');
    document.getElementById('model-path').value=${JSON.stringify(payload.model)};
    document.getElementById('vision-source').value='window';document.getElementById('vision-source').dispatchEvent(new Event('change'));
    document.getElementById('window-title').value=${JSON.stringify(payload.windowTitle)};
    document.getElementById('vision-gpu').checked=true;await window.workbench.startVision();
  })()`);
  const deadline=Date.now()+45000;
  while(visionPerformanceSamples.length<360&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  const all=visionPerformanceSamples;visionPerformanceSamples=null;await stopVision();
  if(all.length<120)throw Error('Insufficient live vision frames for performance check');
  const samples=all.slice(30),last=samples.at(-1),mean=key=>samples.reduce((sum,row)=>sum+(row[key]||0),0)/samples.length;
  const result={version:app.getVersion(),frames:all.length,steadyDetectionFps:(samples.length-1)*1000/(last.receivedAt-samples[0].receivedAt),
    lastRollingFps:last.fps,meanInferenceMs:mean('inferenceMs'),meanCaptureWaitMs:mean('captureWaitMs'),
    previewFrames:samples.filter(row=>row.preview).length,previewLimitFps:8,sourceResolution:last.resolution,
    inferenceBackend:last.inferenceBackend,captureBackend:last.captureBackend,controllerOutputSent:false,
    uiVisible:true,realPackagedWorker:app.isPackaged};
  const out=path.dirname(preferences.trainingRoot);
  await fs.writeFile(path.join(out,'zen-workbench-performance.json'),JSON.stringify(result,null,2));
  await fs.writeFile(path.join(out,'zen-workbench-performance.png'),(await window.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result));app.exit(0);
}

async function startDefaultVision(){
  await window.webContents.executeJavaScript(`(async()=>{
    window.workbench.setPage('vision');document.getElementById('model-path').value=${JSON.stringify(preferences.model)};
    document.getElementById('vision-source').value='window';document.getElementById('vision-source').dispatchEvent(new Event('change'));
    document.getElementById('vision-gpu').checked=true;await window.workbench.startVision();
  })()`);
}

if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
  preferences=await loadPreferences();
  window=new BrowserWindow({width:1420,height:920,minWidth:1060,minHeight:720,show:visionBenchmarkMode||(!smoke&&!probe&&!connectProbe),
    title:'Zen Workbench',backgroundColor:'#0e1117',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:(smoke&&!visionBenchmarkMode)||probe||connectProbe}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.once('ready-to-show',()=>{if(!smoke&&!probe&&!connectProbe)window.show();});
  window.webContents.on('will-navigate',event=>event.preventDefault());
  ipcMain.handle('zen:command',handle);
  await window.loadFile(path.join(__dirname,'ui','index.html'));
  window.on('close',event=>{
    if(closing||(smoke&&!visionBenchmarkMode))return;event.preventDefault();closing=true;
    const cleanup=stopVision().then(()=>studioReady?device('stop').then(()=>appScriptRunning?device('unload'):null).then(()=>device('disconnect')):null).catch(error=>console.error(error));
    Promise.race([cleanup,new Promise(r=>setTimeout(r,4500))]).finally(()=>{studio?.destroy();window.destroy();app.quit();});
  });
  if(visionBenchmarkMode)await benchmarkVision();else if(smoke)await smokeTest();
  if(autoStartVision&&!smoke&&!probe&&!connectProbe)startDefaultVision().catch(error=>log(error.message,'error'));
  if(autoConnect)device('connect').then(async status=>{
    log(`Connected using ${status.transport||'vendor'} transport`);
    await new Promise(resolve=>setTimeout(resolve,2000));const current=await device('status');
    const report={status:current.status,firmware:current.firmware,supported:current.supported,transport:current.transport,
      inputChannels:current.inputReport?.input_values?.length||0,outputChannels:current.outputReport?.output_values?.length||0,
      output:current.output,controllerOutputSent:false,inputAgeMs:current.visionOutput?.inputAgeMs,
      physicalL2:current.visionOutput?.l2,controllerConnected:current.visionOutput?.controllerConnected};
    const out=path.dirname(preferences.trainingRoot);
    await fs.writeFile(path.join(out,'zen-workbench-live-status.json'),JSON.stringify(report,null,2));
    const image=await window.webContents.capturePage();await fs.writeFile(path.join(out,'zen-workbench-live.png'),image.toPNG());
  }).catch(error=>log(error.message,'error'));
  if(probe||connectProbe){
    await ensureStudio();let status=await device('status');
    const capabilities=await studio.webContents.executeJavaScript(`window.__zenWorkbench.command('capabilities')`);
    if(connectProbe&&(status.status!=='ready'||!status.supported))status=await device('connect');
    if(connectProbe)await new Promise(resolve=>setTimeout(resolve,1800));
    status=await device('status');
    const {serial,...publicStatus}=status;
    const activeCapabilities=await studio.webContents.executeJavaScript(`window.__zenWorkbench.command('capabilities')`);
    const result={readOnly:true,controllerOutputSent:false,initialVendorCapabilities:capabilities,capabilities:activeCapabilities,status:publicStatus};
    if(connectProbe&&status.status==='ready'){
      result.slots=(await device('slots')).map((slot,index)=>({slot:slot.slot_number||index+1,bytecodeBytes:slot.bytecode_size,hasScript:!!slot.flags?.script}));
      const occupied=result.slots.find(slot=>slot.bytecodeBytes>0);
      if(occupied){const bytes=await device('backup',{slot:occupied.slot});result.backupValidation={slot:occupied.slot,metadataBytes:occupied.bytecodeBytes,readBytes:bytes.length};
        if(bytes.length!==occupied.bytecodeBytes)throw Error('Slot backup length did not match metadata');}
      await new Promise(resolve=>setTimeout(resolve,500));const afterMetadata=await device('status');
      result.streamingValidation={freshAfterMetadata:afterMetadata.reportAt>status.reportAt,inputAgeMs:afterMetadata.visionOutput?.inputAgeMs,
        physicalL2:afterMetadata.visionOutput?.l2,controllerConnected:afterMetadata.visionOutput?.controllerConnected};
      if(!result.streamingValidation.freshAfterMetadata||result.streamingValidation.inputAgeMs>1000)throw Error('Controller streaming did not resume after metadata reads');
      result.stabilitySamples=[];
      for(let sample=0;sample<8;sample++){
        await new Promise(resolve=>setTimeout(resolve,1000));const current=await device('status');
        const row={second:sample+1,status:current.status,inputAgeMs:current.visionOutput?.inputAgeMs};result.stabilitySamples.push(row);
        if(row.status!=='ready'||!Number.isFinite(row.inputAgeMs)||row.inputAgeMs>1000)throw Error('Device stability check failed: '+JSON.stringify(row));
      }
    }
    await fs.writeFile(path.resolve(__dirname,'..','zen-workbench-studio-probe.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));if(connectProbe)await device('disconnect');studio?.destroy();app.exit(0);
  }
}).catch(error=>{console.error(error);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});
