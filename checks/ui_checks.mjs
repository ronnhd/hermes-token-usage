// All snapshot values are deliberately synthetic. SDK is a test shim, not native Hermes.
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(rootDir, 'plugin.js'), 'utf8')
assert.ok(source.includes("'__HERMES_TOKEN_USAGE_CONFIG__'"), 'portable installer config template required')
assert.ok(!source.includes('/Users/'), 'private absolute path must not ship')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let navigated, refreshes = 0
const group = {profile:'fake-profile', billing_provider:'provider/raw:fake', total:16, input_tokens:7, output_tokens:4, cache_read_tokens:3, cache_write_tokens:2, reasoning_tokens:2, api_call_count:1}
const period = total => ({start:100, total, groups:[{...group, total}], boundary_ambiguous_total:9, boundary_ambiguous_groups:[{...group,total:9}]})
const snapshot = {schema_version:1, generated_at:Date.now()/1000, installed_at:100, timezone:'UTC', periods:{day:period(16),week:period(26),month:period(36)}, anomaly_count:1, sources:{'fake-profile':{ok:true,row_count:1,providers:['provider/raw:fake']}}, limitations:['Synthetic fixture: reasoning is a subset.']}
globalThis.__usageQuery = {data:snapshot, isError:false, isFetching:false, refetch:()=>{refreshes++}}
globalThis.__usageNavigate = path => {navigated = path}
const tmp = mkdtempSync(join(rootDir, '.ui-checks-'))
let mounted
try {
  await build({stdin:{contents:source.replace("'__HERMES_TOKEN_USAGE_CONFIG__'", JSON.stringify({summaryPath:'/synthetic/summary.json',timezone:'UTC'})) + '\nexport { readSummary };',resolveDir:rootDir,sourcefile:'plugin.js'},bundle:true,format:'esm',platform:'node',external:['react','react/jsx-runtime'],outfile:join(tmp,'plugin.mjs'),plugins:[{name:'synthetic-sdk', setup(b){b.onResolve({filter:/^@hermes\/plugin-sdk$/},()=>({path:'sdk',namespace:'shim'}));b.onLoad({filter:/.*/,namespace:'shim'},()=>({contents:'export const ROUTES_AREA="routes", SIDEBAR_NAV_AREA="sidebar.nav", PALETTE_AREA="palette"; export const host={navigate:p=>globalThis.__usageNavigate(p)}; export const useQuery=o=>{globalThis.__usageQueryOptions=o; return globalThis.__usageQuery};',loader:'js'}))}}]})
  const mod = await import(pathToFileURL(join(tmp,'plugin.mjs')))
  const contributions=[]
  mod.default.register({register:c=>contributions.push(c)})
  assert.equal(contributions.length,4)
  assert.equal(mod.default.id,'token-usage')
  const chip = contributions.find(c=>c.id==='chip')
  const page = contributions.find(c=>c.id==='page')
  mounted=createRoot(document.getElementById('root'))
  await act(async()=>mounted.render(chip.render()))
  assert.match(document.body.textContent,/D\* 16 · W\* 26 · M\* 36/)
  await act(async()=>document.querySelector('button').click())
  assert.equal(navigated,'/token-usage')
  assert.equal(globalThis.__usageQueryOptions.refetchInterval,30000)
  let readPath
  window.hermesDesktop={readFileText:async path=>{readPath=path; return {text:JSON.stringify(snapshot)}}}
  assert.deepEqual(await mod.readSummary(), snapshot)
  assert.equal(readPath,'/synthetic/summary.json')
  for(const response of [{binary:true,text:'{}'},{truncated:true,text:'{}'},{error:'missing'},{text:'{bad'},{text:'{"schema_version":2}'},{text:JSON.stringify({...snapshot, periods:{}})},{text:JSON.stringify({...snapshot, timezone:'invalid/fake'})}]){
    window.hermesDesktop.readFileText=async()=>response
    await assert.rejects(mod.readSummary())
  }
  delete window.hermesDesktop
  await assert.rejects(mod.readSummary(), /bridge unavailable/)
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/fake-profile/)
  assert.match(document.body.textContent,/provider\/raw:fake/)
  assert.match(document.body.textContent,/Boundary-ambiguous: 9/)
  assert.match(document.body.textContent,/NOT complete historical/)
  await act(async()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Week (Monday)').click())
  assert.match(document.body.textContent,/26 tokens/)
  await act(async()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh').click())
  assert.equal(refreshes,1)
  snapshot.sources['fake-profile'].ok=false
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/PARTIAL/)
  assert.match(document.body.textContent,/READ FAILED/)
  snapshot.generated_at=1
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/STALE/)
  globalThis.__usageQuery={data:null,isError:true,error:new Error('synthetic missing')}
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/synthetic missing/)
  console.log('UI checks passed: portability, React/jsdom mount, navigation, periods, refresh, accounting labels, partial/stale/error, bridge rejection')
} finally {
  if(mounted) await act(async()=>mounted.unmount())
  dom.window.close()
  rmSync(tmp,{recursive:true,force:true})
}
