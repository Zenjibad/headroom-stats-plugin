# Headroom Stats Plugin for DSH Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dynamic Cordis plugin showing live headroom compression/cost-savings stats in DSH web — a full dashboard in Settings + a compact line under the composer.

**Architecture:** One dynamic plugin, one Package. Host half reads `~/.headroom/proxy_savings.json` via the `fs` service and exposes one private RPC method `getStats()`. Client half runs a single 5s poller feeding two Slot seats (`settings.section` page + `conversation.composer.dock` line) from one shared snapshot — no push, no events.

**Tech Stack:** Cordis dynamic plugin (plain JS host + React client), DSH `fs` + `subprocess` services, `harness.handle` RPC, `slots.inject`/`slots.register`, `timer` service, `styles.insert` CSS.

**Spec:** `docs/superpowers/specs/2026-08-16-headroom-stats-plugin-design.md`

---

## Probing Facts (already verified in-session — do NOT re-probe)

These were established by a scratch probe plugin and are ground truth:

1. **`fs` service** is available via `ctx.get('fs')` (optional service; check undefined).
2. **`~` and `${VAR}` are NOT expanded** by `fs.resolve`. Relative paths resolve against fs default cwd `C:\Users\Administrator\HeadroomDeep\headroom`.
3. **Absolute Windows path works**: `fs.resolve('C:/Users/Administrator/.headroom/proxy_savings.json')` → target; `fs.stat` → exists; `fs.readText` reads it. `fs.processPath(target)` returns `C:\Users\Administrator\.headroom\proxy_savings.json`.
4. **`FsInfo` fields are only `version`, `type`, `size`** — there is NO mtime. Do not attempt mtime caching; read + parse on every poll (file is ~1 MB, parse is a few ms).
5. **Host Builtins**: `ctx`, `harness` (handle/defineTool/registerTool), `console`, `btoa/atob`, `TextEncoder/TextDecoder`. There is **no `process`, no `os`, no env access**.
6. **Dynamic Tool definition shape** (for the probe pattern only — the real plugin does NOT need a tool): `{ name, description, parameters: {type:'object', properties:{}}, output: { schema: {…, additionalProperties: false}, render: (args, value) => [{type:'text', text: …}] }, execute }`. `parameters.additionalProperties` must be omitted. `output.schema.additionalProperties` must be explicit.
7. **Client Builtins**: `ctx`, `React` (createElement only — no JSX), `host.call(method, args)`, `styles.insert(css)`, `console`.
8. **Client `timer` service**: `inject: ['timer']` required before `ctx.interval(cb, ms)`. Disposer returned.
9. **Slot registration** pattern: `slots.inject('slot.name', () => slots.register({ name: 'slot.name', id: 'my-id', order: N, label: '…' }, (props) => ReactElement))`. `slots` via `ctx.get('slots')`, check undefined.
10. **Seats chosen** (both `replaceRisk: none`, additive):
    - `settings.section` — list, registration `{id, order, label}`. Existing occupants use order 0–100; use `order: 60`, `id: 'headroom-stats'`, `label: 'Headroom Stats'`.
    - `conversation.composer.dock` — list, scope session. Shipped occupant is `{id: 'stats', order: 0}`. Use `order: 5`, `id: 'headroom-dock'`.
11. **Real data shapes** in `proxy_savings.json` (verified from live file):
    - `lifetime`: `{ requests, tokens_saved, compression_savings_usd, cache_read_tokens, cache_savings_usd, total_input_tokens, total_input_cost_usd, output_tokens_saved, output_savings_usd }`
    - `display_session`: `{ requests, tokens_saved, compression_savings_usd, cache_read_tokens, cache_savings_usd, total_input_tokens, total_input_cost_usd, savings_percent, started_at, last_activity_at }`
    - `projects`: **OBJECT keyed by project name** → `{ requests, tokens_saved, compression_savings_usd, total_input_tokens, total_input_cost_usd, last_activity_at }` (convert to array, sort desc by tokens_saved)
    - `schema_version` at top level.
    - Live example values: lifetime requests 3110, tokens_saved 8384788, compression_savings_usd 3.798658, cache_savings_usd 18.804532; session savings_percent 11.69.
12. **Deviations from spec** (why: environment facts above): env-var path override is implemented via one-time `subprocess` env discovery (host has no direct env access — `cmd /c echo %VAR%`); path resolution is fully dynamic (no hardcoded user dirs) so the plugin is shareable; mtime cache dropped (FsInfo has no mtime); events JSONL not read; single shared client poller instead of per-seat polling (avoids double RPC + double file reads).

---

## File Structure

Dynamic plugin code lives in the Cordis package registry (via `cordis_define`), NOT in repo files. Repo files:

- Create: `docs/superpowers/plans/2026-08-16-headroom-stats-plugin.md` (this plan)
- Create: `tests/fixtures/proxy_savings.json` — trimmed real-shape fixture for reference/regression
- Create: `plugin/headroom-stats/package-source.js` — final Host+Client source saved for versioning (reference copy only; the live plugin is the registry Package)
- Create: `docs/superpowers/specs/2026-08-16-headroom-stats-plugin-design.md` (already exists — committed)

Package naming: one plugin `hstt`-prefix allocated by Host (e.g. `hstt-1`), Packages `pkg-1`, `pkg-2`, … appended per iteration. NEVER edit a defined Package; define a new one.

---

## Task 1: Fixture + Plugin scaffold

**Files:**
- Create: `tests/fixtures/proxy_savings.json`

- [ ] **Step 1: Create fixture from live file**

Copy the real file (trimmed to the shape above; keep a handful of project entries and the `by_model`/`history` keys absent or small). Use the `pwsh` tool:

```powershell
$src = "$env:USERPROFILE\.headroom\proxy_savings.json"
$j = Get-Content $src -Raw | ConvertFrom-Json
$trim = [ordered]@{
  schema_version = $j.schema_version
  lifetime = $j.lifetime
  display_session = $j.display_session
  projects = $j.projects
  by_model = $null
  history = @()
  lifetime_metrics = $null
}
$trim | ConvertTo-Json -Depth 6 | Set-Content "C:\Users\Administrator\HeadroomDeep\tests\fixtures\proxy_savings.json" -Encoding utf8
```

- [ ] **Step 2: Verify fixture**

```powershell
Get-Item "C:\Users\Administrator\HeadroomDeep\tests\fixtures\proxy_savings.json" | Select-Object Length
```
Expected: non-zero size, JSON parses: `Get-Content ... -Raw | ConvertFrom-Json | Select-Object -ExpandProperty lifetime` shows the same numbers as the live file **had at capture time** (`C:\Users\Administrator\.headroom\proxy_savings.json` grows continuously while the proxy runs, so a snapshot is stale by design minutes later — numeric equality is validated at capture time only; reviewers must not compare against the live file's later state).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/proxy_savings.json
git commit -m "test: headroom proxy_savings fixture for stats plugin"
```

Note: git needs `-c safe.directory=C:/Users/Administrator/HeadroomDeep` and a workspace-local `USERPROFILE` (see session history) because global gitconfig is sandbox-blocked:

```powershell
$env:USERPROFILE = "C:\Users\Administrator\HeadroomDeep\.gitcfg"
git -c safe.directory=C:/Users/Administrator/HeadroomDeep add tests/fixtures/proxy_savings.json
git -c safe.directory=C:/Users/Administrator/HeadroomDeep commit -m "test: headroom proxy_savings fixture for stats plugin"
```

---

## Task 2: Host half — path resolution

**Files:** none (registry Package). Verify with probe tool pattern if needed.

- [ ] **Step 1: Query `subprocess` service contract**

```js
cordis_inspect_query({ platform: 'host', provider: 'Service', method: 'listService', input: { service: 'subprocess' } })
```
Confirm `resolveExecutable(command, env?, signal?)` and `spawn(spec)` shapes and handle types (read exact `SubprocessSpawnSpec` fields: `command`, `args`, `stdio`, `cwd`, `env`).

- [ ] **Step 2: Define first Package — host half only, resolution + `getStats`**

**Dynamic path detection (plugin is shared across machines — NO hardcoded user paths).** Headroom env vars (from `headroom/headroom/paths.py`): `HEADROOM_SAVINGS_PATH` overrides the savings file directly; `HEADROOM_WORKSPACE_DIR` overrides the workspace dir (default `%USERPROFILE%\.headroom`). Host has no env access, so discover env via one-time `cmd /c` echo through the `subprocess` service, cache the result.

`cordis_define` with `plugin: { kind: 'new', idPrefix: 'hstt' }`, `name: 'headroom-stats'`, host code:

```js
return {
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    let envCache = null // { savingsPath, workspaceDir, userProfile } once discovered

    async function discoverEnv() {
      if (envCache !== null) return envCache
      envCache = {}
      try {
        const sub = ctx.get('subprocess')
        if (sub !== undefined) {
          const exe = await sub.resolveExecutable('cmd.exe')
          // One call, three lines: HEADROOM_SAVINGS_PATH, HEADROOM_WORKSPACE_DIR, USERPROFILE
          const out = await captureStdout(sub, exe, [
            '/c', 'echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%',
          ])
          const lines = out.split(/\r?\n/).map((s) => s.trim())
          envCache = {
            savingsPath: lines[0] || null,
            workspaceDir: lines[1] || null,
            userProfile: lines[2] || null,
          }
        }
      } catch (e) {
        console.log('headroom env discovery failed', String(e))
      }
      return envCache
    }

    // captureStdout: spawn with stdio ['ignore','pipe','ignore'], collect stdout
    // chunks to a string, wait for the handle to settle. Exact handle/stdout
    // shape comes from the subprocess contract queried in Step 1.

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

    harness.handle('getStats', async () => {
      const target = await resolveSavingsTarget()
      if (target === null) {
        return { ok: false, error: 'headroom savings file not found (tried ~/.headroom and fallback)' }
      }
      try {
        const text = await fs.readText(target)
        const data = JSON.parse(text)
        return { ok: true, path: fs.processPath(target), payload: data }
      } catch (e) {
        return { ok: false, error: 'unreadable savings file: ' + String(e && e.message ? e.message : e) }
      }
    })
  },
}
```

- [ ] **Step 3: Run and smoke-test via a temporary client debug**

Define a second Package appending a minimal client half that calls `getStats` once and renders raw JSON into `conversation.composer.dock` (id `headroom-dock`, order 5). `cordis_run` mode `run` (first activation). Expect approval prompt — the user must approve the Client Package in the GUI. Wait for Run card result via steering.

- [ ] **Step 4: Verify**

Dock shows either the raw payload JSON (path resolves, read works) or `{ok:false, error}`. If `subprocess` discovery fails but the fallback absolute path works, that is acceptable — the fallback exists for exactly that. Record which path resolved; adjust `ABS_FALLBACK` ordering if discovery never works (keep discovery, it is generic).

- [ ] **Step 5: Define final host Package with reshape**

Same host code plus reshape (Task 3), full client (Tasks 4–5). Do NOT commit yet — packages are registry state; the reference source file is committed in Task 6.

---

## Task 3: Host half — reshape to snapshot

**Files:** none (registry).

- [ ] **Step 1: Write reshape helpers inside host `apply()`**

Pure functions, exact field mapping (snake_case → camelCase), all fields defaulted to 0/''/[] so the client never sees NaN:

```js
function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0 }
function str(v) { return typeof v === 'string' ? v : '' }

function reshape(data) {
  const lt = data.lifetime || {}
  const ss = data.display_session || {}
  const rawProjects = data.projects || {}
  const projects = Object.keys(rawProjects)
    .map((name) => ({
      name,
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
    projects,
    split: {
      compressionUsd: num(lt.compression_savings_usd),
      cacheUsd: num(lt.cache_savings_usd),
      cacheReadTokens: num(lt.cache_read_tokens),
    },
    meta: { schemaVersion: num(data.schema_version), updatedAt: new Date().toISOString() },
  }
}
```

- [ ] **Step 2: Wire into `getStats` handler**

Handler returns `{ ok: true, path, ...reshape(data) }` (spread the reshape result — do NOT nest under `payload`).

- [ ] **Step 3: Verify against fixture**

Re-run the updated Package (`update` mode), open Settings → Headroom Stats page from Task 4 if built, or reuse the dock debug. Confirm numbers match the fixture/live values (lifetime tokens_saved ≈ 8.4M, compression ≈ $3.80, cache ≈ $18.80, session savings ≈ 11.7%).

---

## Task 4: Client — settings dashboard page

**Files:** none (registry).

- [ ] **Step 1: Query theme tokens for styling**

```js
cordis_inspect_query({ platform: 'client', provider: 'Theme', method: 'listTokens', input: {} })
```
Note the CSS variable names for text color, muted text, background/card, accent (e.g. `var(--…-text)`, `var(--…-muted)`, `var(--…-accent)`). Use `styles.insert(css)` for package CSS and prefer theme variables.

- [ ] **Step 2: Define client half — shared poller + settings page**

Client code (full):

```js
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    // Single shared poller state (module-scoped inside this apply closure)
    let snapshot = null        // { ok:true, path, lifetime, session, projects, split, meta } | { ok:false, error }
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
        const fn = () => setState(snapshot)
        listeners.add(fn)
        return () => listeners.delete(fn)
      }, [])
      return state
    }

    // ---- formatting helpers (client) ----
    function fmtTokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
      return String(n)
    }
    function fmtUsd(n) { return '$' + n.toFixed(2) }
    function fmtPct(n) { return n.toFixed(1) + '%' }

    function Kpi({ label, value }) {
      return React.createElement('div', { className: 'hr-kpi' },
        React.createElement('div', { className: 'hr-kpi-value' }, value),
        React.createElement('div', { className: 'hr-kpi-label' }, label))
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
          React.createElement('span', null, 'Headroom Stats'),
          React.createElement('span', { className: 'hr-path' }, snap.path),
          React.createElement('span', { className: 'hr-meta' }, 'updated ' + snap.meta.updatedAt)),
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
                      React.createElement('td', null, fmtUsd(p.usd)))))))
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'headroom-stats', order: 60, label: 'Headroom Stats' },
      () => React.createElement(Dashboard),
    ))
  },
}
```

- [ ] **Step 3: Add package CSS via `styles.insert`**

```js
const css = `
.hr-dash { display:flex; flex-direction:column; gap:16px; padding:8px 0; }
.hr-header { display:flex; align-items:baseline; gap:12px; }
.hr-path { font-size:12px; opacity:.6; word-break:break-all; }
.hr-meta { font-size:12px; opacity:.5; margin-left:auto; }
.hr-kpis { display:flex; gap:12px; flex-wrap:wrap; }
.hr-kpi { flex:1; min-width:120px; padding:12px; border-radius:8px; }
.hr-kpi-value { font-size:22px; font-weight:600; }
.hr-kpi-label { font-size:12px; opacity:.6; }
.hr-card { padding:12px; border-radius:8px; }
.hr-card h3 { margin:0 0 8px; font-size:14px; }
.hr-row { font-size:13px; padding:2px 0; }
.hr-muted { opacity:.55; font-size:12px; }
.hr-bar { height:8px; border-radius:4px; overflow:hidden; margin:8px 0; }
.hr-bar-comp { height:100%; }
.hr-table { width:100%; border-collapse:collapse; font-size:13px; }
.hr-table th, .hr-table td { text-align:left; padding:4px 8px; }
.hr-note { padding:16px; opacity:.7; }
.hr-error { color: var(--danger, #e5484d); }
`
styles.insert(css)
```

Colors come from theme tokens — in Step 1 replace the hard-coded `--danger` fallback and add explicit `background`/`color`/`border` for `.hr-kpi`/`.hr-card`/`.hr-bar` from the queried token names (e.g. `background: var(--x-card)`, `color: var(--x-text)`).

- [ ] **Step 4: Define Package combining host (Tasks 2–3) + this client; run**

`cordis_define` (existing mode on the plugin, or new if first). `cordis_run` mode `run` or `update` per version state. Approve the Client Package in the GUI when prompted.

- [ ] **Step 5: Verify in GUI**

Open Settings → Headroom Stats. Expect: 4 KPI cards matching live numbers, session card, split bar, top-projects table. Numbers update within ~5s while headroom proxy compresses (run any chat message that triggers compression, or wait — `proxy_savings.json` updates on its own).

---

## Task 5: Client — composer dock mini-line

**Files:** none (registry). Same Package, new Package version.

- [ ] **Step 1: Add dock registration to the SAME client half**

In the same `apply()`, after the settings registration:

```js
slots.inject('conversation.composer.dock', () => slots.register(
  { name: 'conversation.composer.dock', id: 'headroom-dock', order: 5 },
  () => {
    const snap = useSnapshot()
    if (snap === null || !snap.ok) return null // silent when missing
    const lt = snap.lifetime, ss = snap.session
    const totalUsd = lt.compressionUsd + lt.cacheUsd
    return React.createElement('div', { className: 'hr-dock' },
      'Headroom: ' + fmtTokens(lt.tokensSaved) + ' tokens saved · ' + fmtUsd(totalUsd) + ' · ' + fmtPct(ss.savingsPercent) + ' this session')
  },
))
```

CSS: `.hr-dock { font-size:12px; opacity:.65; padding:2px 0; }`

- [ ] **Step 2: Define new Package (append), run with `update`**

- [ ] **Step 3: Verify in GUI**

Line appears under the composer card, shows lifetime tokens + combined $ + session %, updates every 5s, and renders nothing when the savings file is missing.

---

## Task 6: Error states, edge cases, reference source

**Files:**
- Create: `plugin/headroom-stats/package-source.js`

- [ ] **Step 1: Harden host read**

Wrap `JSON.parse` in try/catch (already in Task 2). Add guard: if parsed JSON has no `lifetime` key, still return `ok:true` with defaulted reshape (reshape already defaults everything). Confirm `getStats` never throws across RPC — outer try/catch returns `{ok:false, error}`.

- [ ] **Step 2: Stale-data behavior**

Client poller keeps `lastGood`; on transient error render last-good snapshot with a "stale" note instead of the error state. Implement: `useSnapshot` returns `snap.ok ? snap : (lastGood ? { ...lastGood, stale: true } : snap)`; Dashboard shows `stale` badge in header when `snap.stale`.

- [ ] **Step 3: Manual failure test**

Rename `~/.headroom/proxy_savings.json` → `.bak` via pwsh, wait ≤10s: settings page shows unavailable + error; dock renders nothing. Rename back: recovers within 5s.

- [ ] **Step 4: Save reference source**

Extract the final Host and Client code strings from `cordis_inspect_self(pluginId, packageId)` and write `plugin/headroom-stats/package-source.js` as a JS module:

```js
// Reference copy of the live headroom-stats dynamic plugin (see cordis_define).
// Host half:
module.exports = { host: `…`, client: `…` }
```

- [ ] **Step 5: Commit**

```powershell
$env:USERPROFILE = "C:\Users\Administrator\HeadroomDeep\.gitcfg"
git -c safe.directory=C:/Users/Administrator/HeadroomDeep add plugin/headroom-stats/package-source.js
git -c safe.directory=C:/Users/Administrator/HeadroomDeep commit -m "feat: headroom stats plugin for dsh web"
```

---

## Task 7: Final verification + cleanup

- [ ] **Step 1: Full manual test matrix**

| Check | Expected |
|---|---|
| Settings → Headroom Stats page renders | 4 KPIs, session card, split bar, projects table |
| Dock line under composer | shows tokens + $ + session % |
| Numbers match `proxy_savings.json` live values | yes |
| Wait 10s with proxy active | numbers advance (poll works) |
| `~/.headroom/proxy_savings.json` renamed | settings shows unavailable; dock empty |
| Rename back | recovers ≤5s |
| Plugin stopped (`cordis_stop`) | both seats disappear, no stray UI |
| Plugin re-run (`cordis_run` run) | both seats return |

- [ ] **Step 2: Rollback check**

`cordis_stop` then `cordis_run` (run mode, same packageId) — everything comes back. No approval needed for re-run of an authorized package.

- [ ] **Step 3: Deliver**

Report pluginId/packageId, resolved savings path, and how to stop (`cordis_stop`) or remove (`cordis_undefine`) the plugin.

---

## Self-Review Notes

- Spec coverage: lifetime totals ✓ (Task 3/4), current session ✓ (Task 4), per-project ✓ (Task 4), cache-vs-compression split ✓ (Task 4), settings page ✓ (Task 4), dock line ✓ (Task 5), 5s poll ✓ (Task 4), error handling ✓ (Task 6). Out-of-scope items (events JSONL, per-model, prometheus) deliberately absent — matches spec.
- Deviations from spec are environment-forced and listed in Probe Facts #12.
- Type consistency: snapshot keys fixed as `lifetime/session/projects/split/meta` — same names in host reshape (Task 3) and all client reads (Tasks 4–5).
