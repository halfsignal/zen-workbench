import fs from 'node:fs/promises';
import * as bindings from './bindings.mjs';

// Use the official published compiler module locally; no device is opened.
try {
  const bytes = await fs.readFile(new URL('./compiler.wasm', import.meta.url));
  const {instance} = await WebAssembly.instantiate(bytes, {'./libgpc_wasm_bg.js': bindings});
  bindings.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
  const init = bindings.init();
  if (!init.success) throw Error(JSON.stringify(init));
  let input = '';
  for await (const part of process.stdin) input += part;
  const request = JSON.parse(input);
  if (typeof request.source !== 'string' || request.source.length > 1000000)
    throw Error('Expected GPC source, at most one million characters');
  const session = new bindings.GpcSession('zen32');
  let result;
  try {
    switch (request.operation || 'compile') {
      case 'compile': result = session.compile(request.source); break;
      case 'check': result = session.check(request.source, 'semantic'); break;
      case 'format': result = session.format(request.source); break;
      default: throw Error('Unsupported compiler operation');
    }
  } finally {session.free();}
  process.stdout.write(JSON.stringify({version: bindings.version(), minimumFirmware:
    bindings.minimum_firmware?.(), result}));
} catch(error) {
  process.stdout.write(JSON.stringify({error:String(error)}));
  process.exitCode = 1;
}
