# 本地页面时间与后台记录实验

测试使用 TempoBrowser beta-1 统一加速成品。前端和后台的累计值来自原始计时接口，选定倍率由浏览器本身施加。

## 自动复现

在 Windows PowerShell 中运行以下命令。使用项目已有的 Node.js 和 playwright-core，无需新增依赖。

```powershell
Set-Location TempoBrowser
$env:TEMP="$PWD\.cache\tmp"
$env:TMP=$env:TEMP
node tests\time-study\run.cjs
```

需要当前版本内的 `TempoBrowser-win32-x64\TempoBrowser.exe`。测试会打开实际 Windows 窗口，执行统一加速开关、滑块 Home/ArrowRight 操作和恢复原速按钮，使用独立的 `test-profile-time-study-*`。

固定倍率包含 12 轮，每轮约 10 秒。两种后台规则分别先测 ×1 三轮，再测 ×2 三轮。额外三轮运行中切换实验，每轮约 10 秒，计划按现实时间运行 ×1 三秒、×2 四秒、恢复 ×1 三秒。切换实验采用前端累计规则，同时保存服务端独立测量。总计约三分钟，窗口截取和启动会增加少量时间。

运行后在 `test-results\time-study\时间戳` 中保存报告、CSV、全部原始 JSON、JSONL 日志及截图。结果目录每次独立创建。直接打开该目录的 `报告.md` 查看全部轮次同表对照。

测试工具的原始驱动计时来自独立 Node 进程的 `process.hrtime.bigint()`。报告期望值的 ×2 分段计算仅用于测试后误差分析。网页和后台代码中没有倍率参数或倍率乘法。

## 手工复现

```powershell
Set-Location TempoBrowser
node tests\time-study\server.cjs --port=8765
```

保持这个终端运行，打开 beta-1，通过地址栏访问 `http://127.0.0.1:8765/?rule=client`。选择统一加速 ×1，点击页面“开始一轮”，用独立秒表等待约 10 秒，再点击“结束并上报”。刷新后重复，随后通过右下角滑块选择 ×2，按同样方法测试。

地址改为 `http://127.0.0.1:8765/?rule=server` 即采用后台自身单调时钟。页面仍显示并上报自己的累计值，后台分别保存收到值和最终采用值。手工模式日志默认位于 `test-results\time-study\manual`。

手工切换实验从网页时间 ×1 开始，第 3 现实秒选择 ×2，第 7 现实秒点击恢复原速，第 10 秒结束。页面时长应连续推进，预期约 14 秒。通过原始请求的 sequence 和后台各次采用值检查累计值有没有被再次求和。

## 文件职责

- `page.js` 使用普通 Date/performance 差值、CSS/RAF 和 setInterval，按钮触发 fetch JSON 上报。
- `server.cjs` 监听本机 127.0.0.1，保存原始请求和后台记录，按前端累计或服务端单调时钟选择采用值。
- `run.cjs` 负责实际浏览器界面操作、独立现实计时、三次重复、原始日志关联和误差计算。
- `report.cjs` 将一轮实验的 results.json 转换成中文报告和 CSV，可单独重新运行。

```powershell
node tests\time-study\report.cjs test-results\time-study\实际结果目录
node tests\time-study\audit.cjs test-results\time-study\实际结果目录
```

日志复核脚本会逐一比对请求原始字节、后台测量字段、累计采用规则、唯一序号、最终记录和浏览器源文件散列，并验证服务端接收间隔求和与单调时钟总时长一致。若希望将 audit.json 的结果并入报告，复核后再次运行 report.cjs。

后台将上报值作为累计值替换。服务端独立时长采用开始请求到最终请求之间的单调时钟差值，每次接收间隔也记录在日志中。API 顺序校验接受连续 sequence，自动实验没有额外发送重复包或测试重试。

## 适用范围

本实验测试本地可控页面和后台的数据流。后台采用前端累计规则时，可以记录加速后的页面时长。后台独立采用自身时钟时，页面变化仍能出现在原始请求与客户端字段，最终采用值取决于服务端规则。

第三方网站、实际账号、后台反作弊/签名、隐藏标签、断网重试、sendBeacon、Worker 和服务重启恢复均未验证。当前服务保留持久日志，内存状态在重启后需要重新建立。
