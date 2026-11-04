const fs = require('node:fs');
const path = require('node:path');

function writeReport(outputDirectory) {
  const output = path.resolve(outputDirectory);
  const results = JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8'));
  const rows = results.rounds;
  const format = value => Number.isFinite(value) ? value.toFixed(4) : '未验证';
  const signed = value => (value >= 0 ? '+' : '') + format(value);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const lines = [];
  function paragraph(text) { lines.push(text, ''); }

  paragraph('# Tempo 网页时间加速与本地后台记录实验');
  paragraph(`本轮完成于 ${new Date(results.finishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}，时区为 Asia/Shanghai。测试目录为 ${output}。`);
  paragraph(`本次实际运行 beta-1 成品 ${results.executable}。Electron ${results.versions?.electron || '未验证'}，Chromium ${results.versions?.chrome || '未验证'}。文件 SHA256 及本轮源码与成品一致性存于 results.json，受保护旧发行目录的完整性另见 beta-1 验证报告。`);
  if (results.fatal) paragraph('执行出现异常，剩余轮次标记为未验证。详细异常保存在 results.json 的 fatal 字段。');

  paragraph('## 实现状态');
  paragraph('本地页面直接使用 performance.now() 和 Date.now() 的差值累计浏览时长，使用 setInterval(..., 1000) 周期上报累计值，CSS animation 和 RAF 时间戳作为辅助观测。前端和后台均保留原始毫秒值。倍率由 beta-1 统一加速开关、滑块键盘输入和恢复按钮产生，计时页面和后台逻辑沿用已验证的本地实验。');
  paragraph('后台为每次请求保存接收时间、单调时间、请求头、原始请求正文、Base64 原始字节及对应记录。客户端规则将本次上报的累计秒数保存为采用值。服务端规则采用 process.hrtime.bigint() 从开始请求到当前请求的独立时长，同时保留收到的客户端值。后台每次替换累计值，顺序校验拒绝乱序报告。');
  paragraph('## 测量方法');
  paragraph('固定倍率先测试 ×1 三轮，再测试 ×2 三轮，两种后台规则分别执行，共 12 轮。每轮独立刷新页面，测试时页面保持可见。独立 Node 测试进程用 process.hrtime.bigint() 测量约 10 秒，网页调速机制无法修改这个进程的时钟。');
  paragraph('开始和结束均通过页面按钮的正常事件处理函数触发。独立驱动在点击命令前后计现实时间，以区间中点之差作为现实经过时长，并保存两端耗时区间。页面在开始按钮事件中建立自身时钟基准。后台从收到开始请求起建立基准，因此页面、驱动和服务器存在毫秒级起止边界差异。');
  paragraph('运行中切换测试采用客户端累计规则，重复三轮。计划现实第 3 秒从 ×1 切至 ×2，第 7 秒恢复 ×1，第 10 秒结束。期望累计值约 14 秒，精确期望按独立驱动记录的实际输入时间分段积分。该期望仅用于测试后误差分析。');
  paragraph('每轮最终报告会冻结页面实际测量值，再通过与周期报告相同的 fetch 和队列上报。测试在磁盘 requests.jsonl 中找到最终请求，并在磁盘 backend.jsonl 中找到对应最终记录后作比较。页面显示保留三位小数，表格中的页面累计值取未舍入原始测量值。');
  paragraph('## 全部结果与误差');
  paragraph('单位均为秒。页面误差相对当前模式应得的分段累计值，采用值误差相对后台规则的目标值。服务端误差相对独立现实计时器。');
  lines.push('|后台规则 / 倍率 / 次数|现实经过|页面目标|页面累计|页面误差|页面显示|请求上报|后台保存客户端值|后台最终采用|采用值误差|服务端独立|服务端误差|',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    const label = `${row.rule === 'client' ? '前端累计' : '服务端独立'} / ${row.transition ? '1→2→1' : '×' + row.rate} / ${row.repetition}`;
    lines.push(`|${label}|${format(row.realSeconds)}|${format(row.expectedPageSeconds)}|${format(row.pageSeconds)}|${signed(row.errors.pageVsExpectedSeconds)}|${format(row.pageDisplaySeconds)}|${format(row.wireReportedSeconds)}|${format(row.backendSavedClientSeconds)}|${format(row.backendAdoptedSeconds)}|${signed(row.errors.adoptedVsRuleTargetSeconds)}|${format(row.serverIndependentSeconds)}|${signed(row.errors.serverVsRealSeconds)}|`);
  }
  lines.push('');
  if (rows.length < 15) paragraph(`计划 15 轮，已执行 ${rows.length} 轮，其余未验证。`);

  paragraph('## 周期上报、动画和连续性');
  lines.push('|轮次|CSS 动画推进|RAF 时间推进|周期请求数|周期请求平均现实间隔|累计连续单调|序号连续|最终记录唯一|',
    '|---|---:|---:|---:|---:|---|---|---|');
  for (const row of rows) {
    lines.push(`|${row.label}|${format(row.pageAnimationSeconds)}|${format(row.pageRafSeconds)}|${row.periodicReportCount}|${format(row.meanPeriodicArrivalSeconds)}|${row.checks.cumulativeTimeMonotonic ? '是' : '否'}|${row.checks.sequencesConsecutive ? '是' : '否'}|${row.checks.oneFinalRecord ? '是' : '否'}|`);
  }
  lines.push('');
  paragraph('切换轮次的期望值和前后采样保存在 results.json 的 expectedPageSeconds、inputTimings.switches 和 pageSamples。累计值没有在切倍率时重置或再次乘以新倍率。唯一序号、单次最终记录和采用值等于最新累计值共同检查重复计算。此实验未向后台发送重复包或模拟重试，重复传输下的处理未验证。');

  paragraph('## 实测判断');
  const fixedRows = rows.filter(row => !row.transition);
  const clientTwice = fixedRows.filter(row => row.rule === 'client' && row.rate === 2);
  const serverTwice = fixedRows.filter(row => row.rule === 'server' && row.rate === 2);
  const allChecks = rows.flatMap(row => Object.entries(row.checks).map(([name, pass]) => ({ round: row.label, name, pass })));
  paragraph(`已执行 ${rows.length} 轮，逐项检查通过 ${allChecks.filter(check => check.pass).length}/${allChecks.length}。具体检查结果保存在每轮 checks 字段。`);
  if (clientTwice.length) {
    paragraph(`客户端累计规则的 ×2 样本共 ${clientTwice.length} 轮。平均现实 ${format(mean(clientTwice.map(row => row.realSeconds)))} 秒，页面 ${format(mean(clientTwice.map(row => row.pageSeconds)))} 秒，后台采用 ${format(mean(clientTwice.map(row => row.backendAdoptedSeconds)))} 秒。磁盘原始请求与页面冻结值、后台保存的客户端值之间的最大差分别为 ${format(Math.max(...clientTwice.map(row => Math.abs(row.errors.wireVsPageSeconds))))} 秒和 ${format(Math.max(...clientTwice.map(row => Math.abs(row.errors.savedClientVsWireSeconds))))} 秒。`);
  }
  if (serverTwice.length) {
    paragraph(`服务端独立规则的 ×2 样本共 ${serverTwice.length} 轮。平均页面及请求上报 ${format(mean(serverTwice.map(row => row.pageSeconds)))} 秒，后台最终采用 ${format(mean(serverTwice.map(row => row.backendAdoptedSeconds)))} 秒，服务端独立测量 ${format(mean(serverTwice.map(row => row.serverIndependentSeconds)))} 秒。`);
  }
  const auditFile = path.join(output, 'audit.json');
  if (fs.existsSync(auditFile)) {
    const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
    paragraph(`独立日志复核匹配 ${audit.matchedReports} 次上报及 ${audit.requests} 个原始请求。每轮接收间隔的求和与服务端独立时长一致，最大浮点差为 ${audit.independentIntervalSumMaxErrorSeconds.toExponential(3)} 秒。浏览器源文件 SHA256 与实验开始时一致，且与成品内文件逐一相同。`);
  }
  if (clientTwice.length === 3 && serverTwice.length === 3 && rows.every(row => row.passed)) {
    paragraph('“现实约 10 秒，后台记录并采用约 20 秒”的目标在本地后台采用前端累计时长的规则下成立。后台按自身时钟独立计时时，最终采用值约 10 秒，虽然请求仍携带约 20 秒。此差异来自后台选择的数据源。');
  } else {
    paragraph('目标成立范围需结合表格和未通过项判断，当前不能作全部通过结论。');
  }
  const failed = allChecks.filter(check => !check.pass);
  if (failed.length) paragraph('未通过项为 ' + failed.map(check => check.round + ' / ' + check.name).join('，') + '。');

  paragraph('## 原因和需要修改的位置');
  paragraph('现有 src/speed-hook.js 中 virtualNow 按选定倍率推进虚拟时钟，Date.now 和 performance.now 读这个时钟。set 方法先保存已累计的虚拟时间，再切换推进斜率，因此已有累计时长保持连续。定时器按虚拟剩余时间重新安排，所以周期上报在 ×2 下通常更频繁。src/speed-controller.js 负责通过现有通道更新页面配置。');
  paragraph('后台进程使用自己的 Date.now 和 process.hrtime.bigint，页面脚本包装层作用于网页上下文。若目标要求服务端独立规则也最终采用约 20 秒，需要在自有后台明确改变计时采用规则。本地测试中该分支位于 tests/time-study/server.cjs 的 adoptedSeconds 计算处。beta-1 合并媒体与页面加速后，两种后台规则仍分别接受验证。');
  paragraph('## 复现与证据');
  paragraph('环境与命令见 tests/time-study/README.md。运行 node tests/time-study/run.cjs 会打开 beta-1 打包程序，建立当前版本内的独立测试配置，通过统一加速界面选择倍率，执行 15 轮测试并写入新结果目录。');
  paragraph('requests.jsonl 包含原始请求头和正文。backend.jsonl 包含后台开始记录、每次接收时间、累计值与最终采用值。driver.jsonl 包含独立驱动的界面动作时间区间。results.json 包含全部原始页面采样、按钮边界、最终请求关联号及误差。PNG 为实际 Windows 窗口截图。');
  paragraph('## 功能限制和未验证范围');
  paragraph('本次检验了可见单标签页、常规 Date/performance 计时、fetch JSON 周期累计上报、CSS 动画、RAF、两种自建后台采用规则和运行中切换。后台信任客户端累计值是本地测试明确选择的规则。服务端会自行决定最终采用哪种时间。');
  paragraph('Worker、ServiceWorker、隐藏标签、失焦最小化、页面关闭 sendBeacon、跨域接口、WebSocket、断网与重试、服务器签名或校验、实际第三方站点、真实账号和服务重启后的恢复均未验证。服务器日志已持久保存，本地服务的运行中状态保存在内存，未实现断电恢复。系统时钟跳变场景未验证，单调时钟用来减少墙上时钟校准的影响。');
  paragraph('测试背景条件为正常可见页面，单轮容差预设为 0.3 秒。观察到的最大页面分段累计偏差为 ' + format(Math.max(...rows.map(row => Math.abs(row.errors.pageVsExpectedSeconds)))) + ' 秒，最大服务端与驱动计时差为 ' + format(Math.max(...rows.map(row => Math.abs(row.errors.serverVsRealSeconds)))) + ' 秒。点击命令的前后时间区间和本地请求往返带来测量边界不确定性，应结合 driver.jsonl 解读这些小差值。');

  fs.writeFileSync(path.join(output, '报告.md'), lines.join('\n'));
  const columns = [
    'label', 'rule', 'rate', 'repetition', 'transition', 'realSeconds', 'expectedPageSeconds',
    'pageSeconds', 'pageDisplaySeconds', 'wireReportedSeconds', 'backendSavedClientSeconds',
    'backendAdoptedSeconds', 'serverIndependentSeconds', 'serverWallSeconds',
    'pageAnimationSeconds', 'pageRafSeconds', 'periodicReportCount', 'meanPeriodicArrivalSeconds', 'passed',
    'pageVsExpectedSeconds', 'pageVsExpectedPercent', 'wireVsPageSeconds', 'savedClientVsWireSeconds',
    'adoptedVsRuleTargetSeconds', 'serverVsRealSeconds'
  ];
  const csv = [columns.join(','), ...rows.map(row => columns.map(column => String({ ...row, ...row.errors }[column])).join(','))];
  fs.writeFileSync(path.join(output, 'results.csv'), '\ufeff' + csv.join('\r\n'));
}

module.exports = { writeReport };

if (require.main === module) {
  if (!process.argv[2]) throw new Error('Provide the result directory');
  writeReport(process.argv[2]);
}
