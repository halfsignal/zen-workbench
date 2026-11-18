import fs from 'node:fs/promises';
import * as bindings from './bindings.mjs';
let initialized;
async function initialize(){
  const bytes=await fs.readFile(new URL('./compiler.wasm',import.meta.url));
  const {instance}=await WebAssembly.instantiate(bytes,{'./libgpc_wasm_bg.js':bindings});
  bindings.__wbg_set_wasm(instance.exports);instance.exports.__wbindgen_start();
  const result=bindings.init();if(!result.success)throw Error(JSON.stringify(result));
}
export async function compileGpc(request){
  if(!initialized)initialized=initialize().catch(error=>{initialized=null;throw error;});
  await initialized;
  if(typeof request.source!=='string'||request.source.length>1000000)throw Error('Expected GPC source up to one million characters');
  const session=new bindings.GpcSession('zen32');
  try{
    let result;
    switch(request.operation||'compile'){
      case 'compile':result=session.compile(request.source);break;
      case 'check':result=session.check(request.source,'semantic');break;
      case 'format':result=session.format(request.source);break;
      default:throw Error('Unsupported compiler operation');
    }
    return {version:bindings.version(),minimumFirmware:bindings.minimum_firmware_version(),result};
  }finally{session.free();}
}
