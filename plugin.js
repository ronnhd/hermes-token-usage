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
const fmt = n => Number(n || 0).toLocaleString('en-US')
const when = (n, timezone = 'UTC') => n ? new Date(n * 1000).toLocaleString('en-GB', { timeZone: timezone }) + ' ' + timezone : 'unavailable'
const button = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 5, padding: '4px 8px', color: 'var(--ui-text-secondary)', background: 'transparent', cursor: 'pointer' }
const muted = { color: 'var(--ui-text-tertiary)', fontSize: 12 }

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
    title: `Local token ledger · ${status(d)}. D/W/M are ${d?.timezone || CONFIG.timezone || 'UTC'} calendar periods (week starts Monday). * Observed deltas since installation only; historical breakdown unavailable. Click for profile → exact billing provider breakdown.`,
    onClick: () => sdk.host.navigate(ROUTE),
    children: q.isError ? 'Tokens ⚠' : !d ? 'Tokens …' : `D* ${fmt(d.periods.day.total)} · W* ${fmt(d.periods.week.total)} · M* ${fmt(d.periods.month.total)}${status(d) === 'observed' ? '' : ' ⚠ ' + status(d)}`
  })
}
function UsageTable({ rows }) {
  return jsx('div', { style: { overflowX: 'auto' }, children: jsx('table', {
    style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
    children: [
      jsx('thead', { children: jsx('tr', { children: ['Billing provider (stored ID)', ...HEADERS].map(label => jsx('th', { style: { padding: 6, textAlign: label.startsWith('Billing') ? 'left' : 'right', borderBottom: '1px solid var(--ui-stroke-secondary)', color: 'var(--ui-text-tertiary)', whiteSpace: 'nowrap' }, children: label }, label)) }) }, 'head'),
      jsx('tbody', { children: rows.map(r => jsx('tr', { children: [
        jsx('td', { style: { padding: 6, fontFamily: 'monospace', overflowWrap: 'anywhere' }, children: r.billing_provider }, 'provider'),
        ...FIELDS.map(k => jsx('td', { style: { padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }, children: fmt(r[k]) }, k))
      ] }, r.billing_provider)) }, 'body')
    ]
  }) })
}
function Details() {
  const q = useSummary()
  const [period, setPeriod] = useState('day')
  const d = q.data
  if (!d) return jsx('div', { style: { padding: 20, color: 'var(--ui-text-secondary)' }, children: q.isError ? String(q.error?.message || q.error) : 'Loading local ledger…' })
  const p = d.periods[period]
  return jsx('section', { 'data-token-usage': 'details', style: { padding: 20, overflow: 'auto', height: '100%', color: 'var(--ui-text-secondary)', display: 'flex', flexDirection: 'column', gap: 14 }, children: [
    jsx('div', { style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }, children: [
      jsx('h2', { style: { fontSize: 18, fontWeight: 600, margin: 0 }, children: 'Token usage · this Mac' }, 'title'),
      ...['day','week','month'].map(v => jsx('button', { type: 'button', style: { ...button, color: period === v ? 'var(--ui-accent)' : 'var(--ui-text-secondary)' }, onClick: () => setPeriod(v), children: {day:'Today',week:'Week (Monday)',month:'Calendar month'}[v] }, v)),
      jsx('button', { type: 'button', style: button, disabled: q.isFetching, onClick: () => q.refetch(), title: 'Re-read the collector snapshot; collector samples independently every 30 seconds.', children: q.isFetching ? 'Refreshing…' : 'Refresh' }, 'refresh')
    ] }, 'header'),
    jsx('div', { style: muted, children: `* Observed since ${when(d.installed_at, d.timezone)}. ${fmt(p.total)} tokens in confirmed observation intervals from ${when(p.start, d.timezone)}. Snapshot: ${when(d.generated_at, d.timezone)} · ${status(d)}.` }, 'summary'),
    jsx('p', { style: { ...muted, margin: 0 }, children: 'Historical full per-call breakdown unavailable. Existing cumulative rows were baselined, never assigned wholesale by last_seen. These are NOT complete historical day/week/month totals.' }, 'history'),
    q.isError ? jsx('p', { style: muted, children: 'Refresh failed: ' + String(q.error?.message || q.error) + '. Showing last cached data.' }, 'error') : null,
    ...Object.entries(d.sources).map(([profile, source]) => {
      const rows = p.groups.filter(r => r.profile === profile)
      const map = new Map(rows.map(r => [r.billing_provider, r]))
      for (const provider of source.providers || []) if (!map.has(provider)) map.set(provider, { billing_provider: provider })
      return jsx('section', { style: { borderTop: '1px solid var(--ui-stroke-secondary)', paddingTop: 10 }, children: [
        jsx('h3', { style: { fontSize: 14, fontWeight: 600, margin: '0 0 6px' }, children: `${profile} · ${fmt(rows.reduce((n,r) => n+r.total,0))} observed tokens${source.ok ? '' : ' · READ FAILED'}` }, 'name'),
        !source.ok ? jsx('p', { style: muted, children: source.error + ' (no zero-filled replacement; prior ledger retained)' }, 'error') : null,
        jsx(UsageTable, { rows: [...map.values()].sort((a,b) => (b.total || 0)-(a.total || 0) || a.billing_provider.localeCompare(b.billing_provider)) }, 'table'),
        jsx('p', { style: muted, children: source.ok ? `${source.row_count} source rows · zero rows mean no observed increment for this period, not zero historical usage.` : 'Source unavailable.' }, 'coverage')
      ] }, profile)
    }),
    jsx('section', { children: [
      jsx('h3', { style: { fontSize: 14, fontWeight: 600 }, children: `Boundary-ambiguous: ${fmt(p.boundary_ambiguous_total)} tokens (excluded from total)` }, 'title'),
      p.boundary_ambiguous_groups.length ? jsx('div', { children: p.boundary_ambiguous_groups.map(r => jsx('p', { style: muted, children: `${r.profile} → ${r.billing_provider}: ${fmt(r.total)} tokens; input ${fmt(r.input_tokens)}, output ${fmt(r.output_tokens)}, cache read ${fmt(r.cache_read_tokens)}, cache write ${fmt(r.cache_write_tokens)}, reasoning ${fmt(r.reasoning_tokens)} (subset)` }, r.profile+':'+r.billing_provider)) }, 'ambiguous') : null,
      jsx('p', { style: muted, children: `Counter reset anomalies: ${d.anomaly_count}. Total = canonical uncached input + output + cache read + cache write. Reasoning is an output subset and is not added again.` }, 'accounting'),
      jsx('ul', { style: { ...muted, paddingLeft: 18 }, children: d.limitations.map(s => jsx('li', { children: s }, s)) }, 'limits')
    ] }, 'limitations')
  ] })
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
