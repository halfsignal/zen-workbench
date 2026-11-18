const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
async function compiler(){return (await import(pathToFileURL(path.join(__dirname,'..','compiler','api.mjs')).href)).compileGpc;}
test('official compiler emits Zen32 bytecode for valid GPC',async()=>{
  const compile=await compiler(),r=await compile({source:'main { set_val(PS4_CROSS, 0); }',operation:'compile'});
  assert.equal(r.result.success,true);assert.equal(r.result.data.success,true);assert.match(r.result.data.bytecode,/^(?:[0-9a-f]{2})+$/i);assert.ok(r.result.data.bytecodeSize>2);
});
test('invalid source produces real diagnostics',async()=>{
  const compile=await compiler(),r=await compile({source:'main { totally invalid + ; }'});
  assert.ok(!r.result.success||!r.result.data?.success);assert.ok(r.result.diagnostics.some(x=>x.severity==='Error'));
});
test('formatter and semantic checker work locally',async()=>{
  const compile=await compiler();const f=await compile({source:'main{set_val(PS4_CROSS,0);}',operation:'format'});
  assert.equal(f.result.success,true);assert.match(f.result.data.output,/main \{/);
  const c=await compile({source:f.result.data.output,operation:'check'});assert.equal(c.result.success,true);
});
test('unknown operations and oversized source are rejected',async()=>{
  const compile=await compiler();await assert.rejects(compile({source:'main {}',operation:'execute'}));
  await assert.rejects(compile({source:'x'.repeat(1000001)}));
});
