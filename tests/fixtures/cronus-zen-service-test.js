const state={status:'disconnected',firmware:'2.3.2',supported:true};
let count=0,aborted=0;
const api={beginOutputSession(){throw Error('No hardware output in stream regression test');},
  async connectAndInitialize(){state.status='ready';},async disconnect(){state.status='disconnected';},
  subscribeStreamio(callback,mask,raw,signal){count++;signal.addEventListener('abort',()=>aborted++);
    const values=Array(38).fill(0);values[7]=count*10;callback({Input:{input_values:values,connected_controller_raw:1}});},
  libraryInfo(){return {};}};
const masks={STREAMIO_MASK_INPUT(){return 1;},STREAMIO_MASK_OUTPUT(){return 2;}};
exports.api=api;exports.state=state;
exports.inputMask=()=>masks.STREAMIO_MASK_INPUT();exports.outputMask=()=>masks.STREAMIO_MASK_OUTPUT();
exports.counters=()=>({count,aborted});
exports.reset=values=>{count=0;aborted=0;Object.assign(state,{status:'disconnected',firmware:'2.3.2',supported:true},values);};
