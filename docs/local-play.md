# 本地双人试玩

需要 Node.js 24 LTS。首次执行 `npm ci`。

分别打开两个终端，在项目目录运行 `npm run server` 和 `npm run dev`。房间服务默认监听 `127.0.0.1:8788`，Vite 将 `/room` WebSocket 代理到该服务。

在两个独立浏览器窗口中访问终端显示的页面地址，在地址后添加相同的 `?room=demo-1`。每个连接分配一个座位，房间最多两个座位。当前切片刷新页面会申请新座位，重新试玩请更换房间名或重启服务。重连恢复由后续工单实现。

选择方向，点击「提交计划」查看自己的草稿，再点击「锁定计划」。双方锁定后服务端统一结算，各自棋子更新位置并进入下一回合。也可提交空计划以等待。当前每轮一步，公开地图是石室中央的 5 × 5 格棋盘，坐标从 0 开始。自身位置以外的动态尚未接入视野系统。

`npm test` 验证房间公开流程，`npm run build` 检查严格类型并构建浏览器和服务端。`node dist-server/server/index.js` 可启动编译后的房间服务。浏览器生产文件位于 `dist`，正式提供页面时需将 `/room` WebSocket 转发到房间服务。

首次运行端到端测试前执行 `npx playwright install chromium`，之后运行 `npm run test:e2e`。测试自行启动 Vite 和房间服务，占用 5174、8788 端口。已有 Chromium 时可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向其可执行文件。截图存入忽略的 `artifacts` 目录。
