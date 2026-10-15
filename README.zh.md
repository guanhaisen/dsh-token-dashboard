# dsh-token-dashboard

[English](README.md) | 中文

搞清楚 token 到底花在哪了。这个插件从挂载那一刻起记录 DeepSeek Harness 里的**每一次模型调用**，
按天、模型、用途、项目聚合用量，并把看板放在一次点击之外 —— 就在侧栏底部、你的账号行正上方。

```
侧栏底部                        看板面板
┌──────────────────────┐        ┌──────────────────────────────────────┐
│  📊 Token 用量  12.3K │  ───▶  │  8 张 KPI 卡                          │
├──────────────────────┤        │  每日堆叠柱状图                        │
│  G  Greye            │        │  按模型 / 项目 / 用途三张表            │
└──────────────────────┘        │  最近调用明细                          │
                                └──────────────────────────────────────┘
```

> **第三方、非侵入式插件。** 它从你的 DSH profile 挂载，绝不改动 `app.asar`，
> 也不会动任何随应用发布的组件。

- [安装](#安装) —— 一条命令，或在插件页操作
- [它记什么](#它记什么) —— 以及背后的口径选择
- [怎么读这些数字](#怎么读这些数字)
- [数据文件](#数据文件)
- [配置](#配置)
- [已知限制](#已知限制) —— 提 issue 前请先看
- [开发](#开发)

## 安装

本插件是第三方 **bundle**：从你的 DSH profile 加载，而不是从 `app.asar`。
安装过程不动应用本身的任何文件，所以卸载是干净的，应用升级也不会覆盖它。

### 方式 A —— 一条命令（CLI）

```bash
dsh plugin --profile desktop add github:guanhaisen/dsh-token-dashboard
```

**先把 DeepSeek Harness 完全退出。** CLI 拒绝改动正在运行的应用所持有的 profile；
方式 B 和 C 则可以在运行中操作。

### 方式 B —— 插件页（不用终端）

1. 打开侧栏的 **插件** 入口。
2. 选择安装，粘贴同样的 spec：`github:guanhaisen/dsh-token-dashboard`。
3. 看 pnpm 的输出，然后确认。

### 方式 C —— 让 agent 装

直接让模型把 `github:guanhaisen/dsh-token-dashboard` 装到 `desktop` profile，
它会用 `plugin_manager` 工具。每次工具调用需要 `danger-full-access` 或一次批准。

### 锁定版本（打 tag 后推荐）

上面的 spec 跟随默认分支。想固定在某个发布版：

```bash
dsh plugin --profile desktop add 'github:guanhaisen/dsh-token-dashboard#v0.1.0'
```

### 安装器替你做的事

以下都不需要你手写：

- 把依赖加进 `<dsh-home>/profiles/desktop/package.json`；
- **自动把 bundle 追加到 `dsh.profile.bundles`** —— 一个声明了 `dsh.bundle` 的新装包
  会被对账进这个列表，而它才是真正让它挂载的东西；
- 调用自带的 pnpm（不需要你另外装）；
- 因为 Desktop 组合启用了 HMR，改动**实时生效**，不用重启。

之后刷新页面。客户端 bundle 的 revision 由 `client.js` 的 mtime 和大小派生，刷新即拿到新版本。

如果入口没出现，说明 bundle 没被选中：把 `"dsh-token-dashboard"` 加进
`<dsh-home>/profiles/desktop/package.json` 的 `dsh.profile.bundles`，然后重启。

### 确认它在跑

让 agent 执行 `plugin_manager { action: "list_plugins" }`。应当看到
`dsh-token-dashboard` 条目 `enabled: true`、`fiberPhase: "active"`。

## 它记什么

用量来自 `llm/stream` —— 每一次 provider 调用都要经过的唯一漏斗
（`LlmRuntime.streamWithRegistration`）。主对话、子代理、压缩、会话标题生成
全都走过它，所以统计是完整的，不是抽样。

每次调用贡献这些字段：

| 字段 | 含义 |
|---|---|
| `inputTokens` / `outputTokens` | provider 上报的原值 |
| `cacheReadTokens` / `cacheWriteTokens` | 提示缓存命中与写入，单列 |
| `reasoningTokens` | 推理 token（provider 上报时才有） |
| `provider` / `model` | 实际服务这次调用的路由 |
| `purpose` | `chat`、`compaction` 或 `session-title` |
| `sessionId` / `cwd` | 会话与项目目录 |
| `durationMs` / `ttftMs` | 总耗时与首字延迟 |
| `ok` / `error` | 这次调用成功与否 |

聚合维度：**按天**（默认以 UTC+8 为界）、**按模型**、**按用途**、**按项目**，
外加一份最新在前的最近调用明细。

### 口径选择，摆明说

- **只向前记录，不补历史。** 插件挂载之前的调用不会被导入。看板上写「自安装以来」
  就是这个意思。想要历史，那是一个独立的一次性导入器，不是本插件。
- **不读取 `~/.dsh/channel-pack/token-ledger.json`。** 那是 `dsh-our-free-model`
  的文件：只覆盖它包装过的 adapter，且按 90 天滚动裁剪。两个账本互不相干。
- **每个字段都按 provider 上报原样记录。** 缓存命中留在它自己的计数器里，不折进
  `inputTokens`；不做归一化，也不做任何猜测。看板上那两个总量是对上报数字做的算术，
  不是对它们的解释。
- **不做价格换算。** 插件拿不到可靠的按路由单价，所以看板只讲 token，不讲钱。
  用猜来的单价算出成本，比不给数字更糟。

## 怎么读这些数字

看板给**两个总量**，因为一个数字回答不了两个问题：

- **总 token** = `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`。
  provider 实际处理过的每一个 token。缓存读取属于这里：它们是真实占用上下文窗口、
  真实计费的 token，只是单价更低。在热缓存的工作负载下它们占绝对多数 —— 实测一次
  会话里缓存占 **99.6%**，漏掉它们会把当天用量少算 **257 倍**。
- **计费 token** = `inputTokens + outputTokens`。成本口径的子集：按完整输入价计费的
  token 加上输出。定价页会拿去相乘的就是这个数。

两个都常驻显示，不需要靠猜去判断某个孤立数字是哪个口径。每日柱状图分三段堆叠 ——
缓存读取（最底）、输入、输出 —— 所以柱子的高度和卡片里的总量是同一个数。缓存刻意
画在最底下：它占 99% 时，画在上面会把输入和输出挤出绘图区。

其余数字：

- **缓存命中率** = `cacheReadTokens / (inputTokens + cacheReadTokens)`。分母为 0 时
  显示 `—` 而不是 `0%`：「什么都没发」和「什么都没命中」是两件事。
- **平均首字延迟** 只对真正产出过首 token 的调用取均值。一个在吐字前就失败的调用
  贡献 0 个样本，而不是贡献一个 0 ms。
- **没有上报用量的调用**仍计为一次请求（失败则计入错误），但不贡献 token ——
  这样一条失败的路由不会悄悄把你的均值往 0 拉。
- 区间长到每天一根柱会细成发丝时，图表自动按周合桶，桶的标签是它的第一天。

## 数据文件

```
<dsh-home>/token-dashboard/ledger.json
```

`<dsh-home>` 通常是 `~/.dsh`。可用环境变量 `DSH_TOKEN_DASHBOARD_STATE_DIR` 覆盖目录。

- **原子写入**（`ledger.json.tmp` → `rename`），2 秒防抖，插件卸载时同步落盘 ——
  所以退出前最后几次调用不会丢在防抖窗口里。
- **多进程安全。** 每次落盘都先重读当前文件，只并入本进程自上次写入以来的增量。
  因此两个 profile（比如 `desktop` 和 `headless`）写同一份账本是**相加**而不是互相覆盖。
- **损坏可恢复。** 截断、非法 JSON、schema 不符或形状不对的文件，一律按空账本处理
  并记一条 warn。插件照常工作，看板显示空态。
- **想清空数据，直接删掉这个文件。** 刻意不提供清空按钮。

## 配置

改 `cordis.patch.yml` 里这一行（或在你 profile 的 `cordis.patch.yml` 里覆盖）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `retentionDays` | `730` | 日聚合保留天数，超期整条丢弃 |
| `recentLimit` | `300` | 明细记录上限（最新在前） |
| `utcOffsetMinutes` | `480` | 固定日界偏移；`480` = UTC+8 |
| `trackProjects` | `true` | 是否记录 `cwd` 维度 |
| `flushDebounceMs` | `2000` | 落盘防抖窗口 |

## 已知限制

- **只向前记录。** 见上面的口径选择。
- **日界是固定偏移，不是你的系统时区。** 默认 UTC+8 且可配置，但它不会跟着笔记本
  跨时区走。这是刻意的：会移动的日界会悄悄拆开或合并已经记下的日子。
- **没有成本、预算、告警。** 只有 token。
- **用量就是 provider 上报的那个数。** 不上报用量的 provider 只会产生零 token 的请求；
  看板把它们记为请求，不会编造数字。
- **开发和测试都是在 Desktop profile 上做的。** 只要组合里提供了 `llm` 和一个
  `connection` 载体，理论上都能跑，但只有 Desktop 组合被实际验证过。

## 开发

零依赖、零构建 —— `index.js` 和 `client.js` 就是源码直接发布。这是刻意的约束：
需要工具链才能审计的插件，大多数用户根本不会去审计。

```
index.js           Host 半身：llm/stream 录制器、账本存储、RPC 路由
client.js          Client 半身：侧栏底部入口与看板面板
cordis.patch.yml   把 Host 半身挂进 Loader 树
test/              零依赖测试
```

```bash
npm test          # 或：node test/run-all.cjs
```

7 个文件，187 个断言：

| 文件 | 覆盖 |
|---|---|
| `ledger-check.cjs` | UTC+8 日界（午夜前后各一毫秒）、bucket 累加与钳位、派生量、增量合并、保留期、容错解析、payload 装配 |
| `store-check.cjs` | 防抖落盘、原子写、**重启后仍能读回整天的记录**、重复 read 不累加、**两个 store 交错落盘不丢计数**、保留期裁剪、明细去重与上限、写盘失败与 logger 抛错的兜底 |
| `recorder-check.cjs` | 块原样透传（同一对象引用）、惰性、一次调用一条记录、错误原样 rethrow、消费者提前中止、sink 抛错不污染模型通道 |
| `route-check.cjs` | 405 / 415 / 400、信封校验、rpcId 回显、未知方法、store 抛错不外泄、四种区间、空账本 |
| `client-check.cjs` | 在桩 facade 下加载 bundle、slot 注册与顺序、无连接降级、数据源状态机、格式化、图表分桶、zh/en 键集一致 |
| `integration-check.cjs` | 真实 `apply()` 端到端：一次模型调用 → 落账 → 从路由读回；cwd 与 purpose 维度；失败调用计为 error；卸载时落盘、二次挂载续算 |
| `render-check.cjs` | 两个组件每一棵分支真实渲染：宽/收起两态、加载/错误/无连接/空态、图表几何与零高度柱、缺 `meta`/`totals` 不崩 |

所有测试接缝都以 `__internal` 从 Host 半身导出并直接驱动。

## License

MIT
