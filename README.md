# headroom-stats-plugin · Live Headroom Savings Dashboard for DeepSeek Harness (DSH)

> Show **real-time token/cost savings** from the [Headroom](https://github.com/headroomlabs-ai/headroom/) compression proxy **inside the** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI: a full dashboard in Settings plus a persistent stats line under the composer. 在 DSH 内实时展示 Headroom 压节省统计：设置页仪表盘 + 输入区常驻统计行。
>
> 中文文档: [README.zh.md](README.zh.md) · LLM index: [llms.txt](llms.txt) · Agent guide: [AGENTS.md](AGENTS.md)

![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4c8dff) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-✓-0f1115) ![license](https://img.shields.io/badge/license-MIT-green) ![install](https://img.shields.io/badge/dsh%20plugin%20add-✓-22c55e)

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
| ♨️ **Survives restarts** | Real profile-bundled plugin: install once with `dsh plugin add`, auto-loads on every DSH boot — no per-session define, no cordis_define |

## 🏗️ How it works

```
Headroom proxy ──writes──> ~/.headroom/proxy_savings.json (grows continuously)
                                 │
Host half (DSH process)          ▼
  └─ one-time env probe: cmd /c echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%
       (DSH host sandbox exposes no direct env access; fetched via subprocess)
  └─ fs service stat/readText → snake_case→camelCase reshape
  └─ webServer route GET /headroom-stats/api → JSON snapshot
                                 │
Client bundle (browser)          ▼
  └─ single 5s poller → fetch(/headroom-stats/api) → snapshot fan-out to two seats
       ├─ settings.section (id headroom-stats)       → full dashboard
       └─ conversation.composer.dock (id headroom-dock) → stats line
```

- **Pure pull model**: no push, no events, no file watching; missing/unparseable file → `{ok:false,error}`, UI shows unavailable, polling self-recovers.
- **Read-only**: the plugin never writes to the headroom directory.
- **Persistence**: ships `dsh.bundle` (`cordis.patch.yml`) + `dsh.client` (`exports["./client"]`, bundled) so it installs as a real profile plugin that the DSH client-modules scanner loads on every boot.

## 🚀 Quick start

### Standard install: `dsh plugin add` (persists across restarts)

Install the package from this GitHub repo (or from npm once published):

```bash
# local directory (from the parent of this repo):
dsh plugin --profile web add ./headroom-stats-plugin

# or directly from GitHub (any DSH machine):
dsh plugin --profile web add git+https://github.com/Zenjibad/headroom-stats-plugin.git
```

`dsh plugin add` is a pnpm add into the profile plus a `dsh.profile.bundles` reconcile: seeing this package's `dsh.bundle` declaration, it appends `headroom-stats-plugin` to the bundle stack. **Restart DSH** (or hard-refresh). On boot the client-modules scanner resolves `exports["./client"]` and the settings page + dock line appear. No per-session define, survives restarts.

### Manual profile mount (alternative)

1. `git clone https://github.com/Zenjibad/headroom-stats-plugin.git` (any location).
2. Add to `~/.dsh/profiles/web/package.json` `dependencies`: `"headroom-stats-plugin": "link:<repo-path>"`, then `pnpm install` in the profile dir.
3. Restart DSH.

> If a previous dynamic install of this plugin is running, stop it first (`cordis_stop`) to avoid double-mounting the two settings seats.

### Requirements

- Headroom proxy running on this machine (writing `~/.headroom/proxy_savings.json`, or the file `HEADROOM_SAVINGS_PATH` points at).
- Missing file → settings page shows "unavailable + error", stats line hides — no crash, no noise.

## ⚙️ Configuration

No config file, no persisted settings. The path is resolved dynamically from these env vars (probed once, cached):

| Variable | Role |
| --- | --- |
| `HEADROOM_SAVINGS_PATH` | absolute path to `proxy_savings.json` (highest priority) |
| `HEADROOM_WORKSPACE_DIR` | headroom workspace override (appended `/proxy_savings.json`) |
| `%USERPROFILE%` | fallback: `%USERPROFILE%\.headroom\proxy_savings.json` |

Poll interval: 5s constant (`POLL_MS` in `src/client/index.tsx`).

## ❓ FAQ

**Q: Settings page shows "Headroom stats unavailable"?**
A: `proxy_savings.json` not found. Confirm the headroom proxy is running and the file exists; check the env-var paths.

**Q: The composer stats line is missing?**
A: Deliberate — the line renders nothing when data is absent (no noise). It reappears ≤5s after data returns.

**Q: Why do numbers differ from what I saw before?**
A: `proxy_savings.json` grows continuously as the proxy compresses; stats are live values. The fixture in `tests/fixtures/` is a point-in-time snapshot — staleness is by design.

**Q: My old dynamic plugin is still showing two dashboards after installing this?**
A: Stop/remove the dynamic one (`cordis_stop` / `cordis_undefine`) — it re-defines the same seats.

**Q: How do I remove it?**
A: `dsh plugin --profile web rm headroom-stats-plugin` (or delete the profile dependency + bundle entry) and restart DSH.

## ⚠️ Security notes

- The plugin **only reads** the headroom data file — no writes, no network (the `subprocess` call is one-time and only echoes env vars).
- Path detection honors headroom's official env vars; it never guesses or scans the disk.
- Dollar figures are headroom's model-priced "cost avoided" estimates, not real bills.

## 📦 Project structure

```
headroom-stats-plugin/
├── src/
│   ├── index.ts            # host half: env probe, fs read, reshape, /headroom-stats/api route
│   └── client/index.tsx    # client bundle: 5s poller, dashboard, dock line
├── cordis.patch.yml        # dsh.bundle patch (inserts the plugin row on boot)
├── tsdown.config.ts        # bundles host (node ESM) + client (CJS ModuleLoader)
├── package.json            # name, exports["./client"], dsh.client + dsh.bundle
├── lib/                    # build output (index.js, client.js)
├── tests/fixtures/         # real-shape snapshot of proxy_savings.json
├── AGENTS.md               # repository guide for AI agents
├── llms.txt / llms-full.txt
├── README.md / README.zh.md
└── LICENSE
```

## 🙏 Credits

- [Headroom](https://github.com/headroomlabs-ai/headroom/) — the compression proxy and `proxy_savings.json` data source.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the DSH plugin/dynamic runtime, Slots, theme, webServer, client-modules.
- [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — reference for the packaged client-plugin build pattern.

## 📄 License

[MIT](LICENSE)
