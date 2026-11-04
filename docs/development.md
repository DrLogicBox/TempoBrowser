# 开发与构建

TempoBrowser beta-1 的应用代码位于 `src`，使用 Electron 45.2.1。开发和自动化测试推荐 Windows x64 与 Node.js 22.12+ 或 24 LTS。生成 Release 压缩包另需 Python 3。

## 准备环境

```powershell
git clone https://github.com/DrLogicBox/TempoBrowser.git
Set-Location TempoBrowser
npm ci
npm run build
npm start
```

`npm run build` 使用当前项目中的 Electron 依赖准备完整 Windows 运行目录，再拷入应用源码。首次安装 Electron 需要联网下载官方运行时。

也可以将 Release 中完整的 `TempoBrowser-win32-x64` 文件夹解压到项目根目录后构建。程序、运行配置和下载会保存在当前项目目录。

```text
TempoBrowser/
  src/                     应用与统一加速实现
  assets/                  项目标识与实际界面截图
  docs/                    开发和验证说明
  tests/                   统一加速及前后端计时测试
  scripts/                 构建、截图与打包工具
  TempoBrowser-win32-x64/   本地完整运行目录
  test-results/            本地原始测试数据
  release/                 本地发布附件
```

## 运行测试

```powershell
npm test
npm run test:time
node tests/combined-report.cjs
```

统一加速测试在每个挡位测量约 10 秒，覆盖媒体、动态视频、音频、页面时钟、动画、嵌入框架及界面状态。前后端测试按两种后台采用规则，各执行 ×1 和 ×2 三次重复，另做三次运行中切换。同页联合测试在媒体播放时继续执行累计时长上报。

测试通过程序正常界面操作统一开关与滑块。独立 Node 进程的时钟测量现实经过时间，原始请求和后台接收记录写入 `test-results`。输出目录每次独立生成，测试配置位于运行目录下的 `test-profile-*`。

后台默认只监听 `127.0.0.1`。手动计时页可以这样启动。

```powershell
node tests/time-study/server.cjs --port=8765
```

打开 `http://127.0.0.1:8765/?rule=client` 或 `http://127.0.0.1:8765/?rule=server`，分别选择客户端累计或服务端独立规则。使用独立秒表，先 ×1 后 ×2，每次约 10 秒，结束时点击页面按钮完成最终上报。

## 构建发布附件

```powershell
npm run build
npm run package
```

输出 Windows x64 便携 ZIP、源码 ZIP 和 `SHA256SUMS.txt`。发布附件排除用户数据、下载、测试配置、授权文件、开发缓存和本地协作笔记。

运行时保留 Electron 与 Chromium 的许可证。beta-1 尚未代码签名，EXE 的图标和二进制版本资源沿用 Electron，README 展示的是项目标识。

## 实现位置

- `src/speed-hook.js` 统一控制媒体、虚拟时钟、定时器和动画。
- `src/speed-controller.js` 向文档和嵌入框架安装、更新配置。
- `src/main.js` 管理标签、持久会话、下载和主进程观测。
- `src/renderer.js` 呈现统一工具区及实际值反馈。
- `tests/time-study/server.cjs` 保存原始请求，按选定后台规则计算采用值。

功能覆盖和 beta-1 实测结果见[验证报告](verification.md)。
