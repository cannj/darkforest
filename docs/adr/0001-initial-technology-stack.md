---
status: accepted
---

# 首版技术栈

首版沿用 Three.js、Vite 和 npm，游戏底座使用 TypeScript，服务端使用 Node.js 24 LTS。房间通过 `ws` 向浏览器原生 WebSocket 发送按玩家生成的 JSON 视图。这个选择让联机传输、逐拍观察和对局规则各有一个明确的入口。

## 技术栈

| 位置 | 技术 | 用途 |
| --- | --- | --- |
| 浏览器 | Three.js、Vite、DOM | 沿用现有像素化场景。回合、计划和提示先用页面控件展示。当前项目声明了 Three.js `0.187.0` 和 Vite `8.3.8`。[项目依赖](../../package.json) |
| 语言和构建 | TypeScript 严格模式、npm | 新增的规则、房间和协议用 TypeScript。Vite 构建浏览器，`tsc` 单独做类型检查并构建服务端的 ESM 输出。沿用现有 npm 锁文件。[Vite 的 TypeScript 支持](https://vite.dev/guide/features.html#typescript) |
| 服务端 | Node.js 24 LTS、`ws` | 单进程管理首版房间。开发环境已有 Node.js 24。连接使用原生 WebSocket，服务端实现座位绑定、重连和按玩家分发。[Node.js 发布计划](https://nodejs.org/en/about/previous-releases) · [ws 项目](https://github.com/websockets/ws) |
| 消息和配置 | JSON、Zod | 在边界校验客户端命令与关卡配置。客户端和服务端共用公开消息类型，服务端保留完整状态类型。行动是否可执行由规则引擎判断。[Zod 文档](https://zod.dev/) |
| 测试 | Vitest、Playwright | Vitest 跑规则、玩家视图和复盘测试。Playwright 用两个隔离的浏览器会话验证联机与重连。[Vitest 入门](https://vitest.dev/guide/) · [Playwright 浏览器上下文](https://playwright.dev/docs/browser-contexts#multiple-contexts-in-a-single-test) |

## 联机方案的取舍

- **`ws` 与原生 WebSocket。** 项目负责座位绑定、截止、去重、重连和玩家视图。每个客户端接收自己的快照和结算片段。慢节奏、少玩家的首版可以用这套消息直接验收迷雾和重连行为。[ws 项目](https://github.com/websockets/ws)
- **Colyseus。** 它提供房间生命周期、重连和按客户端过滤状态的 `StateView`。状态补丁会合并同步间隔内的变化，所以这个项目仍要明确记录并发送短暂目击。以后需要配对或更完整的房间管理时，可以评估让 Colyseus 承接房间适配层，保留现有规则和玩家视图。[状态同步](https://docs.colyseus.io/state) · [玩家可见范围](https://docs.colyseus.io/state/view) · [重连](https://docs.colyseus.io/room/reconnection)
- **Socket.IO。** 它能尝试恢复短暂掉线期间的会话与消息，官方文档也要求应用处理恢复失败时的状态同步。这里可以从重连后重新发送玩家视图起步。[连接状态恢复](https://socket.io/docs/v4/connection-state-recovery/)

## 首个里程碑的存储范围

首版在单个服务进程的内存中保留进行中的房间，开发复盘输入按轮写入本地 JSON Lines 文件。浏览器断开连接时可以回到仍在运行的房间。服务进程重启时，已记录的回合可用于开发复盘，进行中的房间会结束。若后续要求在进程重启后继续同一局，还需持久化活动房间状态、玩家座位、待结算计划和截止时间。

架构和首版验收边界见 [对局架构](../game-architecture.md)。
