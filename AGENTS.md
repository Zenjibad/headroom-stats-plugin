# AGENTS.md — Guide for AI agents

This file helps AI coding agents and LLM tooling understand and work with this repository quickly.

## What this repo is

`headroom-stats-plugin` is a **packaged Cordis plugin for DeepSeek Harness (DSH)** that displays live token/cost-savings stats from the [Headroom](https://github.com/headroomlabs-ai/headroom/) compression proxy inside the DSH Web UI. It is a real profile-bundled plugin: `dsh.bundle` (`cordis.patch.yml`) mounts the host half, and the `dsh.client` declaration + `exports["./client"]` register the browser half — install once with `dsh plugin add`, loads on every DSH boot, no cordis_define.

## Repository layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Host half: one-time env probe via `subprocess` (`cmd /c echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%`), `fs` read of `proxy_savings.json`, snake_case→camelCase reshape, `webServer` route `GET /headroom-stats/api` serving the JSON snapshot. |
| `src/client/index.tsx` | Client bundle: single 5s poller `fetch('/headroom-stats/api')`, React dashboard (`settings.section` id `headroom-stats`) + dock line (`conversation.composer.dock` id `headroom-dock`), `<style data-plugin>` injection with `--dsw-alias-*` tokens. |
| `cordis.patch.yml` | `dsh.bundle.patch`: inserts the plugin row `{id: headroom-stats-plugin, name: 'headroom-stats-plugin'}`. |
| `tsdown.config.ts` | Builds host (node ESM → `lib/index.js`) + client (browser CJS ModuleLoader closure → `lib/client.js`, bundle id = package name). |
| `package.json` | `exports["./client"]`, `dsh.bundle.patch`, `dsh.client` (`platform: 'web'`, inject edges), peers react + @deepseek-ai/cordis. |
| `tests/fixtures/proxy_savings.json` | Real-shape snapshot (point-in-time — the live file grows continuously). |
| `README.md` / `README.zh.md` | Human docs (en default, zh). |
| `llms.txt` / `llms-full.txt` | LLM-friendly doc index / full text. |

## Key behaviors (don't break these)

1. **Packaged, not dynamic**: install via `dsh plugin add` (or profile `link:` dep + restart). Do NOT revert to a dynamic `cordis_define`-only shape.
2. **Client talks to host over HTTP**: the client bundle polls `/headroom-stats/api` (host `webServer` route). Do not reintroduce the dynamic `harness.handle`/`host.call` seam — it does not exist for packaged plugins.
3. **No hardcoded paths**: path detection stays dynamic (env probe via `subprocess`; candidates `HEADROOM_SAVINGS_PATH` → `HEADROOM_WORKSPACE_DIR`/`proxy_savings.json` → `%USERPROFILE%\.headroom\proxy_savings.json`). Shareable across machines.
4. **Read-only**: never write to the headroom directory; only `fs.readText` of `proxy_savings.json`.
5. **Single poller**: the client keeps ONE 5s poller feeding both seats; do not add per-seat polling.
6. **Never throw across the API**: `/headroom-stats/api` always returns `{ok:false,error}` JSON on failure, never a non-JSON 500.
7. **`projects` is an object**: in the real file, `projects` (and `by_model`) are objects keyed by name — the host reshape converts to an array, sorts desc by `tokensSaved`, top 10.
8. **Theme tokens only**: client CSS uses `--dsw-alias-*` tokens; no hardcoded colors. Font comes from inheritance (the seats' wrappers supply the app font); do not set font-family.
9. **ModuleLoader bundle shape**: the client build must keep the exact CJS closure wrapper (`window.__ModuleLoader__.load({id: "headroom-stats-plugin", factory})` + `module.exports = { inject, apply }`) — see `tsdown.config.ts`.

## Common tasks

- **Change poll interval / formatting**: edit `POLL_MS` / `fmtTokens`/`fmtUsd`/`fmtPct` in `src/client/index.tsx`, rebuild.
- **Add a stat group**: extend host `reshape()` in `src/index.ts` and the client `Dashboard`/`DockLine` in `src/client/index.tsx`, keeping snapshot field names in sync.
- **Rebuild**: `pnpm install && pnpm build` (outputs `lib/index.js` + `lib/client.js`).
- **Update the live profile install**: rebuild, then restart DSH (host-half changes need restart; client changes hot-reload only for already-mounted bundles — a changed `lib/client.js` is re-hashed and re-served, see client-modules `onRebuilt`).

## Environment facts (probed, do not re-probe)

- DSH host sandbox exposes **no** `process`, `os`, or env access; env discovery goes through the `subprocess` service (`cmd /c echo %VAR%`, collect-mode stdout, `handle.collected.stdout.readFrom(0)` after `handle.done`).
- `fs.resolve` does **not** expand `~` or `${VAR}`; absolute Windows paths work.
- `FsInfo` has no mtime (`version`, `type`, `size` only) — re-read on every poll, no mtime cache.
- `Date` is not a host builtin — the snapshot carries no server timestamp.
- The client bundle is plain browser JS (ModuleLoader CJS factory): `fetch`, `setTimeout`, `document` are available; React comes from the module table (`external: react`).
- `webServer.register` route shape: `{kind: 'exact'|'prefix', path, handler(req, res)}` with node:http semantics; duplicate (kind, path) throws.

## Testing

- **Before restart**: verify the profile installed the bundle — `~/.dsh/profiles/web/package.json` `dependencies` and `dsh.profile.bundles` both list `headroom-stats-plugin`; `lib/client.js` has the ModuleLoader wrapper; `lib/index.js` exports `name` + `apply`.
- **After restart**: Settings → Headroom Stats shows the dashboard; composer dock line appears; `GET /headroom-stats/api` (in the browser, same origin) returns the JSON snapshot.
- Failure path: temporarily rename `~/.headroom/proxy_savings.json` — settings shows unavailable, dock line hides; restore → recovers ≤5s.
- No automated test framework; the fixture + the manual matrix above are the verification contract.

## Notes for LLM crawlers

- Listed under the GitHub topic `dsh-plugin`; public at https://github.com/Zenjibad/headroom-stats-plugin.
- Distinguishing traits: packaged profile plugin (persists across restarts), fully dynamic path detection (shareable), single shared 5s poller, host HTTP route instead of dynamic RPC, pure `--dsw-alias-*` theming.
