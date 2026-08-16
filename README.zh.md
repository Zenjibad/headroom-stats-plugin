# headroom-stats-plugin · DSH 实时 Headroom 压节省统计面板

> 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI 内**实时展示** [Headroom](https://github.com/HeadroomDeep/Headroom) 压缩代理的压节省统计：设置页完整仪表盘 + 输入区常驻统计行。
>
> English: [README.md](README.md) · LLM 索引: [llms.txt](llms.txt) · Agent 指南: [AGENTS.md](AGENTS.md)

![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4c8dff) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-✓-0f1115) ![license](https://img.shields.io/badge/license-MIT-green) ![dynamic](https://img.shields.io/badge/install-cordis_define-22c55e)

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
| 🧹 **即插即用 / 可卸载** | 动态 Cordis 插件：`cordis_run` 启动、`cordis_stop` 停止、`cordis_undefine` 移除，无残留 |

## 🏗️ 工作原理

```
Headroom 压缩代理 ──写入──> ~/.headroom/proxy_savings.json (持续增长)
                                   │
Host 半区（DSH 进程内）            ▼
  └─ 一次性 env 探测: cmd /c echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%
       （DSH 宿主沙箱无直接 env 访问，经 subprocess 服务取；未展开的 %VAR% 视为空）
  └─ fs 服务 stat/readText 读取 → snake_case→camelCase 重塑 → harness.handle('getStats') RPC
                                   │
Client 半区（浏览器）              ▼
  └─ 单一 ctx.interval 5s 轮询 host.call('getStats') → 快照分发到两个席位
       ├─ settings.section (id headroom-stats)  → 完整仪表盘
       └─ conversation.composer.dock (id headroom-dock) → 常驻统计行
```

- **纯拉取模型**：无推送、无事件、无文件监听；文件缺失/解析失败 → `{ok:false,error}`，UI 显示不可用态，轮询自动恢复。
- **只读**：插件从不写入 headroom 目录，只读 `proxy_savings.json`。

## 🚀 快速开始

### 方式一：动态插件（推荐，完整功能，不重启 DSH）

本插件是**动态 Cordis 插件**：Client 半区（设置页 + 输入区 UI）必须在运行时注册表中注册，因此只支持动态安装（静态 `cordis.patch.yml` 挂载只能加载 Host 半区、无 UI，无意义，故不提供）。

1. 在任意 DSH 会话里对 agent 说一句话：**「安装 headroom-stats 插件」**（可附上本仓库链接）。
2. Agent 会读取 [`package-source.js`](package-source.js)，把其中的 `host` / `client` 两段代码填入 `cordis_define` 的 `code.host` / `code.client`（插件标识前缀 `hstt`），然后执行 `cordis_run`。
3. 首次运行在 GUI 批准 Client Package（一个勾）。
4. 打开 **设置 → Headroom Stats** 查看仪表盘；聊天输入框下方出现统计行。

> **你不需要知道 `code.host` / `code.client` 是什么** —— 那是 agent 侧工具 `cordis_define` 的两个代码字段，由 agent 自动从 `package-source.js` 填写。你只需要说「安装」，剩下的交给 agent。
>
> 停止：`cordis_stop` → pluginId；卸载：`cordis_undefine` → pluginId。授权一次后重启无需再次批准。

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

轮询间隔固定 5s（代码内常量），如需调整改 Client 半区 `ctx.interval(poll, 5000)`。

## ❓ 常见问题

**Q: 设置页显示「Headroom stats unavailable」？**
A: 找不到 `proxy_savings.json`。确认 headroom 代理在运行、文件存在；检查环境变量路径是否正确。

**Q: 输入区统计行不显示？**
A: 数据缺失时该行有意渲染为空（不产生噪音）。数据恢复后 ≤5s 自动出现。

**Q: 数字为什么和我上次看的不一样？**
A: `proxy_savings.json` 随代理压缩持续增长，统计是实时值；`tests/fixtures/` 里的样例是时间点快照，会过时属正常。

**Q: 如何彻底移除？**
A: `cordis_undefine` 删除插件及全部版本，两处 UI 立即消失，无残留文件。

## ⚠️ 安全须知

- 插件**只读** headroom 数据文件，不写任何内容，无网络请求（`subprocess` 仅用于读环境变量，一次）。
- 路径检测尊重 headroom 官方环境变量，不会猜测或扫描全盘。
- 展示的金额为 headroom 按模型单价估算的「成本避免」值，非真实账单。

## 📦 项目结构

```
headroom-stats-plugin/
├── package-source.js        # 动态插件权威源码（host+client 字符串，与注册表 Package 一致）
├── docs/
│   ├── design.md            # 设计规格
│   └── plan.md              # 实施计划（含已探测的环境事实）
├── tests/fixtures/
│   └── proxy_savings.json   # 真实结构快照（时间点样本，供参考/回归）
├── AGENTS.md                # AI agent 仓库指南
├── llms.txt / llms-full.txt # LLM 文档索引 / 全文
├── package.json             # npm 元数据（动态插件，无 dsh.bundle 静态挂载清单）
├── README.md / README.zh.md # 双语文档（en 默认，中文）
└── LICENSE
```

## 🙏 致谢

- [Headroom](https://github.com/HeadroomDeep/Headroom) — 压缩代理与 `proxy_savings.json` 数据源。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 动态 Cordis 插件运行时、Slots/主题/RPC 体系。

## 📄 License

[MIT](LICENSE)
