# headroom-stats-plugin · Live Headroom Savings Dashboard for DeepSeek Harness (DSH)

> Show **real-time token/cost savings** from the [Headroom](https://github.com/HeadroomDeep/Headroom) compression proxy **inside the** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI: a full dashboard in Settings plus a persistent stats line under the composer.
>
> 中文文档: [README.md](README.md) · LLM index: [llms.txt](llms.txt) · Agent guide: [AGENTS.md](AGENTS.md)

![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4c8dff) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-✓-0f1115) ![license](https://img.shields.io/badge/license-MIT-green) ![dynamic](https://img.shields.io/badge/install-cordis_define-22c55e)

**Keywords**: `dsh-plugin` · `deepseek-harness-plugin` · headroom · token-savings · compression · tokens · cost · stats · dashboard

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [🏗️ How it works](#️-how-it-works)
- [🚀 Quick start](#-quick-start)
- [⚙️ Configuration](#️-configuration)
- [❓ FAQ](#-faq)
- [⚠️ Security notes](#️-security-notes)
- [📦 Project structure](#-project-structure)
- [🙏 Credits](#-credits)

---

## ✨ Features

| Feature | Description |
| --- | --- |
| 📊 **Settings dashboard** | Settings → Headroom Stats: lifetime KPIs (tokens saved, compression $, cache $, requests), current-session card, cache-vs-compression split bar, top-10 projects table, loading/error/stale states |
| 🪧 **Composer stats line** | One line under the chat input: `Headroom: 11.4M tokens saved · $26.23 · 11.2% this session`, refreshed every 5s |
| 🧭 **Dynamic path detection** | No hardcoded paths — shareable across machines: probes `HEADROOM_SAVINGS_PATH` → `HEADROOM_WORKSPACE_DIR` → `%USERPROFILE%\.headroom` |
| ⚡ **5s live refresh** | One shared poller feeds both seats from a single snapshot — no duplicate file reads |
| 🌗 **Theme-aware** | All colors use `--dsw-alias-*` design tokens; follows light/dark automatically |
| 🧹 **Plug & play / removable** | Dynamic Cordis plugin: `cordis_run` to start, `cordis_stop` to pause, `cordis_undefine` to remove — no residue |

## 🏗️ How it works

```
Headroom proxy ──writes──> ~/.headroom/proxy_savings.json (grows continuously)
                                 │
Host half (inside DSH process)   ▼
  └─ one-time env probe: cmd /c echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%
       (DSH host sandbox exposes no direct env access; fetched via the subprocess service;
        unexpanded %VAR% literals treated as null)
  └─ fs service stat/readText → snake_case→camelCase reshape → harness.handle('getStats') RPC
                                 │
Client half (browser)            ▼
  └─ single ctx.interval 5s poll → host.call('getStats') → snapshot fan-out to two seats
       ├─ settings.section (id headroom-stats)       → full dashboard
       └─ conversation.composer.dock (id headroom-dock) → stats line
```

- **Pure pull model**: no push, no events, no file watching; missing/unparseable file → `{ok:false,error}`, UI shows unavailable, polling self-recovers.
- **Read-only**: the plugin never writes to the headroom directory.

## 🚀 Quick start

### Option: dynamic plugin (recommended — full features, no DSH restart)

This plugin is a **dynamic Cordis plugin**: the Client half (settings page + composer line UI) must register in the runtime registry, so dynamic install is the only meaningful path (a static `cordis.patch.yml` mount could load only the Host half with no UI — pointless, so it is not provided).

1. In any DSH session, tell the agent one sentence: **"install the headroom-stats plugin"** (link this repo if you like).
2. The agent reads [`package-source.js`](package-source.js), fills the `host` / `client` chunks into `cordis_define`'s `code.host` / `code.client` (plugin id prefix `hstt`), then runs `cordis_run`.
3. On first run, approve the Client Package in the GUI (one check mark).
4. Open **Settings → Headroom Stats** for the dashboard; the stats line appears under the chat input.

> **You never need to know what `code.host` / `code.client` are** — those are the two code fields of the agent-side `cordis_define` tool; the agent fills them automatically from `package-source.js`. You just say "install"; the agent does the rest.
>
> Stop: `cordis_stop` → pluginId. Remove: `cordis_undefine` → pluginId. Once authorized, re-runs need no further approval.

### Prerequisites

- A Headroom compression proxy running on this machine (writing `~/.headroom/proxy_savings.json`, or the file `HEADROOM_SAVINGS_PATH` points at).
- Missing file → settings page shows "unavailable + error", stats line hides — no crash, no noise.

## ⚙️ Configuration

No config file, no persisted settings. The path is resolved dynamically from these env vars (probed once, cached):

| Variable | Role |
| --- | --- |
| `HEADROOM_SAVINGS_PATH` | Absolute path to `proxy_savings.json` (highest priority) |
| `HEADROOM_WORKSPACE_DIR` | headroom workspace override (appended with `/proxy_savings.json`) |
| `%USERPROFILE%` | Fallback: `<USERPROFILE>\.headroom\proxy_savings.json` |

Poll interval is fixed at 5s (constant in code); change `ctx.interval(poll, 5000)` in the Client half to adjust.

## ❓ FAQ

**Q: Settings page shows "Headroom stats unavailable"?**
A: `proxy_savings.json` not found. Confirm the headroom proxy is running and the file exists; check the env-var paths.

**Q: The composer stats line is missing?**
A: Deliberate — the line renders nothing when data is absent (no noise). It reappears ≤5s after data returns.

**Q: Why do numbers differ from what I saw before?**
A: `proxy_savings.json` grows continuously as the proxy compresses; stats are live values. The fixture in `tests/fixtures/` is a point-in-time snapshot — staleness is by design.

**Q: How do I remove it completely?**
A: `cordis_undefine` deletes the plugin and all versions; both UI seats disappear immediately, no leftover files.

## ⚠️ Security notes

- The plugin **only reads** the headroom data file — no writes, no network (the `subprocess` call is one-time and only echoes env vars).
- Path detection honors headroom's official env vars; it never guesses or scans the disk.
- Dollar figures are headroom's model-priced "cost avoided" estimates, not real bills.

## 📦 Project structure

```
headroom-stats-plugin/
├── package-source.js        # authoritative dynamic-plugin source (host+client strings, mirrors the registry Package)
├── docs/
│   ├── design.md            # design spec
│   └── plan.md              # implementation plan (includes probed environment facts)
├── tests/fixtures/
│   └── proxy_savings.json   # real-shape snapshot (point-in-time sample, reference/regression)
├── AGENTS.md                # repository guide for AI agents
├── llms.txt / llms-full.txt # LLM doc index / full text
├── package.json             # npm metadata (dynamic plugin — no dsh.bundle static-mount manifest)
├── README.md / README.en.md # bilingual docs
└── LICENSE
```

## 🙏 Credits

- [Headroom](https://github.com/HeadroomDeep/Headroom) — the compression proxy and `proxy_savings.json` data source.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the dynamic Cordis plugin runtime, Slots/theme/RPC system.

## 📄 License

[MIT](LICENSE)
