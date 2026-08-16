# headroom-stats-plugin

Live headroom compression/cost-savings dashboard for DSH web.

## What it does

Two UI seats backed by one 5s poller:

- **Settings → Headroom Stats** — full dashboard: lifetime KPI cards (tokens saved, compression $, cache $, requests), current-session stats, cache-vs-compression split bar, top-10 projects table, stale badge, loading/error states.
- **Composer dock line** — compact ambient line under the chat input: `Headroom: 11.4M tokens saved · $26.23 · 11.2% this session`.

## How it works

One dynamic Cordis plugin (`host` + `client` halves — see `package-source.js`):

- **Host**: dynamically locates headroom's `proxy_savings.json` (no hardcoded paths — shareable across machines). One-time env discovery via `cmd /c echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%` through the `subprocess` service (the DSH host sandbox exposes no direct env access); unexpanded `%VAR%` literals are treated as null. Candidate order: `HEADROOM_SAVINGS_PATH` → `HEADROOM_WORKSPACE_DIR`/`proxy_savings.json` → `%USERPROFILE%/.headroom/proxy_savings.json`. Reads via the `fs` service, reshapes snake_case → camelCase, exposes `getStats` RPC via `harness.handle`.
- **Client**: single shared `ctx.interval` poller calls `host.call('getStats')` every 5s; two `slots.inject` registrations consume the snapshot. React via `React.createElement` only (no JSX). `styles.insert` CSS uses `--dsw-alias-*` theme tokens so it tracks light/dark themes.

## Install / run

In DSH web, define the plugin (paste `package-source.js` host/client strings into `cordis_define`) then `cordis_run` the package. Approve the Client Package in the GUI.

- Stop: `cordis_stop` → pluginId
- Remove: `cordis_undefine` → pluginId

## Key environment facts the design leans on

- `fs.resolve` does NOT expand `~` or `${VAR}`; absolute Windows paths work.
- Host has no `process`/`os`/env access — env discovery goes through the `subprocess` service.
- `FsInfo` has no mtime (`version`, `type`, `size` only) — re-read on every poll.
- `proxy_savings.json` grows continuously while the headroom proxy runs — fixtures are point-in-time snapshots by design.

## Files

- `package-source.js` — authoritative Host+Client source (mirror of the live registry package)
- `docs/design.md`, `docs/plan.md` — design spec + implementation plan
- `tests/fixtures/proxy_savings.json` — trimmed real-shape snapshot for reference

Out of scope (v1): savings event history/sparkline, per-model breakdown, prometheus scraping.
