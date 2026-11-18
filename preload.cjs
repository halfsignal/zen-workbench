const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['status','connect','disconnect','arm','frame','stop','slots','backup','run','unload',
  'compile','openScript','saveScript','saveBinary','openModel','openVideo','visionStart','visionStop',
  'trainingStatus','openTrainingFolder','studioShow','getPreferences','setPreferences','visionEnable','visionDisable']);
contextBridge.exposeInMainWorld('zen',{
  invoke(operation,payload){if(!allowed.has(operation))return Promise.reject(Error('Unsupported operation'));return ipcRenderer.invoke('zen:command',operation,payload);},
  onVision(callback){const handler=(_,value)=>callback(value);ipcRenderer.on('zen:vision',handler);return()=>ipcRenderer.removeListener('zen:vision',handler);},
  onLog(callback){const handler=(_,value)=>callback(value);ipcRenderer.on('zen:log',handler);return()=>ipcRenderer.removeListener('zen:log',handler);}
});
