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
assert.match(source, /function aggregateUsage\(/, 'derived provider/model aggregation must be implemented')
assert.ok(source.includes("'__HERMES_TOKEN_USAGE_CONFIG__'"), 'portable installer config template required')
assert.ok(!source.includes('/Users/'), 'private absolute path must not ship')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let navigated, refreshes = 0
const group = {profile:'fake-profile', billing_provider:'provider/raw:fake', total:16, input_tokens:7, output_tokens:4, cache_read_tokens:3, cache_write_tokens:2, reasoning_tokens:2, api_call_count:1}
const period = total => ({start:100, total, groups:[{...group, total}], boundary_ambiguous_total:9, boundary_ambiguous_groups:[{...group,total:9}]})
const snapshot = {schema_version:1, generated_at:Date.now()/1000, installed_at:100, timezone:'UTC', periods:{day:period(16),week:period(26),month:period(36)}, days:{}, anomaly_count:1, sources:{'fake-profile':{ok:true,row_count:1,providers:['provider/raw:fake']}}, limitations:['Synthetic fixture: reasoning is a subset.']}
const dateKey = timestamp => new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp*1000))
const shiftDate = (key, amount) => { const value=new Date(`${key}T00:00:00Z`); value.setUTCDate(value.getUTCDate()+amount); return value.toISOString().slice(0,10) }
const todayKey = dateKey(snapshot.generated_at)
snapshot.days[todayKey]=period(16)
snapshot.days[shiftDate(todayKey,-1)]=period(6)
snapshot.days[shiftDate(todayKey,-2)]=period(4)
globalThis.__usageQuery = {data:snapshot, isError:false, isFetching:false, refetch:()=>{refreshes++}}
globalThis.__usageNavigate = path => {navigated = path}
const tmp = mkdtempSync(join(rootDir, '.ui-checks-'))
let mounted
try {
  await build({stdin:{contents:source.replace("'__HERMES_TOKEN_USAGE_CONFIG__'", JSON.stringify({summaryPath:'/synthetic/summary.json',timezone:'UTC'})) + '\nexport { readSummary, aggregateUsage, selectionFor };',resolveDir:rootDir,sourcefile:'plugin.js'},bundle:true,format:'esm',platform:'node',external:['react','react/jsx-runtime'],outfile:join(tmp,'plugin.mjs'),plugins:[{name:'synthetic-sdk', setup(b){b.onResolve({filter:/^@hermes\/plugin-sdk$/},()=>({path:'sdk',namespace:'shim'}));b.onLoad({filter:/.*/,namespace:'shim'},()=>({contents:'export const ROUTES_AREA="routes", SIDEBAR_NAV_AREA="sidebar.nav", PALETTE_AREA="palette"; export const host={navigate:p=>globalThis.__usageNavigate(p)}; export const useQuery=o=>{globalThis.__usageQueryOptions=o; return globalThis.__usageQuery};',loader:'js'}))}}]})
  const mod = await import(pathToFileURL(join(tmp,'plugin.mjs')))
  const route = (profile, provider_identity, model, total, extra={}) => ({...group, profile, provider_identity, identity:profile+provider_identity+model+JSON.stringify(extra), model, total, input_tokens:total?total-4:0, output_tokens:total?2:0, cache_read_tokens:total?1:0, cache_write_tokens:total?1:0, reasoning_tokens:total?2:0, api_call_count:total?1:0, provider_label:'same-label', attribution:'explicit provider ID', ...extra})
  const rows = [route('alpha','p1','exact/model',10), route('alpha','p1','other/model',20,{task:'aux',billing_mode:'other'}),route('alpha','p2','exact/model',30),route('beta','p1','exact/model',40),route('alpha','zero','zero',0),route('alpha','legacy','',15,{legacy_unidentified:true,attribution:'legacy unidentified'}),route('alpha','unknown','known/model',5,{billing_provider:'Unknown',attribution:'unresolved'})]
  const derived = mod.aggregateUsage(rows)
  assert.equal(derived.total,120)
  assert.equal(derived.profiles.find(p=>p.profile==='alpha').providers.length,4)
  assert.equal(derived.profiles.find(p=>p.profile==='alpha').providers.find(p=>p.key==='p1').total,30)
  assert.equal(derived.models[0].model,'exact/model')
  assert.equal(derived.models[0].total,80)
  assert.equal(derived.missingModelTotal,15)
  assert.equal(derived.models.reduce((n,r)=>n+r.total,0)+derived.missingModelTotal,derived.total)
  assert.equal(mod.aggregateUsage(rows,'beta').total,40)
  assert.equal(rows.length,7, 'derivation leaves evidence intact')
  assert.equal(derived.profiles.reduce((n,p)=>n+p.providers.reduce((v,r)=>v+r.input_tokens+r.output_tokens+r.cache_read_tokens+r.cache_write_tokens,0),0),derived.total,'reasoning and calls are not additive token buckets')
  const exactIds=mod.aggregateUsage([route('alpha','p1','Exact/Model',10),route('alpha','p1','exact/model',20)])
  assert.equal(exactIds.models.length,2,'model identifiers remain case-sensitive and exact')
  const fallback=mod.aggregateUsage([route('alpha',undefined,'m1',10,{identity:'old-route-one'}),route('alpha',undefined,'m2',20,{identity:'old-route-two'})])
  assert.equal(fallback.profiles[0].providers.length,2,'older summaries fail closed rather than merge colliding labels')
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
  const legacySnapshot={...snapshot}
  delete legacySnapshot.days
  window.hermesDesktop.readFileText=async()=>({text:JSON.stringify(legacySnapshot)})
  assert.deepEqual(await mod.readSummary(), legacySnapshot)
  for(const response of [{binary:true,text:'{}'},{truncated:true,text:'{}'},{error:'missing'},{text:'{bad'},{text:'{"schema_version":2}'},{text:JSON.stringify({...snapshot, periods:{}})},{text:JSON.stringify({...snapshot, timezone:'invalid/fake'})}]){
    window.hermesDesktop.readFileText=async()=>response
    await assert.rejects(mod.readSummary())
  }
  delete window.hermesDesktop
  await assert.rejects(mod.readSummary(), /bridge unavailable/)
  snapshot.periods.day.total=12340
  snapshot.periods.week.total=2345000
  snapshot.periods.month.total=4567000
  await act(async()=>mounted.render(chip.render()))
  assert.match(document.body.textContent,/D\* 12.3K · W\* 2.35M · M\* 4.57M/)
  assert.match(document.querySelector('button').title,/12,340/)
  const more = Array.from({length:6},(_,i)=>route('beta','p-extra',`model-${i}`,9-i))
  const uiRows=[...rows,...more]
  snapshot.sources={alpha:{ok:true,row_count:6},beta:{ok:true,row_count:7}}
  snapshot.periods.day={...period(159),groups:uiRows}
  snapshot.days[todayKey]={...snapshot.periods.day}
  snapshot.days[shiftDate(todayKey,-1)]={...period(11),groups:[route('alpha','p-yesterday','yesterday/model',11)]}
  snapshot.days[shiftDate(todayKey,-2)]={...period(7),groups:[route('beta','p-two-days','two-days/model',7)]}
  const click = async label => { const el=[...document.querySelectorAll('button')].find(e=>e.textContent===label); assert.ok(el, `button ${label}`); await act(async()=>el.click()) }
  const chooseRange = async value => { const control=document.querySelector('select[aria-label="Date range"]'); control.value=value; await act(async()=>control.dispatchEvent(new dom.window.Event('change',{bubbles:true}))) }
  await act(async()=>mounted.render(page.render()))
  assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'Providers')
  assert.equal(document.querySelectorAll('[data-provider-row]').length,6)
  assert.equal(document.querySelectorAll('[data-profile]').length,2)
  assert.equal(document.querySelectorAll('[data-provider-row]')[0].textContent.includes('30'),true)
  assert.equal(document.querySelector('[data-coverage]').open,false)
  assert.equal(document.querySelectorAll('[data-provider-row] details[open]').length,0)
  assert.equal(document.querySelectorAll('[data-profile]')[0].open,true)
  await act(async()=>{document.querySelector('[data-profile]').open=false;document.querySelector('[data-profile]').dispatchEvent(new dom.window.Event('toggle'))})
  assert.equal(document.querySelector('[data-profile]').open,false)
  const providerDetail=document.querySelector('[data-provider-row] details')
  await act(async()=>{providerDetail.open=true; providerDetail.dispatchEvent(new dom.window.Event('toggle'))})
  assert.match(providerDetail.textContent,/Input \(uncached\).*Output.*Cache read.*Cache write.*Reasoning.*Calls/s)
  assert.match(providerDetail.textContent,/Raw ID/)
  assert.match(document.body.textContent,/Unattributed/)
  await click('Top models')
  assert.equal(document.querySelectorAll('[data-model-row]').length,5)
  assert.equal(document.querySelector('[data-model-row]').textContent.includes('exact/model'),true)
  assert.match(document.body.textContent,/15 tokens.*9.4%.*excluded/s)
  assert.match(document.body.textContent,/Share denominator: 159 confirmed selected tokens/)
  assert.match(document.querySelector('[data-model-row]').textContent,/50.3%/)
  const distribution=document.querySelector('[data-model-row] details')
  await act(async()=>{distribution.open=true; distribution.dispatchEvent(new dom.window.Event('toggle'))})
  assert.match(distribution.textContent,/alpha.*beta/s)
  await click('Show all')
  assert.equal(document.querySelectorAll('[data-model-row]').length,9)
  await click('Top 5')
  assert.equal(document.querySelectorAll('[data-model-row]').length,5)
  const select=document.querySelector('select[aria-label="Profile"]')
  await act(async()=>{select.value='beta';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  assert.match(document.body.textContent,/79 confirmed selected tokens/)
  await click('Providers')
  assert.equal(document.querySelectorAll('[data-profile]').length,1)
  await act(async()=>{select.value='';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  await chooseRange('this-week')
  assert.equal(document.querySelectorAll('[data-provider-row]').length,1)
  assert.match(document.body.textContent,/This week · 26 tokens/)
  await chooseRange('last-7')
  assert.match(document.body.textContent,/Last 7 days · 177 tokens/)
  await chooseRange('yesterday')
  assert.match(document.body.textContent,/Yesterday · 11 tokens/)
  await chooseRange('custom')
  assert.ok(document.querySelector('input[aria-label="From date"]'))
  assert.ok(document.querySelector('input[aria-label="To date"]'))
  const fromDate=document.querySelector('input[aria-label="From date"]')
  const toDate=document.querySelector('input[aria-label="To date"]')
  const setDateInput = (element, value) => { const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set; setter.call(element,value); element.dispatchEvent(new dom.window.Event('change',{bubbles:true})) }
  await act(async()=>setDateInput(fromDate,shiftDate(todayKey,-2)))
  await act(async()=>setDateInput(toDate,todayKey))
  const customSelection=mod.selectionFor(snapshot,'custom',shiftDate(todayKey,-2),todayKey)
  assert.equal(mod.aggregateUsage(customSelection.groups).total,177)
  await chooseRange('this-month')
  await act(async()=>{select.value='';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  assert.match(document.body.textContent,/36 confirmed selected tokens/)
  await click('Refresh')
  assert.equal(refreshes,1)
  snapshot.sources.alpha.ok=false
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/PARTIAL/)
  assert.match(document.body.textContent,/READ FAILED/)
  snapshot.generated_at=1
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/STALE/)
  globalThis.__usageQuery={data:null,isError:true,error:new Error('synthetic missing')}
  await act(async()=>mounted.render(page.render()))
  assert.match(document.body.textContent,/synthetic missing/)
  if (process.env.TOKEN_USAGE_LOCAL_SNAPSHOT) {
    // Explicit local-only opt-in. Never write a real snapshot into this repository.
    const local=JSON.parse(readFileSync(process.env.TOKEN_USAGE_LOCAL_SNAPSHOT,'utf8'))
    window.hermesDesktop={readFileText:async()=>({text:JSON.stringify(local)})}
    assert.deepEqual(await mod.readSummary(),local)
    globalThis.__usageQuery={data:local,isError:false,isFetching:false,refetch:()=>{}}
    await act(async()=>mounted.render(page.render()))
    const localTotals={}
    for (const name of ['day','week','month']) {
      const a=mod.aggregateUsage(local.periods[name].groups)
      assert.equal(a.total,local.periods[name].total)
      assert.equal(a.models.reduce((n,r)=>n+r.total,0)+a.missingModelTotal,a.total)
      localTotals[name]={total:a.total,missingModelTotal:a.missingModelTotal,providerRows:a.profiles.reduce((n,p)=>n+p.providers.length,0),models:a.models.length}
    }
    assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent,'Providers')
    await click('Top models')
    assert.ok(document.querySelectorAll('[data-model-row]').length<=5)
    console.log('Local-only real summary React mount/conservation: '+JSON.stringify(localTotals))
  }
  console.log('UI checks passed: pure aggregation/conservation, compact chip, React/jsdom Providers/Top models, profile/period filters, top5/showall, accordions/details, zero hiding, missing model denominator, bridge validation, refresh/partial/stale/error')
} finally {
  if(mounted) await act(async()=>mounted.unmount())
  dom.window.close()
  rmSync(tmp,{recursive:true,force:true})
}
