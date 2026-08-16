/**
 * headroom-stats-plugin — client half (browser bundle).
 *
 * Polls the host's `/headroom-stats/api` route every 5s and renders the
 * snapshot into two DSH seats:
 *   - settings.section  (id `headroom-stats`) — full dashboard
 *   - conversation.composer.dock (id `headroom-dock`) — compact line
 *
 * This bundle ships as `exports["./client"]` (CJS ModuleLoader factory),
 * discovered via the `dsh.client` declaration in package.json.
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots']

const POLL_MS = 5000
const API = '/headroom-stats/api'

interface Snapshot {
  ok: boolean
  error?: string
  path?: string
  stale?: boolean
  lifetime?: {
    requests: number
    tokensSaved: number
    compressionUsd: number
    cacheUsd: number
    totalInputTokens: number
    totalInputCostUsd: number
  }
  session?: {
    requests: number
    tokensSaved: number
    savingsPercent: number
    startedAt: string
    lastActivityAt: string
  }
  projects?: Array<{ name: string; requests: number; tokensSaved: number; usd: number }>
  split?: { compressionUsd: number; cacheUsd: number; cacheReadTokens: number }
  meta?: { schemaVersion: number }
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
function fmtUsd(n: number): string {
  return '$' + n.toFixed(2)
}
function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as
    | {
        inject(name: string, callback: () => () => void): void
        register(
          options: { name: string; id: string; order?: number; label?: string },
          component: (props: unknown) => React.ReactNode,
        ): () => void
      }
    | undefined
  if (slots === undefined) return

  // Package stylesheet (same injection mechanism the official client bundles
  // use: one <style data-plugin> tag, removed with the plugin).
  const style = document.createElement('style')
  style.dataset.plugin = 'headroom-stats-plugin'
  style.textContent = [
    '.hr-dash{display:flex;flex-direction:column;gap:16px;padding:8px 0;color:var(--dsw-alias-label-primary)}',
    '.hr-header{display:flex;align-items:baseline;gap:12px}',
    '.hr-title{font-size:16px;font-weight:600}',
    '.hr-stale{font-size:11px;color:var(--dsw-alias-state-warn-primary)}',
    '.hr-meta{font-size:12px;opacity:.55;margin-left:auto}',
    '.hr-path{font-size:12px;opacity:.55;word-break:break-all}',
    '.hr-kpis{display:flex;gap:12px;flex-wrap:wrap}',
    '.hr-kpi{flex:1;min-width:120px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
    '.hr-kpi-value{font-size:22px;font-weight:600;color:var(--dsw-alias-brand-primary)}',
    '.hr-kpi-label{font-size:12px;opacity:.6;margin-top:4px}',
    '.hr-card{padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
    '.hr-card h3{margin:0 0 8px;font-size:14px}',
    '.hr-row{font-size:13px;padding:2px 0}',
    '.hr-muted{opacity:.55;font-size:12px}',
    '.hr-bar{height:8px;border-radius:4px;overflow:hidden;margin:8px 0;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}',
    '.hr-bar-comp{height:100%;background:var(--dsw-alias-brand-primary)}',
    '.hr-table{width:100%;border-collapse:collapse;font-size:13px}',
    '.hr-table th,.hr-table td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
    '.hr-note{padding:16px;opacity:.7}',
    '.hr-error{color:var(--dsw-alias-state-error-primary)}',
    '.hr-dock{font-size:12px;opacity:.65;padding:2px 0}',
  ].join('')
  document.head.appendChild(style)
  ctx.effect(() => () => {
    style.remove()
  })

  // ---- shared poller (module-scoped within this apply) ----
  let snapshot: Snapshot | null = null
  let lastGood: Snapshot | null = null
  const listeners = new Set<() => void>()

  async function poll(): Promise<void> {
    try {
      const res = await fetch(API, { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      snapshot = (await res.json()) as Snapshot
      if (snapshot.ok) lastGood = snapshot
    } catch (e) {
      snapshot = { ok: false, error: String((e as Error)?.message ?? e) }
    }
    for (const fn of listeners) fn()
  }
  void poll()
  const timer = setInterval(() => void poll(), POLL_MS)
  ctx.effect(() => () => {
    clearInterval(timer)
    listeners.clear()
  })

  function useSnapshot(): Snapshot | null {
    const [state, setState] = React.useState<Snapshot | null>(snapshot)
    React.useEffect(() => {
      const fn = () => {
        let out = snapshot
        if (snapshot && !snapshot.ok && lastGood !== null) {
          out = { ...lastGood, stale: true }
        }
        setState(out)
      }
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    }, [])
    return state
  }

  function Kpi(props: { label: string; value: string }): React.ReactElement {
    return React.createElement(
      'div',
      { className: 'hr-kpi' },
      React.createElement('div', { className: 'hr-kpi-value' }, props.value),
      React.createElement('div', { className: 'hr-kpi-label' }, props.label),
    )
  }

  function Dashboard(): React.ReactElement | null {
    const snap = useSnapshot()
    if (snap === null) return React.createElement('div', { className: 'hr-note' }, 'Loading headroom stats…')
    if (!snap.ok) {
      return React.createElement('div', { className: 'hr-note hr-error' }, 'Headroom stats unavailable: ' + String(snap.error))
    }
    const EMPTY_LT = { requests: 0, tokensSaved: 0, compressionUsd: 0, cacheUsd: 0, totalInputTokens: 0, totalInputCostUsd: 0 }
    const EMPTY_SS = { requests: 0, tokensSaved: 0, savingsPercent: 0, startedAt: '', lastActivityAt: '' }
    const EMPTY_SP = { compressionUsd: 0, cacheUsd: 0, cacheReadTokens: 0 }
    const lt = snap.lifetime ?? EMPTY_LT
    const ss = snap.session ?? EMPTY_SS
    const sp = snap.split ?? EMPTY_SP
    const totalUsd = sp.compressionUsd + sp.cacheUsd
    const compShare = totalUsd > 0 ? (sp.compressionUsd / totalUsd) * 100 : 0
    const h = React.createElement
    return h(
      'div',
      { className: 'hr-dash' },
      h(
        'div',
        { className: 'hr-header' },
        h('span', { className: 'hr-title' }, 'Headroom Stats'),
        snap.stale ? h('span', { className: 'hr-stale' }, 'stale') : null,
        h('span', { className: 'hr-meta' }, 'refresh 5s'),
      ),
      h('div', { className: 'hr-path' }, snap.path ?? ''),
      h(
        'div',
        { className: 'hr-kpis' },
        h(Kpi, { label: 'Tokens saved', value: fmtTokens(lt.tokensSaved ?? 0) }),
        h(Kpi, { label: 'Compression $', value: fmtUsd(sp.compressionUsd) }),
        h(Kpi, { label: 'Cache $', value: fmtUsd(sp.cacheUsd) }),
        h(Kpi, { label: 'Requests', value: String(lt.requests ?? 0) }),
      ),
      h(
        'div',
        { className: 'hr-card' },
        h('h3', null, 'Current session'),
        h('div', { className: 'hr-row' }, 'Requests: ' + String(ss.requests ?? 0)),
        h('div', { className: 'hr-row' }, 'Tokens saved: ' + fmtTokens(ss.tokensSaved ?? 0)),
        h('div', { className: 'hr-row' }, 'Savings: ' + fmtPct(ss.savingsPercent ?? 0)),
        h(
          'div',
          { className: 'hr-row hr-muted' },
          'Started ' + (ss.startedAt ?? '') + ' · last activity ' + (ss.lastActivityAt ?? ''),
        ),
      ),
      h(
        'div',
        { className: 'hr-card' },
        h('h3', null, 'Cache vs compression'),
        h(
          'div',
          { className: 'hr-bar' },
          h('div', { className: 'hr-bar-comp', style: { width: compShare + '%' } }),
        ),
        h(
          'div',
          { className: 'hr-row' },
          'Compression ' + fmtUsd(sp.compressionUsd) + ' · Cache ' + fmtUsd(sp.cacheUsd) + ' · Cache read ' + fmtTokens(sp.cacheReadTokens ?? 0),
        ),
      ),
      h(
        'div',
        { className: 'hr-card' },
        h('h3', null, 'Top projects'),
        !snap.projects || snap.projects.length === 0
          ? h('div', { className: 'hr-muted' }, 'No project data')
          : h(
              'table',
              { className: 'hr-table' },
              h(
                'thead',
                null,
                h('tr', null, h('th', null, 'Project'), h('th', null, 'Tokens saved'), h('th', null, '$')),
              ),
              h(
                'tbody',
                null,
                snap.projects.map((p) =>
                  h(
                    'tr',
                    { key: p.name },
                    h('td', null, p.name),
                    h('td', null, fmtTokens(p.tokensSaved)),
                    h('td', null, fmtUsd(p.usd)),
                  ),
                ),
              ),
            ),
      ),
    )
  }

  function DockLine(): React.ReactElement | null {
    const snap = useSnapshot()
    if (snap === null || !snap.ok) return null
    const EMPTY_LT = { requests: 0, tokensSaved: 0, compressionUsd: 0, cacheUsd: 0, totalInputTokens: 0, totalInputCostUsd: 0 }
    const EMPTY_SS = { requests: 0, tokensSaved: 0, savingsPercent: 0, startedAt: '', lastActivityAt: '' }
    const lt = snap.lifetime ?? EMPTY_LT
    const ss = snap.session ?? EMPTY_SS
    const totalUsd = (lt.compressionUsd ?? 0) + (lt.cacheUsd ?? 0)
    return React.createElement(
      'div',
      { className: 'hr-dock' },
      'Headroom: ' + fmtTokens(lt.tokensSaved ?? 0) + ' tokens saved · ' + fmtUsd(totalUsd) + ' · ' + fmtPct(ss.savingsPercent ?? 0) + ' this session',
    )
  }

  // Both seats share the same poller above.
  slots.inject('settings.section', () =>
    slots.register(
      { name: 'settings.section', id: 'headroom-stats', order: 60, label: 'Headroom Stats' },
      () => React.createElement(Dashboard),
    ),
  )
  slots.inject('conversation.composer.dock', () =>
    slots.register(
      { name: 'conversation.composer.dock', id: 'headroom-dock', order: 5 },
      () => React.createElement(DockLine),
    ),
  )
}
