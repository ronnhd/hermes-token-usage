// Standalone, uncompiled Hermes Desktop plugin. No gateway or provider requests.
import * as sdk from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'token-usage'
const ROUTE = '/token-usage'
// Installer replaces this JSON-string placeholder with a local configuration object.
const CONFIG = '__HERMES_TOKEN_USAGE_CONFIG__'
const SUMMARY = CONFIG.summaryPath
const FIELDS = ['total','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','api_call_count']
const HEADERS = ['Total','Input (uncached)','Output','Cache read','Cache write','Reasoning (output subset)','Calls']
const compact = n => Number(n || 0) >= 1e6 ? (Number(n)/1e6).toFixed(2).replace(/\.?0+$/, '')+'M' : Number(n || 0) >= 1e3 ? (Number(n)/1e3).toFixed(1).replace(/\.?0+$/, '')+'K' : fmt(n)
const fmt = n => Number(n || 0).toLocaleString('en-US')
const when = (n, timezone = 'UTC') => n ? new Date(n * 1000).toLocaleString('en-GB', { timeZone: timezone }) + ' ' + timezone : 'unavailable'
const button = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 5, padding: '4px 8px', color: 'var(--ui-text-secondary)', background: 'transparent', cursor: 'pointer' }
const muted = { color: 'var(--ui-text-tertiary)', fontSize: 12 }
const routeKey = r => r.identity || r.billing_provider
const routeLabel = r => r.provider_label || r.billing_provider
const routeDetails = r => `Raw ID: ${r.billing_provider} · ${r.endpoint || 'endpoint unavailable'} · route ${r.route_hint || 'unavailable'}${r.model ? ' · model ' + r.model : ''}${r.billing_mode ? ' · mode ' + r.billing_mode : ''}${r.task ? ' · task ' + r.task : ''} · ${r.attribution || 'stored provider ID'}${r.provider_candidates?.length ? ' · Candidates (not assigned): ' + r.provider_candidates.join(', ') : ''}`

// Pure display derivation. Never mutate route evidence or infer identities from labels.
function aggregateUsage(rows, profileFilter = '') {
  const profiles = new Map(), models = new Map()
  let total = 0, missingModelTotal = 0
  const add = (target, row) => { for (const field of FIELDS) target[field] = (target[field] || 0) + (row[field] || 0) }
  for (const r of rows) {
    if ((profileFilter && r.profile !== profileFilter) || !r.total) continue
    total += r.total
    const unidentified = r.legacy_unidentified || r.attribution === 'legacy unidentified' || ['Unknown','unknown',''].includes(r.billing_provider) && !['unique exact endpoint','ambiguous endpoint','unmatched endpoint'].includes(r.attribution)
    // Old summaries without provider_identity fail closed: keep each route distinct.
    const key = r.provider_identity || r.identity || JSON.stringify([r.billing_provider, r.endpoint, r.model, r.billing_mode, r.task])
    if (!profiles.has(r.profile)) profiles.set(r.profile, {profile:r.profile,total:0,providers:new Map()})
    const p = profiles.get(r.profile)
    p.total += r.total
    if (!p.providers.has(key)) p.providers.set(key, {key,label:unidentified ? 'Unattributed' : ['ambiguous endpoint','unmatched endpoint'].includes(r.attribution) ? `${r.endpoint || 'Unknown endpoint'} · ${key.slice(0,10)}` : routeLabel(r),unidentified,routes:[]})
    const provider = p.providers.get(key)
    add(provider,r); provider.routes.push(r)
    if (!r.model || r.legacy_unidentified) { missingModelTotal += r.total; continue }
    if (!models.has(r.model)) models.set(r.model, {model:r.model,routes:[]})
    const model = models.get(r.model)
    add(model,r); model.routes.push(r)
  }
  const descending = (a,b) => b.total-a.total || String(a.key || a.model || a.profile).localeCompare(String(b.key || b.model || b.profile))
  return {total,missingModelTotal,profiles:[...profiles.values()].map(p=>({...p,providers:[...p.providers.values()].sort(descending)})).sort(descending),models:[...models.values()].sort(descending)}
}

async function readSummary() {
  if (typeof CONFIG !== 'object' || typeof SUMMARY !== 'string') throw new Error('Run the installer to configure this plugin.')
  const bridge = window.hermesDesktop
  if (!bridge || typeof bridge.readFileText !== 'function') throw new Error('Local Desktop readFileText bridge unavailable. This plugin only reads this Mac; no remote gateway fallback.')
  const result = await bridge.readFileText(SUMMARY)
  if (result?.error || result?.truncated || result?.binary || typeof result?.text !== 'string') throw new Error('Local collector summary missing or unreadable; check collector installation.')
  const data = JSON.parse(result.text)
  const invalid = () => { throw new Error('Unsupported or malformed token ledger summary schema') }
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  const count = v => Number.isSafeInteger(v) && v >= 0
  if (!object(data) || data.schema_version !== 1 || !object(data.periods) || !object(data.sources) || !Number.isFinite(data.generated_at) || !count(data.anomaly_count) || !Array.isArray(data.limitations) || data.limitations.some(s => typeof s !== 'string')) invalid()
  if (typeof data.timezone !== 'string') invalid()
  try { new Intl.DateTimeFormat('en', { timeZone: data.timezone }) } catch { invalid() }
  for (const period of ['day', 'week', 'month']) {
    const p = data.periods[period]
    if (!object(p) || !Number.isFinite(p.start) || !count(p.total) || !count(p.boundary_ambiguous_total)) invalid()
    for (const rows of [p.groups, p.boundary_ambiguous_groups]) {
      if (!Array.isArray(rows)) invalid()
      for (const row of rows) if (!object(row) || typeof row.profile !== 'string' || typeof row.billing_provider !== 'string' || FIELDS.some(k => !count(row[k]))) invalid()
    }
  }
  for (const source of Object.values(data.sources)) if (!object(source) || typeof source.ok !== 'boolean' || (source.providers !== undefined && (!Array.isArray(source.providers) || source.providers.some(p => typeof p !== 'string')))) invalid()
  return data
}
function useSummary() {
  return sdk.useQuery({ queryKey: [ID, 'local-summary'], queryFn: readSummary, refetchInterval: 30_000, refetchIntervalInBackground: true, staleTime: 10_000, retry: false })
}
function status(data) {
  if (!data) return 'loading'
  if (Date.now()/1000 - data.generated_at > 95) return 'STALE'
  if (Object.values(data.sources).some(s => !s.ok)) return 'PARTIAL'
  return 'observed'
}
function Chip() {
  const q = useSummary()
  const d = q.data
  return jsx('button', {
    type: 'button', 'data-token-usage': 'chip',
    style: { ...button, border: 'none', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap', padding: '0 6px', height: '100%' },
    title: `Local token ledger · ${status(d)}. ${d ? `Today: ${fmt(d.periods.day.total)} · Week: ${fmt(d.periods.week.total)} · Month: ${fmt(d.periods.month.total)} tokens. ` : ''}D/W/M are ${d?.timezone || CONFIG.timezone || 'UTC'} calendar periods (week starts Monday). * Observed deltas since installation only; historical breakdown unavailable.`,
    onClick: () => sdk.host.navigate(ROUTE),
    children: q.isError ? 'Tokens ⚠' : !d ? 'Tokens …' : `D* ${compact(d.periods.day.total)} · W* ${compact(d.periods.week.total)} · M* ${compact(d.periods.month.total)}${status(d) === 'observed' ? '' : ' ⚠ ' + status(d)}`
  })
}
const cell = { padding: '7px 6px', textAlign: 'right', verticalAlign: 'top', borderBottom: '1px solid var(--ui-stroke-secondary)' }
const percent = (n, total) => total ? (100*n/total).toFixed(1)+'%' : '0.0%'
function Share({ total, denominator }) {
  return jsx('div', {style:{minWidth:80},children:[
    jsx('span',{children:percent(total,denominator)},'number'),
    jsx('div',{style:{height:3,marginTop:4,background:'var(--ui-stroke-secondary)'},children:jsx('div',{style:{height:'100%',width:denominator ? `${Math.min(100,100*total/denominator)}%` : '0%',background:'var(--ui-accent)'}})},'bar')
  ]})
}
function Metrics({ row }) {
  return jsx('div',{style:{...muted,display:'flex',gap:12,flexWrap:'wrap',padding:'8px 0'},children:FIELDS.slice(1).map((field,i)=>jsx('span',{children:`${HEADERS[i+1]}: ${fmt(row[field])}`},field))})
}
function Evidence({ routes }) {
  return jsx('div',{style:muted,children:routes.map((r,i)=>jsx('div',{style:{padding:'3px 0',overflowWrap:'anywhere'},children:[
    jsx('div',{children:`${r.profile} · ${fmt(r.total)} tokens · ${routeDetails(r)}`},'identity'),
    jsx(Metrics,{row:r},'counts')
  ]},r.profile+':'+routeKey(r)+':'+i))})
}
function CompactTable({ rows, denominator, models = false }) {
  const headers = models ? ['Model','Tokens','Share','Calls'] : ['Provider','Tokens','Share']
  return jsx('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12,fontVariantNumeric:'tabular-nums'},children:[
    jsx('thead',{children:jsx('tr',{children:headers.map((h,i)=>jsx('th',{style:{...cell,textAlign:i===0?'left':'right',color:'var(--ui-text-tertiary)',fontWeight:500},children:h},h))})},'head'),
    jsx('tbody',{children:rows.map(r=>jsx('tr',{'data-model-row':models?'':undefined,'data-provider-row':!models?'':undefined,children:[
      jsx('td',{style:{...cell,textAlign:'left',overflowWrap:'anywhere'},children:jsx('details',{children:[
        jsx('summary',{style:{cursor:'pointer',fontFamily:'monospace'},children:models?r.model:r.label},'label'),
        jsx(Metrics,{row:r},'metrics'),
        models ? jsx('div',{style:muted,children:aggregateUsage(r.routes).profiles.map(p=>jsx('div',{style:{padding:'4px 0'},children:[
          jsx('strong',{children:`${p.profile} · ${fmt(p.total)} tokens`},'profile'),
          ...p.providers.map(v=>jsx('div',{children:`${v.label}: ${fmt(v.total)} tokens · ${fmt(v.api_call_count)} calls · ${percent(v.total,r.total)} of model`},v.key))
        ]},p.profile))},'distribution') : null,
        jsx(Evidence,{routes:r.routes},'evidence')
      ]})},'label'),
      jsx('td',{style:{...cell,whiteSpace:'nowrap'},title:fmt(r.total),children:fmt(r.total)},'tokens'),
      jsx('td',{style:cell,children:jsx(Share,{total:r.total,denominator})},'share'),
      models ? jsx('td',{style:cell,children:fmt(r.api_call_count)},'calls'):null
    ]},r.key || r.model))},'body')
  ]})
}
function Details() {
  const q = useSummary()
  const [period,setPeriod] = useState('day')
  const [profile,setProfile] = useState('')
  const [tab,setTab] = useState('Providers')
  const [showAll,setShowAll] = useState(false)
  const d=q.data
  if (!d) return jsx('div',{style:{padding:20,color:'var(--ui-text-secondary)'},children:q.isError?String(q.error?.message || q.error):'Loading local ledger…'})
  const p=d.periods[period], usage=aggregateUsage(p.groups,profile)
  const profiles=[...new Set([...Object.keys(d.sources),...Object.values(d.periods).flatMap(v=>v.groups.map(r=>r.profile))])].sort()
  const ambiguous=p.boundary_ambiguous_groups.filter(r=>!profile || r.profile===profile)
  const boundaryTotal=ambiguous.reduce((n,r)=>n+r.total,0)
  const sources=Object.entries(d.sources).filter(([name])=>!profile || profile===name)
  return jsx('section',{'data-token-usage':'details',style:{padding:16,overflow:'auto',height:'100%',color:'var(--ui-text-secondary)',display:'flex',flexDirection:'column',gap:12},children:[
    jsx('div',{style:{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'},children:[
      jsx('h2',{style:{fontSize:16,fontWeight:600,margin:0,marginRight:'auto'},children:'Token usage · this Mac'},'title'),
      ...['day','week','month'].map(v=>jsx('button',{type:'button',style:{...button,color:period===v?'var(--ui-accent)':'var(--ui-text-secondary)'},'aria-pressed':period===v,onClick:()=>setPeriod(v),title:v==='week'?'Calendar week starts Monday':v==='month'?'Calendar month':'Calendar day',children:{day:'Today',week:'Week',month:'Month'}[v]},v)),
      jsx('select',{'aria-label':'Profile',value:profile,onChange:e=>setProfile(e.target.value),style:{...button,background:'var(--ui-bg)'},children:[jsx('option',{value:'',children:'All profiles'},'all'),...profiles.map(name=>jsx('option',{value:name,children:name},name))]},'profile'),
      jsx('button',{type:'button',style:button,disabled:q.isFetching,onClick:()=>q.refetch(),children:q.isFetching?'Refreshing…':'Refresh'},'refresh')
    ]},'header'),
    jsx('div',{role:'tablist','aria-label':'Usage views',style:{display:'flex',gap:6},children:['Providers','Top models'].map(name=>jsx('button',{type:'button',role:'tab','aria-selected':tab===name,style:{...button,color:tab===name?'var(--ui-accent)':'var(--ui-text-secondary)'},onClick:()=>setTab(name),children:name},name))},'tabs'),
    jsx('div',{style:muted,children:`Share denominator: ${fmt(usage.total)} confirmed selected tokens · ${d.timezone} · ${status(d)}`},'summary'),
    q.isError?jsx('p',{style:muted,children:'Refresh failed: '+String(q.error?.message || q.error)+'. Showing last cached data.'},'error'):null,
    tab==='Providers' ? jsx('div',{role:'tabpanel',children:usage.profiles.length?usage.profiles.map(pr=>jsx('details',{'data-profile':pr.profile,open:true,style:{borderTop:'1px solid var(--ui-stroke-secondary)',paddingTop:8,marginBottom:10},children:[
      jsx('summary',{style:{cursor:'pointer',fontWeight:600,fontSize:13},children:`${pr.profile} · ${fmt(pr.total)} tokens`},'profile'),
      jsx(CompactTable,{rows:pr.providers,denominator:usage.total},'table')
    ]},pr.profile)):jsx('p',{style:muted,children:'No confirmed usage for this selection.'})},'providers') : jsx('div',{role:'tabpanel',children:[
      jsx('div',{style:{display:'flex',alignItems:'center',gap:8,justifyContent:'space-between'},children:[
        jsx('span',{style:muted,children:`${fmt(usage.missingModelTotal)} tokens (${percent(usage.missingModelTotal,usage.total)}) legacy/missing model excluded from ranking; still included in share denominator.`},'missing'),
        jsx('button',{type:'button',style:button,'aria-pressed':showAll,onClick:()=>setShowAll(!showAll),children:showAll?'Top 5':'Show all'},'toggle')
      ]},'ranking'),
      usage.models.length?jsx(CompactTable,{rows:showAll?usage.models:usage.models.slice(0,5),denominator:usage.total,models:true},'table'):jsx('p',{style:muted,children:'No confirmed usage with an identified model.'},'empty')
    ]},'models'),
    jsx('details',{'data-coverage':'',style:muted,children:[
      jsx('summary',{style:{cursor:'pointer'},children:`Coverage & history · observed only · ${fmt(boundaryTotal)} boundary-excluded tokens · ${status(d)}${sources.some(([,s])=>!s.ok || s.config_ok===false)?' · source warnings':''}`},'summary'),
      jsx('p',{children:`Observed since ${when(d.installed_at,d.timezone)}. Selected period starts ${when(p.start,d.timezone)}. Snapshot ${when(d.generated_at,d.timezone)}. NOT complete historical day/week/month totals: pre-existing cumulative usage was baselined, never inferred by last_seen.`},'history'),
      jsx('p',{children:`Boundary-ambiguous: ${fmt(boundaryTotal)} tokens excluded from confirmed total. Canonical total = uncached input + output + cache read + cache write. Reasoning is an output subset, not additive. Counter reset anomalies: ${fmt(d.anomaly_count)}.`},'accounting'),
      ...sources.map(([name,s])=>jsx('p',{children:`${name}: ${s.ok?`${fmt(s.row_count)} source rows`:'READ FAILED · '+(s.error || 'source unavailable')+'; prior ledger retained'}${s.config_ok===false?' · '+s.config_status:''}. Zero usage rows hidden, not discarded.`},name)),
      jsx(Evidence,{routes:ambiguous},'boundary'),
      jsx('ul',{style:{paddingLeft:18},children:d.limitations.map((s,i)=>jsx('li',{children:s},i))},'limits')
    ]},'coverage')
  ]})
}
export default {
  id: ID, name: 'Token Usage Ledger', defaultEnabled: true,
  description: 'Local observed day/week/month token deltas, profile → exact billing provider, cache and reasoning breakdown. No historical estimates.',
  register(ctx) {
    ctx.register({ id: 'chip', area: 'statusBar.right', order: 205, render: () => jsx(Chip, {}) })
    ctx.register({ id: 'page', area: sdk.ROUTES_AREA || 'routes', data: { path: ROUTE }, render: () => jsx(Details, {}) })
    ctx.register({ id: 'nav', area: sdk.SIDEBAR_NAV_AREA || 'sidebar.nav', data: { path: ROUTE, label: 'Token Usage', codicon: 'graph' } })
    ctx.register({ id: 'open', area: sdk.PALETTE_AREA || 'palette', data: { id: ID+'.open', label: 'Token Usage: local ledger', keywords: ['tokens','usage','billing','cache'], run: () => sdk.host.navigate(ROUTE) } })
  }
}
