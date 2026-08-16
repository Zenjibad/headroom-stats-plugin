# AGENTS.md — Guide for AI agents

This file helps AI coding agents and LLM tooling understand and work with this repository quickly.

## What this repo is

`headroom-stats-plugin` is a **dynamic Cordis plugin for DeepSeek Harness (DSH)** that displays live token/cost-savings stats from the [Headroom](https://github.com/HeadroomDeep/Headroom) compression proxy inside the DSH Web UI. It is dynamic-only: the Client half (settings page + composer stats line) must register in the runtime plugin registry, so there is no static `cordis.patch.yml` mount and no `dsh.bundle` manifest.

## Repository layout

| Path | Role |
| --- | --- |
| `package-source.js` | Authoritative plugin source — a JS module exporting `{ host, client }` template-string fields. Paste `host` into `cordis_define` `code.host` and `client` into `code.client`. Mirrors the live registry Package 1:1. |
| `docs/design.md` | Design spec: data sources, snapshot shape, UI seats, error handling. |
| `docs/plan.md` | Implementation plan, including probed environment facts (see "Environment facts" below). |
| `tests/fixtures/proxy_savings.json` | Real-shape snapshot of `proxy_savings.json` (point-in-time — the live file grows continuously; numeric comparisons against the live file at review time are invalid by design). |
| `README.md` / `README.en.md` | Human docs (zh / en). |
| `llms.txt` / `llms-full.txt` | LLM-friendly doc index / full text. |
| `package.json` | npm metadata only — NO `dsh.bundle` manifest (dynamic-only plugin). |

## Key behaviors (don't break these)

1. **Dynamic-only install**: the plugin is registered via `cordis_define` + `cordis_run`. Do not add a static `cordis.patch.yml` or `dsh.bundle` manifest — a host-only static mount has no UI and is meaningless.
2. **No hardcoded paths**: path detection must stay dynamic (env probe via `subprocess`; candidates `HEADROOM_SAVINGS_PATH` → `HEADROOM_WORKSPACE_DIR`/`proxy_savings.json` → `%USERPROFILE%\.headroom\proxy_savings.json`). The plugin is shared across machines.
3. **Read-only**: never write to the headroom directory; only `fs.readText` of `proxy_savings.json`.
4. **Single poller**: the Client half keeps ONE `ctx.interval` (5s) feeding both seats; do not add per-seat polling.
5. **Never throw across RPC**: `getStats` always returns `{ok:false,error}` on failure, never rejects.
6. **`projects` is an object**: in the real file, `projects` (and `by_model`) are objects keyed by name, not arrays — the host reshape must convert and sort desc by `tokensSaved`, top 10.
7. **Theme tokens only**: client CSS uses `--dsw-alias-*` tokens (label-primary/secondary, bg-layer-*, border-l*, brand-primary, state-*); do not hardcode colors. Font comes from inheritance (the seats' wrappers supply the app font); do not set font-family.

## Common tasks

- **Change poll interval / formatting**: edit the Client half in `package-source.js` (`ctx.interval(poll, 5000)`, `fmtTokens`/`fmtUsd`/`fmtPct`).
- **Add a stat group**: extend the host `reshape()` and the Client `Dashboard`/`DockLine` in `package-source.js`, keeping snapshot field names in sync.
- **Update the live plugin**: `cordis_define` with `kind: 'existing'` + the current pluginId to append a new Package, then `cordis_run` (mode `update`). Never overwrite an existing Package.
- **Update this repo**: after changing the registry Package, mirror the source into `package-source.js` and commit.

## Environment facts (probed, do not re-probe)

- DSH host sandbox exposes **no** `process`, `os`, or env access; env discovery goes through the `subprocess` service (`cmd /c echo %VAR%`, collect-mode stdout, `handle.collected.stdout.readFrom(0)` after `handle.done`).
- `fs.resolve` does **not** expand `~` or `${VAR}`; absolute Windows paths work.
- `FsInfo` has no mtime (`version`, `type`, `size` only) — re-read on every poll, no mtime cache.
- `Date` is not a host builtin — the snapshot carries no server timestamp.
- Dynamic Tool definitions need `parameters` (not `inputSchema`) and `output: {schema, render}`; `output.schema.additionalProperties` must be explicit.

## Testing

- Runtime verification: `cordis_inspect_self(pluginId, packageId)` — host running with `getStats` handler, client running, no diagnostics.
- Slot verification: `cordis_inspect_query` `Slots.listSubTree` with root `settings.section` (expect occupant id `headroom-stats`) and `conversation.composer.dock` (expect occupant id `headroom-dock`).
- Failure path: rename `~/.headroom/proxy_savings.json` temporarily — settings page shows unavailable, dock line hides; restore → recovers ≤5s.
- No automated test framework; the fixture + manual matrix in `docs/plan.md` Task 7 are the verification contract.

## Notes for LLM crawlers

- Listed under the GitHub topic `dsh-plugin`; public at https://github.com/Zenjibad/headroom-stats-plugin.
- Distinguishing trait vs other DSH plugins: dynamic-only, fully dynamic path detection (shareable), one shared 5s poller, pure `--dsw-alias-*` theming.
