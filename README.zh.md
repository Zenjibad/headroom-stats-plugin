# headroom-stats-plugin · DSH 实时 Headroom 压节省统计面板

> 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI 内**实时展示** [Headroom](https://github.com/HeadroomDeep/Headroom) 压缩代理的压节省统计：设置页完整仪表盘 + 输入区常驻统计行。
>
> English: [README.md](README.md) · LLM 索引: [llms.txt](llms.txt) · Agent 指南: [AGENTS.md](AGENTS.md)

![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4c8dff) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-✓-0f1115) ![license](https://img.shields.io/badge/license-MIT-green) ![install](https://img.shields.io/badge/dsh%20plugin%20add-✓-22c55e)

**关键词 / Keywords**: `dsh-plugin` · `deepseek-harness-plugin` · headroom · token-savings · compression · 压缩 · 节省 · tokens · cost · 成本 · stats · 统计 · dashboard

---

## 📑 目录

- [✨ 特性](#-特性)
- [🏗️ 工作原理](#️-工作原理)
- [🚀 快速开始](#-快速开始)
- [⚙️ 配置](#️-配置)
- [❓ 常见问题](#-常见问题)
- [⚠️ 安全须知](#️-安全须知)
- [📦 项目结构](#-项目结构)
- [🙏 致谢](#-致谢)

---

## ✨ 特性

| 特性 | 说明 |
| --- | --- |
| 📊 **设置页仪表盘** | 设置 → Headroom Stats：终身 KPI（节省 tokens、压缩 $、缓存 $、请求数）、当前会话卡片、缓存 vs 压缩占比条、Top-10 项目表格、加载/错误/过期状态 |
| 🪧 **输入区常驻统计行** | 聊天输入框下方一行：`Headroom: 11.4M tokens saved · $26.23 · 11.2% this session`，随 5s 轮询实时更新 |
| 🧭 **动态路径检测** | 无硬编码路径，可跨机器分享：按 `HEADROOM_SAVINGS_PATH` → `HEADROOM_WORKSPACE_DIR` → `%USERPROFILE%\.headroom` 顺序探测 |
| ⚡ **5s 实时刷新** | 单一共享轮询器，双席位共用一份快照，不重复读文件 |
| 🌗 **主题自适应** | 全部颜色走 `--dsw-alias-*` 设计令牌，亮/暗色自动跟随 |
| ♨️ **重启常驻** | 真实 profile 打包插件：`dsh plugin add` 安装一次，每次 DSH 启动自动加载 —— 无需 cordis_define、无需每次重装 |

## 🏗️ 工作原理

```
Headroom 压缩代理 ──写入──> ~/.headroom/proxy_savings.json (持续增长)
                                   │
Host 半区（DSH 进程内）            ▼
  └─ 一次性 env 探测: cmd /c echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%
       （DSH 宿主沙箱无直接 env 访问，经 subprocess 服务取；未展开的 %VAR% 视为空）
  └─ fs 服务 stat/readText → snake_case→camelCase 重塑
  └─ webServer 路由 GET /headroom-stats/api → JSON 快照
                                   │
Client 半区（浏览器）              ▼
  └─ 单一 5s 轮询 fetch(/headroom-stats/api) → 快照分发到两个席位
       ├─ settings.section (id headroom-stats)  → 完整仪表盘
       └─ conversation.composer.dock (id headroom-dock) → 常驻统计行
```

- **纯拉取模型**：无推送、无事件、无文件监听；文件缺失/解析失败 → `{ok:false,error}`，UI 显示不可用态，轮询自动恢复。
- **只读**：插件从不写入 headroom 目录，只读 `proxy_savings.json`。
- **持久化**：随包声明 `dsh.bundle`（`cordis.patch.yml`）+ `dsh.client`（`exports["./client"]` 打包产物），作为真实 profile 插件安装，DSH client-modules 每次启动都会扫描加载。

## 🚀 快速开始

### 标准安装：`dsh plugin add`（重启常驻）

从本仓库（或发布到 npm 后）安装：

```bash
# 本地目录（在本仓库父目录执行）：
dsh plugin --profile web add ./headroom-stats-plugin

# 或直接从 GitHub（任意 DSH 机器）：
dsh plugin --profile web add git+https://github.com/Zenjibad/headroom-stats-plugin.git
```

`dsh plugin add` = 向 profile 做 pnpm add + `dsh.profile.bundles` 协调：识别到本包的 `dsh.bundle` 声明后，把 `headroom-stats-plugin` 追加进 bundle 栈。**重启 DSH**（或硬刷新页面）。启动时 client-modules 扫描器解析 `exports["./client"]`，设置页 + 统计行出现。无需 cordis_define，重启后依旧。

### 手动挂载（备选）

1. `git clone https://github.com/Zenjibad/headroom-stats-plugin.git`（任意位置）。
2. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加 `"headroom-stats-plugin": "link:<仓库路径>"`，然后在 profile 目录 `pnpm install`。
3. 重启 DSH。

> 若之前有动态安装版本在运行，先 `cordis_stop` 停掉，避免两个设置页席位重复挂载。

### 使用前提

- 本机运行着 Headroom 压缩代理（写入 `~/.headroom/proxy_savings.json`，或 `HEADROOM_SAVINGS_PATH` 指向的文件）。
- 文件不存在时：设置页显示「不可用 + 错误信息」，统计行隐藏 —— 不报错不崩溃。

## ⚙️ 配置

无配置文件、无持久化设置。路径由以下环境变量动态决定（探测一次并缓存）：

| 变量 | 作用 |
| --- | --- |
| `HEADROOM_SAVINGS_PATH` | 直接指定 `proxy_savings.json` 绝对路径（最高优先级） |
| `HEADROOM_WORKSPACE_DIR` | headroom 工作目录覆盖（拼接 `/proxy_savings.json`） |
| `%USERPROFILE%` | 兜底：`<USERPROFILE>\.headroom\proxy_savings.json` |

轮询间隔固定 5s（`src/client/index.tsx` 中的 `POLL_MS`）。

## ❓ 常见问题

**Q: 设置页显示「Headroom stats unavailable」？**
A: 找不到 `proxy_savings.json`。确认 headroom 代理在运行、文件存在；检查环境变量路径是否正确。

**Q: 输入区统计行不显示？**
A: 数据缺失时该行有意渲染为空（不产生噪音）。数据恢复后 ≤5s 自动出现。

**Q: 数字为什么和我上次看的不一样？**
A: `proxy_savings.json` 随代理压缩持续增长，统计是实时值；`tests/fixtures/` 里的样例是时间点快照，会过时属正常。

**Q: 装了新版本后出现两个仪表盘？**
A: 停掉旧的动态版本（`cordis_stop` / `cordis_undefine`）——它注册的是同一批席位。

**Q: 如何彻底移除？**
A: `dsh plugin --profile web rm headroom-stats-plugin`（或删除 profile 依赖与 bundle 条目）后重启 DSH。

## ⚠️ 安全须知

- 插件**只读** headroom 数据文件，不写任何内容，无网络请求（`subprocess` 仅用于读环境变量，一次）。
- 路径检测尊重 headroom 官方环境变量，不会猜测或扫描全盘。
- 展示的金额为 headroom 按模型单价估算的「成本避免」值，非真实账单。

## 📦 项目结构

```
headroom-stats-plugin/
├── src/
│   ├── index.ts            # host 半区：env 探测、fs 读取、重塑、/headroom-stats/api 路由
│   └── client/index.tsx    # client 包：5s 轮询、仪表盘、统计行
├── cordis.patch.yml        # dsh.bundle patch（启动时插入插件行）
├── tsdown.config.ts        # 打包 host（node ESM）+ client（CJS ModuleLoader）
├── package.json            # name、exports["./client"]、dsh.client + dsh.bundle
├── lib/                    # 构建产物（index.js、client.js）
├── tests/fixtures/         # proxy_savings.json 真实结构快照
├── AGENTS.md               # AI agent 仓库指南
├── llms.txt / llms-full.txt
├── README.md / README.zh.md
└── LICENSE
```

## 🙏 致谢

- [Headroom](https://github.com/HeadroomDeep/Headroom) — 压缩代理与 `proxy_savings.json` 数据源。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — DSH 插件/动态运行时、Slots、主题、webServer、client-modules。
- [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 打包式 client 插件构建模式的参考。

## 📄 License

[MIT](LICENSE)
