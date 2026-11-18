function createVisionOutputController({getGuard,getInput,getConnection,now=()=>Date.now(),startTimer=true}){
  const defaults={l2Threshold:20,gain:50,maxCorrection:35,minimumCorrection:8,smoothing:.4,
    fovFraction:.3,deadzonePixels:6,targetMaxAgeMs:400,inputMaxAgeMs:200,minConfidence:.35,invertY:false};
  let settings={...defaults},enabled=false,owns=false,busy=false,generation=0,frame=null,filtered=[0,0];
  let detail={reason:'Disabled',l2:0,tracking:false,framesSent:0,rx:0,ry:0,target:null};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const snapshot=()=>{const input=getInput(),values=controllerFrame(input);return {enabled,active:owns,...detail,l2:values?.[7]||0,
    inputAgeMs:Number.isFinite(input?.at)?Math.max(0,now()-input.at):null,controllerConnected:!!input?.connected,settings:{...settings}};};
  function controllerFrame(input){
    if(!Array.isArray(input?.values)||input.values.length!==38)return null;
    if(input.values.some(x=>!Number.isFinite(x)))return null;
    return input.values.map((v,i)=>i>=34?0:Math.round(clamp(v>127?v-256:v,-100,100)));
  }
  function setFrame(value){
    if(!value||!Array.isArray(value.resolution)||value.resolution.length!==2||!value.resolution.every(x=>Number.isFinite(x)&&x>=16&&x<=16384)||!Array.isArray(value.objects))throw Error('Invalid vision frame');
    frame={resolution:value.resolution.slice(),receivedAt:Number.isFinite(value.at)?Math.min(now(),value.at):now(),objects:value.objects.slice(0,256).filter(x=>
      Number.isFinite(x.confidence)&&x.confidence>=0&&x.confidence<=1&&Array.isArray(x.box)&&x.box.length===4&&x.box.every(Number.isFinite))};
  }
  function pickTarget(){
    if(!frame||now()-frame.receivedAt>settings.targetMaxAgeMs)return null;
    const [width,height]=frame.resolution,scale=Math.min(width,height),radius=scale*settings.fovFraction;
    let best=null;
    for(const object of frame.objects){
      if(object.confidence<settings.minConfidence)continue;
      const [x1,y1,x2,y2]=object.box;if(x2<=x1||y2<=y1)continue;
      const x=(x1+x2)/2,y=(y1+y2)/2,dx=x-width/2,dy=y-height/2,distance=Math.hypot(dx,dy);
      if(distance>radius||x<0||x>width||y<0||y>height)continue;
      if(!best||distance<best.distance)best={x,y,dx,dy,distance,scale,label:String(object.label||'character'),confidence:object.confidence};
    }
    return best;
  }
  async function release(reason){
    filtered=[0,0];detail={...detail,reason,tracking:false,rx:0,ry:0,target:null};
    if(!owns)return {released:true};owns=false;
    return getGuard().stop(reason);
  }
  async function disable(reason='Vision output disabled'){
    enabled=false;generation++;return release(reason);
  }
  async function enable(options={},approval){
    if(approval!=='ENABLE_L2_VISION_OUTPUT')throw Error('Explicit L2 vision-output enable required');
    const candidate={...defaults,...options};
    const ranges={l2Threshold:[1,100],gain:[1,200],maxCorrection:[1,100],minimumCorrection:[0,25],smoothing:[.05,1],fovFraction:[.05,.75],deadzonePixels:[0,100],targetMaxAgeMs:[50,1000],inputMaxAgeMs:[50,500],minConfidence:[.01,.99]};
    for(const [key,[min,max]]of Object.entries(ranges))if(!Number.isFinite(candidate[key])||candidate[key]<min||candidate[key]>max)throw Error('Invalid CV output setting: '+key);
    if(candidate.minimumCorrection>candidate.maxCorrection)throw Error('Minimum correction exceeds maximum');
    const connection=getConnection();if(connection.status!=='ready'||!connection.supported)throw Error('Connect a supported Zen first');
    await disable('Switching to L2 vision output');
    const result=await getGuard().stop('Switching from manual output');
    if(result.released===false||getGuard().status().uncertain)throw Error('Output release was not confirmed; reconnect');
    settings=candidate;enabled=true;generation++;detail={...detail,reason:'Ready — hold physical L2',tracking:false};return snapshot();
  }
  async function tick(){
    if(!enabled||busy)return snapshot();busy=true;const token=generation;
    try{
      const connection=getConnection();
      if(connection.status!=='ready'||!connection.supported){await disable('Zen disconnected');return snapshot();}
      const input=getInput(),values=controllerFrame(input);
      detail.l2=values?.[7]||0;
      if(!input?.connected||!values||!Number.isFinite(input.at)||now()-input.at<0||now()-input.at>settings.inputMaxAgeMs){await release('Waiting for fresh physical controller input');return snapshot();}
      if(values[7]<settings.l2Threshold){await release('L2 released — passthrough');return snapshot();}
      const guard=getGuard();
      if(!owns){await guard.start('ENABLE_MANUAL_OUTPUT',values);owns=true;}
      if(!enabled||token!==generation){await release('Output mode changed');return snapshot();}
      const target=pickTarget();
      if(target&&target.distance>settings.deadzonePixels){
        const desired=[target.dx/(target.scale/2)*settings.gain,target.dy/(target.scale/2)*settings.gain*(settings.invertY?-1:1)];
        filtered=filtered.map((previous,i)=>previous+(desired[i]-previous)*settings.smoothing);
        const magnitude=Math.hypot(...filtered);
        if(magnitude>0&&magnitude<settings.minimumCorrection)filtered=filtered.map(x=>x/magnitude*settings.minimumCorrection);
        filtered=filtered.map(x=>clamp(x,-settings.maxCorrection,settings.maxCorrection));
      }else filtered=[0,0];
      values[9]=Math.round(clamp(values[9]+filtered[0],-100,100));
      values[10]=Math.round(clamp(values[10]+filtered[1],-100,100));
      await guard.send(values,now()+150);
      detail={...detail,reason:target?(target.distance<=settings.deadzonePixels?'Target centered':'Tracking '+target.label):'L2 held — no fresh target in FOV',tracking:!!target,
        rx:values[9],ry:values[10],target:target?{label:target.label,confidence:target.confidence,x:target.x,y:target.y}:null,framesSent:detail.framesSent+1};
      return snapshot();
    }catch(error){await disable(String(error));return snapshot();}
    finally{busy=false;}
  }
  const timer=startTimer?setInterval(()=>{tick().catch(()=>{});},33):null;timer?.unref?.();
  return {snapshot,enable,disable,setFrame,tick,async dispose(){if(timer)clearInterval(timer);return disable('Vision controller disposed');}};
}
module.exports={createVisionOutputController};
