const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function latest(directory, prefix = '') {
  const names = fs.readdirSync(directory).filter(name => name.startsWith(prefix)).sort().reverse();
  for (const name of names) {
    const filename = path.join(directory, name, 'results.json');
    if (fs.existsSync(filename)) {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (data.finishedAt && !data.fatal) return { directory: path.dirname(filename), data };
    }
  }
  throw new Error('Missing completed results in ' + directory);
}
const unified = latest(path.join(root, 'test-results'), 'unified-');
const timing = latest(path.join(root, 'test-results/time-study'));
const combined = latest(path.join(root, 'test-results'), 'combined-');
const integrity = JSON.parse(fs.readFileSync(path.join(root, 'evidence/protected-integrity.json'), 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.join(timing.directory, 'audit.json'), 'utf8'));
if (!integrity.unchanged || !audit.passed || unified.data.checks.some(check => !check.passed) ||
    timing.data.rounds.length !== 15 || timing.data.rounds.some(round => !round.passed) ||
    combined.data.rows.length !== 6 || combined.data.rows.some(row => !row.passed)) {
  throw new Error('Final verification is incomplete or failed');
}
const number = value => Number(value).toFixed(4);
const lines = [];
const paragraph = text => lines.push(text, '');
paragraph('# TempoBrowser beta-1 验证报告');
paragraph(`版本为 1.0.0-beta.1，报告生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。开发与交付根目录为 ${root}。`);
paragraph('## 变更与实现状态');
paragraph('媒体倍速与网页时间加速已合并为同一份 enabled/rate 配置。媒体元素、连续虚拟时钟、定时器与网页动画同时读该配置。右下角只有统一加速开关、倍率滑块与恢复原速，启用时直接生效。选择倍率会自动开启，关闭后保留选择值，重新开启恢复该倍率。每标签页独立，刷新和跳转沿用配置。');
paragraph('本版本启用加速时的实验预警弹窗已移除。清除浏览数据的确认仍保留。基础页面沙箱、上下文隔离及浏览功能沿用既有实现，版本名为 beta-1。');
paragraph('## 实际启动与检查');
paragraph(`已实际启动当前 beta 目录内的 TempoBrowser-win32-x64/TempoBrowser.exe。统一加速与基础界面检查 ${unified.data.checks.length}/${unified.data.checks.length} 通过，原计时回归共 15 轮和 180 项检查通过，另外完成 6 轮媒体与上报同页联合测试。`);
paragraph(`运行时为 Electron ${unified.data.versions.electron} / Chromium ${unified.data.versions.chrome}。Windows 10 独立主机与其他 Windows 11 构建版本未验证。`);
paragraph('## 统一加速逐挡测量');
paragraph('每挡约 10 现实秒，同时播放含音轨的约 16 秒 WebM 短片及动态新增视频。以独立 Node 时钟测现实经过时间，视频循环时累计回绕进度。下列数值均为实际进度除以现实时间，高倍率包含循环起播和解码开销。');
lines.push('|选择|现实秒|页面时钟倍率|CSS 动画倍率|Web Animations 倍率|静态视频倍率|动态视频倍率|音频倍率|结果|',
  '|---|---:|---:|---:|---:|---:|---:|---:|---|');
for (const row of unified.data.rates) {
  lines.push(`|×${row.selected}|${number(row.realSeconds)}|×${number(row.effective.perf)}|×${number(row.effective.css)}|×${number(row.effective.wa)}|×${number(row.effective.video)}|×${number(row.effective.dynamic)}|×${number(row.effective.audio)}|${row.selected === 20 ? '部分生效，媒体内核拒绝 ×20' : '各机制同时运行'}|`);
}
lines.push('');
paragraph('×20 媒体 API 被 Chromium 拒绝。顺序测试中已有媒体保留先前接受的倍率，新建媒体维持原速，统一工具区显示实际 API 倍率和部分生效，详细内核错误可查看提示信息。页面时钟仍约 ×20。该挡不能作为全部机制均达到二十倍的验收通过结论。');
paragraph('普通 CSS/Web Animations、Date/performance、计数倒计时与媒体共享同一个配置。同源及 localhost 跨域框架均检验了注入配置。开放 Shadow DOM、自定义播放器、Worker、自定义 WebAudio、DRM 与主动反篡改脚本的完整覆盖未验证。服务器时钟和网络带宽延续各自的运行机制。');
paragraph('## 原前后端计时回归');
paragraph('两种后台规则分别先测 ×1 三轮，再测 ×2 三轮，最后做三轮 ×1 三秒、×2 四秒、×1 三秒的运行中切换。页面与后台计时算法沿用此前实验，前端原始值经正常 fetch 上报，后台原始请求和记录持久保存。以下为固定倍率三轮均值，单位为秒。');
lines.push('|后台规则|选择|现实|页面累计|请求上报|后台最终采用|服务端独立|', '|---|---|---:|---:|---:|---:|---:|');
for (const rule of ['client', 'server']) {
  for (const rate of [1, 2]) {
    const rows = timing.data.rounds.filter(row => row.rule === rule && row.rate === rate && !row.transition);
    const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    lines.push(`|${rule === 'client' ? '前端累计' : '服务端独立'}|×${rate}|${['realSeconds', 'pageSeconds', 'wireReportedSeconds', 'backendAdoptedSeconds', 'serverIndependentSeconds'].map(key => number(mean(key))).join('|')}|`);
  }
}
lines.push('');
paragraph(`三轮运行中切换的页面累计值为 ${timing.data.rounds.filter(row => row.transition).map(row => number(row.pageSeconds)).join('、')} 秒，期望约 14 秒，采样连续单调且最终记录唯一。后台采用客户端累计规则时，现实约 10 秒仍可保存并采用约 20 秒。采用服务端独立时钟时，后台最终采用约 10 秒。`);
paragraph(`独立复核匹配 ${audit.requests} 个原始请求、${audit.matchedReports} 次上报。前端冻结值、请求原始正文与后台保存客户端值逐一相同，后台采用规则逐条核验。请求接收间隔求和与服务端单调计时相同。完整逐轮表与误差见 ${path.relative(root, path.join(timing.directory, '报告.md'))}。`);
paragraph('## 媒体与上报同页联合测试');
paragraph('为验证合并后同页共存，复用计时页并动态加入同源 HTML5 视频，通过统一滑块选择 ×2。两个后台规则各重复三次，媒体播放、动画、页面计时与周期上报同时运行。首次准备测试因测试页 CSP 拒绝跨源视频而未进入计时，改用同源媒体资源后完成正式六轮。');
lines.push('|后台规则|次数|现实秒|视频进度倍率|页面累计秒|请求上报秒|后台最终采用秒|服务端独立秒|',
  '|---|---:|---:|---:|---:|---:|---:|---:|');
for (const row of combined.data.rows) {
  lines.push(`|${row.rule === 'client' ? '前端累计' : '服务端独立'}|${row.repetition}|${number(row.realSeconds)}|×${number(row.mediaRate)}|${number(row.pageSeconds)}|${number(row.wireSeconds)}|${number(row.backendAdoptedSeconds)}|${number(row.serverIndependentSeconds)}|`);
}
lines.push('');
paragraph('## 原目录保护');
paragraph(`受保护目录 ${integrity.directory} 的前后文件数均为 ${integrity.filesBefore}，新增及内容改变数均为 0，逐文件 SHA256 一致。所有源码、依赖、测试配置、截图、缓存、日志和新压缩包位于当前 beta-1 目录。`);
paragraph('## 使用和复现');
paragraph('启动入口为 TempoBrowser-win32-x64/TempoBrowser.exe，便携压缩包保留完整目录即可运行。源码位于 src，复现命令见 README.md。scripts/build.cjs 将本版本源码复制至本版本运行目录，tests/beta1.cjs、tests/time-study/run.cjs 和 tests/combined-report.cjs 分别执行统一加速、原计时回归和联合验证。');
paragraph('原始证据包含 test-results 下的 JSON、CSV、requests.jsonl、backend.jsonl、driver.jsonl 与原生窗口截图。evidence 保存受保护目录的前后清单和实验前应用源码副本。');
paragraph('## 限制与未验证');
paragraph('统一设置覆盖现有已支持机制，媒体 ×20、后台独立计时、Worker、DRM 和自定义播放器等边界仍需按机制判断。高倍速声音听感、第三方站点业务流程、隐藏/最小化页面、断网重试、sendBeacon、签名校验、服务重启恢复和跨系统版本均未验证。');
paragraph('程序尚未代码签名，EXE 图标及二进制版本资源沿用 Electron。发布包排除复制来的用户数据、下载、测试配置和旧版验证资料。');
fs.writeFileSync(path.join(root, '验证报告.md'), lines.join('\n'));
fs.writeFileSync(path.join(root, 'evidence/verification-summary.json'), JSON.stringify({
  version: '1.0.0-beta.1', unified: path.relative(root, unified.directory), timing: path.relative(root, timing.directory),
  combined: path.relative(root, combined.directory), checks: unified.data.checks.length + 180 + 36,
  protectedUnchanged: integrity.unchanged, fullMedia20Supported: false, passed: true
}, null, 2));
console.log(JSON.stringify({ report: path.join(root, '验证报告.md'), unifiedChecks: unified.data.checks.length, timingRounds: 15, combinedRounds: 6 }));
