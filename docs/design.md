# Headroom Stats Plugin for DSH Web — Design

Date: 2026-08-16
Status: Approved (brainstorming)

## Problem

User wants live headroom compression/cost-savings stats visible in the DSH web GUI. Headroom already records durable stats on disk; the plugin surfaces them without touching headroom itself.

## Data Sources

Read from disk (no network, no headroom changes). Files live in the headroom workspace dir (`~/.headroom` by default):

- `proxy_savings.json` — persistent aggregates: `lifetime`, `display_session`, `history`, `projects`, `by_model`, `lifetime_metrics`. Contains requests, tokens saved, compression savings USD, cache-read tokens, cache savings USD, total input tokens/cost.
- `savings_events.jsonl` — append-only per-compression event ledger (NOT read in v1; aggregates already exist in `proxy_savings.json`).

Path resolution, in order:
1. Env override `HEADROOM_SAVINGS_PATH` → savings JSON
2. Env override `HEADROOM_SAVINGS_EVENTS_PATH` → events JSONL (unused in v1, resolved for future)
3. Default `~/.headroom/proxy_savings.json`

## Architecture

One dynamic Cordis plugin, one Package, host + client halves. Pull model only — no push, no events, no file watching.

### Host half (DSH Node process)

- Resolve savings path per call (env may change; re-resolve each poll, cheap)
- Read + parse JSON on demand; cache last mtime + parsed snapshot; skip re-parse when mtime unchanged
- Expose Package-private RPC method `getStats()` (client→host), returning a reshaped snapshot:

```json
{
  "ok": true,
  "savingsPath": "C:\\Users\\...\\.headroom\\proxy_savings.json",
  "lifetime": {
    "requests": 3110,
    "tokensSaved": 8384788,
    "compressionUsd": 3.798658,
    "cacheUsd": 18.804532,
    "totalInputTokens": 182957062,
    "totalInputCostUsd": 23.79844
  },
  "session": {
    "requests": 175,
    "tokensSaved": 1505370,
    "savingsPercent": 11.69,
    "startedAt": "2026-08-15T23:12:58Z",
    "lastActivityAt": "2026-08-15T23:35:43Z"
  },
  "projects": [
    { "name": "repo-a", "tokensSaved": 123456, "usd": 0.55 }
  ],
  "split": { "compressionUsd": 3.798658, "cacheUsd": 18.804532, "cacheReadTokens": 78273414 },
  "meta": { "schemaVersion": 1, "updatedAt": "2026-08-16T01:35:43Z" }
}
```

- Failure shape: `{ "ok": false, "error": "headroom data not found at <resolved path>" }` — never throw across RPC
- All timers/RPC handlers registered via `ctx.on()`/`ctx.effect()` so stop/update/undefine cleans up

### Client half (browser)

- Poll `getStats()` every 5s via `host.call`; dispose timer on unmount
- Two seats (no shared state between them; both call `getStats`):
  - `settings.section` (id `headroom-stats`) — full dashboard page
  - `conversation.composer.dock` (id `headroom-dock`) — compact ambient line

## UI

### Settings page (`settings.section`)

- Header: "Headroom Stats" + resolved source path + last-updated time + manual refresh button
- KPI row — 4 cards: tokens saved (lifetime), compression $, cache $, requests
- Session card: current-session requests, tokens saved, savings %, started/last activity
- Split card: compression vs cache savings — proportional bar + $ labels
- Projects card: table name | tokens saved | $, sorted by tokens saved desc, top 10
- States: loading / empty (files missing → show resolved path + hint) / error / data

### Composer dock mini-line (`conversation.composer.dock`)

- One muted line matching shipped stats-line styling: `Headroom: 8.4M tokens saved · $22.60 · 11.7% this session`
- Same 5s poll
- Files missing → render nothing (no error noise)

## Error Handling & Edge Cases

- Missing/unreadable file → `ok:false` + resolved path in error; UI empty state; dock renders nothing
- Malformed JSON (mid-write) → retry next poll; show "unavailable", never `0`
- Poll failure → silent retry next tick; last-good data stays rendered with stale badge
- Missing/zero fields → default 0, never NaN
- Stateless headroom mode / wrong env path → same missing-file path
- Display formatting: tokens humanized (K/M), $ to 2 decimals

## Testing

- Host unit tests: reshape logic against fixture JSON (real `proxy_savings.json` shape), missing-file, malformed-JSON, empty-fields cases
- Manual: run plugin, verify dock line + settings page render; delete/rename savings file → empty state; restore → recovers; poll updates after headroom proxy compresses
- Verify in this GUI (no separate e2e infra assumed)

## Out of Scope (v1)

- `savings_events.jsonl` event history + sparkline
- Per-model breakdown (`by_model`)
- Live push via file watching (fs.watch unreliable on Windows appended files)
- Reading `ccr_store.db` (internal schema, undocumented)
- Prometheus endpoint scraping
