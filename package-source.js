// Reference copy of the live headroom-stats dynamic Cordis plugin.
// Authoritative source lives in the Cordis package registry (pluginId hstt-8,
// current package pkg-14) — this file is a versioned mirror for review/rollback.
// Feed these strings back into cordis_define code.host / code.client to recreate.
module.exports = {
  name: 'headroom-stats',
  purpose: 'Live headroom savings dashboard for DSH web — host read + settings page + composer dock line.',
  host: `return {
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    let envCache = null

    function cleanVar(v) {
      const s = String(v || '').trim()
      if (s.length === 0) return null
      if (s.startsWith('%') && s.endsWith('%')) return null
      return s
    }

    async function captureStdout(sub, argv, cwd) {
      const handle = sub.spawn({
        argv: argv,
        cwd: cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: 'ignore' },
        graceMs: 3000,
      })
      await handle.done
      const read = handle.collected.stdout.readFrom(0)
      return read.text
    }

    async function discoverEnv() {
      if (envCache !== null) return envCache
      envCache = {}
      try {
        const sub = ctx.get('subprocess')
        if (sub === undefined) {
          console.log('headroom env discovery skipped: subprocess service unavailable')
        } else {
          const exe = await sub.resolveExecutable('cmd.exe')
          const here = fs.processPath(await fs.resolve('.'))
          const out = await captureStdout(sub, [exe, '/c', 'echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%'], here)
          const lines = out.split(/\\r?\\n/).map((s) => s.trim())
          envCache = {
            savingsPath: cleanVar(lines[0]),
            workspaceDir: cleanVar(lines[1]),
            userProfile: cleanVar(lines[2]),
          }
        }
      } catch (e) {
        console.log('headroom env discovery failed', String(e && e.message ? e.message : e))
      }
      return envCache
    }

    async function resolveSavingsTarget() {
      const env = await discoverEnv()
      const candidates = []
      if (env.savingsPath) candidates.push(env.savingsPath)
      const base = env.workspaceDir || (env.userProfile ? env.userProfile + '/.headroom' : null)
      if (base) candidates.push(base + '/proxy_savings.json')
      for (const p of candidates) {
        try {
          const target = await fs.resolve(p)
          const info = await fs.stat(target)
          if (info !== undefined) return target
        } catch (e) { /* try next */ }
      }
      return null
    }

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0 }
    function str(v) { return typeof v === 'string' ? v : '' }

    function reshape(data) {
      const lt = data.lifetime || {}
      const ss = data.display_session || {}
      const rawProjects = data.projects || {}
      const projects = Object.keys(rawProjects)
        .map((name) => ({
          name: name,
          requests: num(rawProjects[name].requests),
          tokensSaved: num(rawProjects[name].tokens_saved),
          usd: num(rawProjects[name].compression_savings_usd),
        }))
        .sort((a, b) => b.tokensSaved - a.tokensSaved)
        .slice(0, 10)
      return {
        lifetime: {
          requests: num(lt.requests),
          tokensSaved: num(lt.tokens_saved),
          compressionUsd: num(lt.compression_savings_usd),
          cacheUsd: num(lt.cache_savings_usd),
          totalInputTokens: num(lt.total_input_tokens),
          totalInputCostUsd: num(lt.total_input_cost_usd),
        },
        session: {
          requests: num(ss.requests),
          tokensSaved: num(ss.tokens_saved),
          savingsPercent: num(ss.savings_percent),
          startedAt: str(ss.started_at),
          lastActivityAt: str(ss.last_activity_at),
        },
        projects: projects,
        split: {
          compressionUsd: num(lt.compression_savings_usd),
          cacheUsd: num(lt.cache_savings_usd),
          cacheReadTokens: num(lt.cache_read_tokens),
        },
        meta: { schemaVersion: num(data.schema_version) },
      }
    }

    async function getSnapshot() {
      const target = await resolveSavingsTarget()
      if (target === null) {
        return { ok: false, error: 'headroom savings file not found (checked HEADROOM_SAVINGS_PATH, workspace dir, ~/.headroom)' }
      }
      try {
        const text = await fs.readText(target)
        const data = JSON.parse(text)
        return Object.assign({ ok: true, path: fs.processPath(target) }, reshape(data))
      } catch (e) {
        return { ok: false, error: 'unreadable savings file: ' + String(e && e.message ? e.message : e) }
      }
    }

    harness.handle('getStats', async () => getSnapshot())
  },
}`,
  client: `return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    let snapshot = null
    let lastGood = null
    const listeners = new Set()

    async function poll() {
      try {
        const res = await host.call('getStats')
        snapshot = res
        if (res && res.ok) lastGood = res
      } catch (e) {
        snapshot = { ok: false, error: String(e && e.message ? e.message : e) }
      }
      for (const fn of listeners) fn()
    }
    ctx.interval(poll, 5000)
    poll()

    function useSnapshot() {
      const [state, setState] = React.useState(snapshot)
      React.useEffect(() => {
        const fn = () => {
          let out = snapshot
          if (snapshot && !snapshot.ok && lastGood !== null) {
            out = Object.assign({}, lastGood, { stale: true })
          }
          setState(out)
        }
        listeners.add(fn)
        return () => listeners.delete(fn)
      }, [])
      return state
    }

    function fmtTokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
      return String(n)
    }
    function fmtUsd(n) { return '$' + n.toFixed(2) }
    function fmtPct(n) { return n.toFixed(1) + '%' }

    function Kpi(props) {
      return React.createElement('div', { className: 'hr-kpi' },
        React.createElement('div', { className: 'hr-kpi-value' }, props.value),
        React.createElement('div', { className: 'hr-kpi-label' }, props.label))
    }

    function Dashboard() {
      const snap = useSnapshot()
      if (snap === null) return React.createElement('div', { className: 'hr-note' }, 'Loading headroom stats…')
      if (!snap.ok) return React.createElement('div', { className: 'hr-note hr-error' },
        'Headroom stats unavailable: ' + String(snap.error))
      const lt = snap.lifetime, ss = snap.session, sp = snap.split
      const totalUsd = sp.compressionUsd + sp.cacheUsd
      const compShare = totalUsd > 0 ? (sp.compressionUsd / totalUsd) * 100 : 0
      return React.createElement('div', { className: 'hr-dash' },
        React.createElement('div', { className: 'hr-header' },
          React.createElement('span', { className: 'hr-title' }, 'Headroom Stats'),
          snap.stale ? React.createElement('span', { className: 'hr-stale' }, 'stale') : null,
          React.createElement('span', { className: 'hr-meta' }, 'refresh 5s')),
        React.createElement('div', { className: 'hr-path' }, snap.path),
        React.createElement('div', { className: 'hr-kpis' },
          React.createElement(Kpi, { label: 'Tokens saved', value: fmtTokens(lt.tokensSaved) }),
          React.createElement(Kpi, { label: 'Compression $', value: fmtUsd(sp.compressionUsd) }),
          React.createElement(Kpi, { label: 'Cache $', value: fmtUsd(sp.cacheUsd) }),
          React.createElement(Kpi, { label: 'Requests', value: String(lt.requests) })),
        React.createElement('div', { className: 'hr-card' },
          React.createElement('h3', null, 'Current session'),
          React.createElement('div', { className: 'hr-row' }, 'Requests: ' + String(ss.requests)),
          React.createElement('div', { className: 'hr-row' }, 'Tokens saved: ' + fmtTokens(ss.tokensSaved)),
          React.createElement('div', { className: 'hr-row' }, 'Savings: ' + fmtPct(ss.savingsPercent)),
          React.createElement('div', { className: 'hr-row hr-muted' }, 'Started ' + ss.startedAt + ' · last activity ' + ss.lastActivityAt)),
        React.createElement('div', { className: 'hr-card' },
          React.createElement('h3', null, 'Cache vs compression'),
          React.createElement('div', { className: 'hr-bar' },
            React.createElement('div', { className: 'hr-bar-comp', style: { width: compShare + '%' } })),
          React.createElement('div', { className: 'hr-row' }, 'Compression ' + fmtUsd(sp.compressionUsd) + ' · Cache ' + fmtUsd(sp.cacheUsd) + ' · Cache read ' + fmtTokens(sp.cacheReadTokens))),
        React.createElement('div', { className: 'hr-card' },
          React.createElement('h3', null, 'Top projects'),
          snap.projects.length === 0
            ? React.createElement('div', { className: 'hr-muted' }, 'No project data')
            : React.createElement('table', { className: 'hr-table' },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    React.createElement('th', null, 'Project'),
                    React.createElement('th', null, 'Tokens saved'),
                    React.createElement('th', null, '$'))),
                React.createElement('tbody', null,
                  snap.projects.map((p) =>
                    React.createElement('tr', { key: p.name },
                      React.createElement('td', null, p.name),
                      React.createElement('td', null, fmtTokens(p.tokensSaved)),
                      React.createElement('td', null, fmtUsd(p.usd))))))))
    }

    function DockLine() {
      const snap = useSnapshot()
      if (snap === null || !snap.ok) return null
      const lt = snap.lifetime, ss = snap.session
      const totalUsd = lt.compressionUsd + lt.cacheUsd
      return React.createElement('div', { className: 'hr-dock' },
        'Headroom: ' + fmtTokens(lt.tokensSaved) + ' tokens saved · ' + fmtUsd(totalUsd) + ' · ' + fmtPct(ss.savingsPercent) + ' this session')
    }

    styles.insert(
      '.hr-dash{display:flex;flex-direction:column;gap:16px;padding:8px 0;color:var(--dsw-alias-label-primary)}' +
      '.hr-header{display:flex;align-items:baseline;gap:12px}' +
      '.hr-title{font-size:16px;font-weight:600}' +
      '.hr-stale{font-size:11px;color:var(--dsw-alias-state-warn-primary)}' +
      '.hr-meta{font-size:12px;opacity:.55;margin-left:auto}' +
      '.hr-path{font-size:12px;opacity:.55;word-break:break-all}' +
      '.hr-kpis{display:flex;gap:12px;flex-wrap:wrap}' +
      '.hr-kpi{flex:1;min-width:120px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}' +
      '.hr-kpi-value{font-size:22px;font-weight:600;color:var(--dsw-alias-brand-primary)}' +
      '.hr-kpi-label{font-size:12px;opacity:.6;margin-top:4px}' +
      '.hr-card{padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}' +
      '.hr-card h3{margin:0 0 8px;font-size:14px}' +
      '.hr-row{font-size:13px;padding:2px 0}' +
      '.hr-muted{opacity:.55;font-size:12px}' +
      '.hr-bar{height:8px;border-radius:4px;overflow:hidden;margin:8px 0;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}' +
      '.hr-bar-comp{height:100%;background:var(--dsw-alias-brand-primary)}' +
      '.hr-table{width:100%;border-collapse:collapse;font-size:13px}' +
      '.hr-table th,.hr-table td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}' +
      '.hr-note{padding:16px;opacity:.7}' +
      '.hr-error{color:var(--dsw-alias-state-error-primary)}' +
      '.hr-dock{font-size:12px;opacity:.65;padding:2px 0}'
    )

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'headroom-stats', order: 60, label: 'Headroom Stats' },
      () => React.createElement(Dashboard)))

    slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'headroom-dock', order: 5 },
      () => React.createElement(DockLine)))
  },
}`,
}
