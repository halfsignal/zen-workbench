import {packager} from '@electron/packager';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const results=await packager({dir:root,name:'Zen Workbench',platform:'win32',arch:'x64',
  out:process.env.ZEN_BUILD_OUTPUT||path.join(root,'..','zen-workbench-build-v1.2.3'),overwrite:true,icon:path.join(root,'assets','zen.ico'),
  asar:{unpack:'**/*.py'},prune:true,ignore:['^/tests','^/package-lock.json','^/build.mjs','^/validation-report.json']});
console.log(JSON.stringify({packaged:results}));
