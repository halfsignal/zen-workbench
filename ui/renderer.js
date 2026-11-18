'use strict';
const $=id=>document.getElementById(id);
const names={ps:0,share:1,options:2,r1:3,r2:4,r3:5,l1:6,l2:7,l3:8,rx:9,ry:10,lx:11,ly:12,up:13,down:14,left:15,right:16,triangle:17,circle:18,cross:19,square:20};
const channelNames=['PS','SHARE','OPTIONS','R1','R2','R3','L1','L2','L3','RIGHT X','RIGHT Y','LEFT X','LEFT Y','UP','DOWN','LEFT','RIGHT','TRIANGLE','CIRCLE','CROSS','SQUARE'];
let page='overview',armed=false,sending=false,polling=false,currentPath=null,dirty=false,prefs={},lastStatus=null,visionRunning=false,cvEnabled=false;
let frame=Array(38).fill(0),logLines=[],training=null;
const number=value=>Number(value||0).toLocaleString();
function activity(message,level='info'){
  const text=`${new Date().toLocaleTimeString()}  ${level.toUpperCase()}  ${message}`;
  logLines.push(text);logLines=logLines.slice(-300);$('log-output').textContent=logLines.join('\n');
  $('log-output').scrollTop=$('log-output').scrollHeight;$('footer-message').textContent=message;
}
function error(value){activity(value?.message||String(value),'error');}
async function invoke(op,payload){try{return await window.zen.invoke(op,payload);}catch(value){error(value);throw value;}}
function on(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(()=>{}));}
function setPage(name){
  if(!$(name))return;page=name;
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===name));
  document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('selected',x.dataset.page===name));
  $('breadcrumb').textContent=({overview:'OVERVIEW',monitor:'DEVICE MONITOR',editor:'GPC EDITOR',vision:'COMPUTER VISION',training:'MODEL TRAINING',settings:'PREFERENCES'})[name];
  if(name==='training')refreshTraining();
}
document.querySelectorAll('[data-page]').forEach(x=>x.addEventListener('click',()=>setPage(x.dataset.page)));
document.querySelectorAll('[data-go]').forEach(x=>x.addEventListener('click',()=>setPage(x.dataset.go)));
async function confirmAction(title,message){
  const modal=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-message').textContent=message;
  return new Promise(resolve=>{
    const done=value=>{modal.close();$('confirm-accept').onclick=null;$('confirm-cancel').onclick=null;modal.oncancel=null;resolve(value);};
    $('confirm-accept').onclick=()=>done(true);$('confirm-cancel').onclick=()=>done(false);modal.oncancel=event=>{event.preventDefault();done(false);};modal.showModal();
  });
}
function channelValues(report){
  if(!report)return null;
  if(Array.isArray(report)&&report.length>=21&&report.every(x=>typeof x==='number'))return report;
  for(const value of Object.values(report))if(value&&typeof value==='object'){
    const found=channelValues(value);if(found)return found;
  }
  const keys=Object.keys(report);
  if(keys.length>=21&&keys.every(x=>/^\d+$/.test(x)))return Object.values(report);
  return null;
}
function updateChannels(input,output){
  const ins=channelValues(input),outs=channelValues(output);
  for(let i=0;i<channelNames.length;i++)for(const [kind,values]of [['in',ins],['out',outs]]){
    let value=values?.[i];if(typeof value==='number'&&value>127)value-=256;
    const element=$(`${kind}-${i}`);element.querySelector('span').textContent=typeof value==='number'?value:'—';
    element.querySelector('b').style.width=typeof value==='number'?Math.min(100,Math.abs(value))+'%':'0';
  }
}
for(let i=0;i<channelNames.length;i++){
  const row=document.createElement('div');row.className='channel-row';
  const label=document.createElement('span');label.className='channel-name';label.textContent=channelNames[i];row.append(label);
  for(const kind of ['in','out']){const value=document.createElement('div');value.id=`${kind}-${i}`;value.className='channel-value'+(kind==='out'?' output':'');
    value.append(document.createElement('b'));const text=document.createElement('span');text.textContent='—';value.append(text);row.append(value);}
  $('channels').append(row);
}
function applyStatus(value){
  const wasReady=lastStatus?.status==='ready'&&lastStatus?.supported===true;lastStatus=value;const ready=value.status==='ready',usable=ready&&value.supported===true;
  $('device-pill').textContent=usable?'CONNECTED':ready?'FIRMWARE CHECK':String(value.status||'offline').toUpperCase();
  $('device-pill').classList.toggle('online',ready);$('side-dot').classList.toggle('online',ready);
  $('side-status').textContent=ready?'Cronus Zen connected':'No device connected';
  $('overview-status').textContent=usable?'Connected':ready?'Compatibility required':value.status==='connecting'?'Connecting…':'Disconnected';
  $('firmware').textContent=value.firmware||'—';$('operational-mode').textContent=value.operationalMode||'Waiting for a device';
  $('zen-display-status').textContent=ready?'USB CONNECTED':'CONNECT DEVICE';
  $('connection-detail').textContent=usable?'Your Zen is connected. Device monitoring and temporary script execution are available.':ready?`Firmware ${value.firmware||'unknown'} is connected, but controller output is unavailable. Required library firmware: ${value.minimumFirmware||'checking…'}.`:'Connect your Zen in normal operating mode. Close other applications that own the device connection.';
  $('disconnect').disabled=!ready;$('connect').disabled=usable||value.status==='connecting';
  $('read-slots').disabled=!ready;$('run').disabled=!usable;$('unload').disabled=!usable;
  const active=!!value.output?.active;
  if(armed&&!active){armed=false;frame.fill(0);updateArm();}
  applyVisionOutput(value.visionOutput);
  $('arm').disabled=armed||!usable||cvEnabled;
  $('output-status').textContent=value.output?.uncertain?'Reconnect required':cvEnabled?(value.visionOutput?.tracking?'CV tracking':'CV · hold L2'):active?'Manual enabled':'Disarmed';
  $('report-age').textContent=value.reportAt?`${Math.max(0,Date.now()-value.reportAt)} MS AGO`:'NO REPORTS';
  updateChannels(value.inputReport,value.outputReport);
  if(page==='monitor')$('raw-reports').textContent=JSON.stringify({input:value.inputReport??null,output:value.outputReport??null},null,2);
  if(usable&&!wasReady)readSlots().catch(()=>{});
}
async function poll(){if(polling)return;polling=true;try{applyStatus(await window.zen.invoke('status'));}catch(e){
  if(lastStatus?.status==='ready')error(e);applyStatus({status:'disconnected',output:{active:false}});
}finally{polling=false;}}
on('connect',async()=>{activity('Opening the Zen connection…');$('connect').disabled=true;try{applyStatus(await invoke('connect'));}finally{$('connect').disabled=lastStatus?.status==='ready';}});
on('disconnect',async()=>{await disarm();applyStatus(await invoke('disconnect'));activity('Device disconnected.');});
on('studio-show',()=>invoke('studioShow'));
async function readSlots(){
  if(armed)await disarm();const slots=await invoke('slots');$('slots').replaceChildren();
  if(!Array.isArray(slots)||!slots.length){$('slots').textContent='No slot metadata returned.';return;}
  slots.forEach((slot,i)=>{const row=document.createElement('div');row.className='slot-row';
    const index=document.createElement('div');index.className='slot-index';index.textContent=String(i+1);
    const info=document.createElement('div');info.className='slot-info';const title=document.createElement('strong');
    title.textContent=slot.content_name||slot.name||slot.script_name||slot.filename||slot.title||((slot.bytecode_size||slot.bytecodeSize)?'Script':'Empty slot');
    const sub=document.createElement('small');sub.textContent=`${slot.content_type||slot.contentType||'Slot'} · ${number(slot.bytecode_size||slot.bytecodeSize)} bytes`;
    info.append(title,sub);const backup=document.createElement('button');backup.className='quiet';backup.textContent='Back up';backup.disabled=!(slot.bytecode_size||slot.bytecodeSize);
    backup.addEventListener('click',()=>invoke('backup',{slot:i+1}).then(result=>result&&activity('Saved slot backup: '+result.path)).catch(()=>{}));row.append(index,info,backup);$('slots').append(row);
  });
}
on('read-slots',readSlots);
function updateArm(){
  $('arm-state').textContent=armed?'ENABLED':'DISARMED';$('arm').textContent=armed?'Manual output enabled':'Enable manual output';
  $('arm').disabled=armed||cvEnabled||lastStatus?.status!=='ready'||lastStatus?.supported!==true;document.querySelectorAll('[data-control]').forEach(x=>{x.disabled=!armed;if(!armed)x.classList.remove('pressed');});
  $('axis-lx').disabled=$('axis-ly').disabled=!armed;
}
async function disarm(){armed=false;frame.fill(0);$('axis-lx').value=$('axis-ly').value='0';updateArm();
  const result=await invoke('stop');applyVisionOutput({enabled:false,reason:'Output stopped'});if(result.released===false)throw Error('Release was not confirmed. Reconnect the Zen.');return result;}
on('arm',async()=>{
  if(!await confirmAction('Enable manual controller output?','Buttons and stick controls in this app will send real input through the Zen. Keep the console in a suitable menu.'))return;
  await invoke('arm',{approval:'ENABLE_MANUAL_OUTPUT'});armed=true;frame.fill(0);updateArm();activity('Manual output enabled.');
});
on('stop-output',disarm);
document.querySelectorAll('[data-control]').forEach(button=>{
  const press=event=>{if(!armed)return;event.preventDefault();frame[names[button.dataset.control]]=100;button.classList.add('pressed');if(event.pointerId!==undefined)button.setPointerCapture(event.pointerId);};
  const release=()=>{frame[names[button.dataset.control]]=0;button.classList.remove('pressed');};
  button.addEventListener('pointerdown',press);button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);
  button.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)&&!event.repeat)press(event);});button.addEventListener('keyup',release);button.addEventListener('blur',release);
});
for(const axis of ['lx','ly']){
  const control=$('axis-'+axis);control.addEventListener('input',()=>{if(armed)frame[names[axis]]=Number(control.value);});
  for(const name of ['pointerup','pointercancel','keyup','blur'])control.addEventListener(name,()=>{control.value='0';frame[names[axis]]=0;});
}
window.addEventListener('blur',()=>{if(armed)disarm().catch(()=>{});});
setInterval(async()=>{if(!armed||sending)return;sending=true;try{await invoke('frame',{values:frame.slice(),expiresAt:Date.now()+150});}
  catch{armed=false;frame.fill(0);updateArm();await window.zen.invoke('stop').catch(()=>{});}finally{sending=false;}},50);
updateArm();

const sample='// Cronus Zen GPC - passthrough example\n// Build locally with F7. Running requires a connected Zen.\n\nmain {\n    set_val(PS4_CROSS, get_val(PS4_CROSS));\n}\n';
try{$('source').value=localStorage.getItem('zen-workbench-draft')||sample;currentPath=localStorage.getItem('zen-workbench-script-path')||null;}catch{$('source').value=sample;}
function editorChanged(){
  dirty=true;$('build-summary').textContent='Source changed · build required';
  $('line-numbers').textContent=Array.from({length:$('source').value.split('\n').length},(_,i)=>i+1).join('\n');
  try{localStorage.setItem('zen-workbench-draft',$('source').value);if(currentPath)localStorage.setItem('zen-workbench-script-path',currentPath);}catch{}
  $('script-name').textContent=(currentPath?currentPath.split(/[\\/]/).pop():'untitled.gpc').toUpperCase();cursor();
}
function cursor(){const before=$('source').value.slice(0,$('source').selectionStart),lines=before.split('\n');$('cursor-position').textContent=`Ln ${lines.length}, Col ${lines.at(-1).length+1}`;}
$('source').addEventListener('input',editorChanged);$('source').addEventListener('click',cursor);$('source').addEventListener('keyup',cursor);
$('source').addEventListener('scroll',()=>{$('line-numbers').scrollTop=$('source').scrollTop;});
$('source').addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();const start=$('source').selectionStart,end=$('source').selectionEnd;
  $('source').setRangeText('    ',start,end,'end');editorChanged();}});
editorChanged();dirty=false;
async function build(operation='compile'){
  const source=$('source').value;$('build-summary').textContent='Compiling…';
  const response=await invoke('compile',{source,operation});const result=response.result;
  $('compiler-version').textContent='GPC '+(response.version?.data?.version||'WASM');
  if(operation==='format'&&result?.success){const formatted=result.data?.output??result.data?.formatted??result.data?.formattedSource??result.data?.source??result.data?.text;
    if(typeof formatted!=='string')throw Error('Compiler did not return formatted source');$('source').value=formatted;editorChanged();}
  $('diagnostics').replaceChildren();$('diagnostics').classList.remove('empty');
  const diagnostics=result?.diagnostics||[];
  for(const item of diagnostics){const row=document.createElement('div');row.className='diagnostic '+String(item.severity||'').toLowerCase();
    row.textContent=`${item.severity||'Info'} ${item.code||''} · ${item.line||1}:${item.column||1}  ${item.message||''}`;
    row.addEventListener('click',()=>{const lines=$('source').value.split('\n');const index=lines.slice(0,(item.line||1)-1).reduce((n,x)=>n+x.length+1,0)+(item.column||1)-1;
      $('source').focus();$('source').setSelectionRange(index,index+Math.max(1,item.length||1));cursor();});$('diagnostics').append(row);}
  const success=!!result?.success&&(operation!=='compile'||result.data?.success===true);
  const summary=success?(operation==='compile'?`Build succeeded · ${number(result.data.bytecodeSize)} bytes`:operation==='format'?'Source formatted':'Check passed'):'Build failed';
  $('build-summary').textContent=summary;
  if(!diagnostics.length){const row=document.createElement('div');row.className='diagnostic '+(success?'success':'error');row.textContent=success?'No diagnostics.':result?.error||'Compilation failed.';$('diagnostics').append(row);}
  activity(summary,success?'info':'error');return response;
}
window.workbench={build,setPage,channelValues,applyStatus,startVision};
on('build',()=>build());on('check',()=>build('check'));on('format',()=>build('format'));
on('script-new',async()=>{if(dirty&&!await confirmAction('Start a new script?','The current draft will be replaced. Save it first if you need a separate copy.'))return;
  currentPath=null;$('source').value=sample;editorChanged();dirty=false;});
on('script-open',async()=>{if(dirty&&!await confirmAction('Open another script?','Opening another file replaces the current draft.'))return;
  const result=await invoke('openScript');if(result){currentPath=result.path;$('source').value=result.source;editorChanged();dirty=false;activity('Opened '+result.path);}});
on('script-save',async()=>{const result=await invoke('saveScript',{source:$('source').value,path:currentPath});if(result){currentPath=result.path;editorChanged();dirty=false;activity('Saved '+result.path);}});
on('save-bin',async()=>{const result=await invoke('saveBinary');if(result)activity('Saved compiled bytecode: '+result.path);});
on('run',async()=>{if(!await confirmAction('Run this script on the Zen?','A successful build of the current source will run temporarily in RAM and can produce real controller output.'))return;
  await disarm();const result=await invoke('run',{source:$('source').value,approval:'RUN_COMPILED_SCRIPT'});activity(`Script running in RAM (${result.bytes} bytes).`);});
on('unload',async()=>{await disarm();await invoke('unload');activity('Temporary GPC script stopped.');});
document.addEventListener('keydown',event=>{if(event.key==='F7'){event.preventDefault();build().catch(()=>{});}if(event.ctrlKey&&event.key.toLowerCase()==='s'){event.preventDefault();$('script-save').click();}});

on('model-pick',async()=>{const value=await invoke('openModel');if(value)$('model-path').value=value;});
function applyVisionOutput(value={}){
  cvEnabled=!!value?.enabled;
  $('cv-enable').disabled=cvEnabled||!visionRunning||lastStatus?.status!=='ready'||lastStatus?.supported!==true;
  $('cv-disable').disabled=!cvEnabled;
  $('cv-output-state').textContent=cvEnabled?(value.active?'L2 ACTIVE':'READY · HOLD L2'):'DISABLED';
  $('cv-output-reason').textContent=value.reason||'Enable after starting a live vision session.';
  $('cv-output-values').textContent=`Physical L2: ${value.l2||0} · Input: ${Number.isFinite(value.inputAgeMs)?value.inputAgeMs+' ms old':'waiting'} · Sent RX: ${value.rx||0} / RY: ${value.ry||0} · Frames: ${value.framesSent||0}`;
  for(const id of ['cv-gain','cv-max','cv-fov','cv-invert'])$(id).disabled=cvEnabled;
}
async function enableVisionOutput(){
  // The device's enable operation releases manual output itself. Sending a
  // separate global stop here hid every enable error behind "Emergency stop".
  armed=false;frame.fill(0);$('axis-lx').value=$('axis-ly').value='0';updateArm();
  $('cv-output-error').classList.add('hidden');$('cv-enable').disabled=true;
  const settings={gain:Number($('cv-gain').value),maxCorrection:Number($('cv-max').value),fovFraction:Number($('cv-fov').value)/100,
    minConfidence:Number($('confidence').value),invertY:$('cv-invert').checked};
  try{
    const value=await invoke('visionEnable',{approval:'ENABLE_L2_VISION_OUTPUT',settings});
    applyVisionOutput(value);updateArm();activity('L2 vision output ready. Hold physical L2 to track a detected character.');return value;
  }catch(value){
    $('cv-output-error').textContent='Could not enable L2 output: '+(value?.message||String(value));
    $('cv-output-error').classList.remove('hidden');applyVisionOutput(lastStatus?.visionOutput);throw value;
  }
}
on('cv-enable',enableVisionOutput);
on('cv-disable',async()=>{await invoke('visionDisable');$('cv-output-error').classList.add('hidden');applyVisionOutput({enabled:false,reason:'Vision output disabled'});updateArm();});
on('video-pick',async()=>{const value=await invoke('openVideo');if(value)$('video-path').value=value;});
$('confidence').addEventListener('input',()=>{$('confidence-value').textContent=Number($('confidence').value).toFixed(2);});
function sourceControls(){const isWindow=$('vision-source').value==='window';$('video-path').classList.toggle('hidden',isWindow);$('video-pick').classList.toggle('hidden',isWindow);$('window-title').parentElement.classList.toggle('hidden',!isWindow);}
$('vision-source').addEventListener('change',sourceControls);sourceControls();
async function startVision(){
  await invoke('visionStart',{model:$('model-path').value,source:$('video-path').value,windowTitle:$('vision-source').value==='window'?$('window-title').value:null,
    confidence:Number($('confidence').value),gpu:$('vision-gpu').checked});visionRunning=true;applyVisionOutput(lastStatus?.visionOutput);$('vision-state').textContent='STARTING';$('vision-fps').textContent='Starting…';$('vision-latency').textContent='Warming up model';$('vision-start').disabled=true;activity('Starting vision worker…');
}
on('vision-start',startVision);
on('vision-stop',async()=>{await invoke('visionStop');visionRunning=false;applyVisionOutput({enabled:false,reason:'Vision stopped'});$('vision-state').textContent='STOPPED';$('vision-start').disabled=false;});
window.zen.onVision(value=>{
  if(value.type==='error'){error(value.message);return;}
  if(value.type==='paused'){$('vision-state').textContent='PAUSED';$('vision-fps').textContent='Paused';$('vision-latency').textContent='Waiting for source frames';activity(value.message,'warning');return;}
  if(value.type==='ended'){visionRunning=false;applyVisionOutput({enabled:false,reason:'Vision source ended'});$('vision-state').textContent='STOPPED';$('vision-fps').textContent='— FPS';$('vision-latency').textContent='Stopped';$('vision-start').disabled=false;return;}
  if(value.type!=='frame')return;
  $('vision-state').textContent='RUNNING';
  // The preview is throttled below the detection rate, so most frames carry no JPEG.
  if(value.jpeg){$('vision-frame').src='data:image/jpeg;base64,'+value.jpeg;$('vision-frame').style.display='block';$('vision-placeholder').style.display='none';}
  $('vision-fps').textContent=Number(value.fps).toFixed(1)+' FPS';$('vision-latency').textContent=Number(value.inferenceMs).toFixed(1)+' ms inference';
  $('vision-latency').title=`${value.inferenceBackend||'YOLO'} · ${value.captureBackend||'capture'} · source ${Number(value.captureFps||0).toFixed(1)} FPS · wait ${Number(value.captureWaitMs||0).toFixed(1)} ms · preview ${value.previewFps||8} FPS`;
  $('vision-objects').textContent=value.objects.length+' detections';
  $('detections').textContent=value.objects.map(x=>`${x.label}  ${(x.confidence*100).toFixed(1)}%  xyxy [${x.box.map(n=>Math.round(n)).join(', ')}]`).join('\n');
  $('detections').style.whiteSpace='pre-wrap';
});
function metric(label,value){const card=document.createElement('div');card.textContent=label;const strong=document.createElement('strong');strong.textContent=Number.isFinite(value)?value.toFixed(3):'—';card.append(strong);return card;}
async function refreshTraining(){
  try{
    training=await window.zen.invoke('trainingStatus');const data=training.audit,status=training.status;
    if(data){$('train-count').textContent=number(data.split_images.train);$('val-count').textContent=`${number(data.split_images.valid)} / ${number(data.split_images.test)}`;
      $('dataset-checks').replaceChildren();$('dataset-checks').classList.remove('empty');
      const items=[['Label validation',data.status.toUpperCase()],['Validated image / label pairs',number(data.all_label_files_validated)],
        ['Polygons converted to bounding boxes',number(data.polygon_boxes_converted)],['Original polygon labels','Saved separately'],
        ['Classes',data.class_names.join(' / ')],['Person annotations',`${data.annotations_per_class['1']} · very sparse class`]];
      if(training.evaluation)items.push(['Distinct-source final test',number(training.evaluation.evaluation_test_images)+' images'],['Independent Person test examples','None available']);
      items.forEach(([name,value])=>{const row=document.createElement('div');row.className='check-row';const label=document.createElement('span');label.textContent=name;
        const result=document.createElement('strong');result.textContent=value;row.append(label,result);$('dataset-checks').append(row);});
    }
    if(!status){$('train-state').textContent='Not started';$('train-epoch').textContent='No training status file yet';return;}
    $('train-state').textContent=status.state==='complete'?'Complete':status.state==='failed'?'Failed':'Training';
    $('train-epoch').textContent=`Epoch ${status.epoch||status.epochs} of ${status.epochs}`;
    $('training-gpu').textContent=status.gpu||'NVIDIA / CUDA';
    const batchFraction=(status.batches_completed||0)/(status.batches_per_epoch||1);
    const progress=status.state==='complete'?1:Math.max(training.rows.length/(status.epochs||3),((status.epoch||1)-1+Math.min(1,batchFraction))/(status.epochs||3));
    $('training-progress').style.width=Math.min(100,progress*100)+'%';
    $('train-detail').textContent=status.state==='complete'?'Weights and ONNX export verified':`Full dataset · ${number(status.batches_completed)} / ${number(status.batches_per_epoch)} batches in this epoch`;
    $('train-elapsed').textContent=`${Math.round((status.elapsed_seconds||0)/60)} min elapsed`;
    const metrics=status.held_out_test_metrics||training.rows.at(-1)||{};$('metric-cards').replaceChildren(
      metric('PRECISION',metrics['metrics/precision(B)']),metric('RECALL',metrics['metrics/recall(B)']),
      metric('mAP50',metrics['metrics/mAP50(B)']),metric('mAP50–95',metrics['metrics/mAP50-95(B)']));
    $('metric-origin').textContent=status.state==='complete'?'Distinct-source final test metrics. Person has no independent test examples.':training.rows.length?'Source validation metrics; overlapping source images can inflate these scores.':'Metrics appear after the first validation pass.';
    drawLoss(training.rows);
  }catch(e){error(e);}
}
function drawLoss(rows){
  const canvas=$('loss-chart'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#273449';ctx.lineWidth=1;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(35,20+i*45);ctx.lineTo(w-15,20+i*45);ctx.stroke();}
  const values=rows.map(x=>x['train/box_loss']).filter(Number.isFinite);ctx.font='12px Segoe UI';ctx.fillStyle='#7c92b1';
  if(!values.length){ctx.fillText('Box loss will appear after the first completed epoch.',35,105);return;}
  ctx.fillText('TRAIN / BOX LOSS',35,16);const max=Math.max(...values)*1.15,min=0;
  ctx.strokeStyle='#73e1c4';ctx.lineWidth=3;ctx.beginPath();values.forEach((v,i)=>{const x=35+i*(w-70)/Math.max(1,values.length-1),y=h-25-(v-min)/(max-min)*(h-65);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  values.forEach((v,i)=>{const x=35+i*(w-70)/Math.max(1,values.length-1),y=h-25-v/max*(h-65);ctx.fillStyle='#73e1c4';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.fillText(v.toFixed(3),x+7,y-8);});
}
on('training-folder',()=>invoke('openTrainingFolder'));
on('settings-save',async()=>{prefs=await invoke('setPreferences',{python:$('python-path').value,trainingRoot:$('training-root').value,model:$('default-model').value});activity('Preferences saved.');});
on('toggle-log',()=>{$('activity').classList.toggle('open');});on('clear-log',()=>{logLines=[];$('log-output').textContent='';});
window.zen.onLog(value=>activity(value.message,value.level));
(async()=>{
  try{prefs=await invoke('getPreferences');$('python-path').value=prefs.python;$('training-root').value=prefs.trainingRoot;$('default-model').value=$('model-path').value=prefs.model;
    await poll();await refreshTraining();}catch(e){error(e);}
})();
setInterval(poll,400);setInterval(()=>{if(page==='training')refreshTraining();},3000);
