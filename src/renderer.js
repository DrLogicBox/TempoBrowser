const $=id=>document.getElementById(id), command=(name,data)=>window.browser.command(name,data);
const rates=[1,2,3,5,10,20];let state=null,panel=null,clearedMessage='';
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
function button(text,fn,cls){const e=element('button',text,cls);e.onclick=fn;return e}
async function confirmAction(message){
  const dialog=$('confirm-dialog');if(dialog.open)return false;
  await command('overlay',true);dialog.returnValue='cancel';$('confirm-message').textContent=message;dialog.showModal();
  return new Promise(resolve=>{dialog.onclose=async()=>{await command('overlay',false);resolve(dialog.returnValue==='confirm')}});
}
function resize(){requestAnimationFrame(()=>{const r=$('viewport').getBoundingClientRect();command('bounds',{x:r.x,y:r.y,width:r.width,height:r.height})})}
new ResizeObserver(resize).observe($('viewport'));
function setPanel(name){panel=panel===name?null:name;$('panel').hidden=!panel;if(panel)renderPanel();resize()}
function renderPanel(){
  if(!state||!panel)return;
  const titles={bookmarks:'书签',history:'浏览历史',downloads:'下载',settings:'设置与帮助'};
  $('panel-title').textContent=titles[panel];const body=$('panel-body');body.replaceChildren();
  if(panel==='settings'){
    const box=element('div',undefined,'settings');
    box.append(element('div','统一加速使用同一开关和倍率控制 HTML5 媒体、页面时钟、定时器与网页动画。选择倍率即开启，关闭开关可保留所选倍率，恢复原速会回到 ×1。','warning'));
    box.append(element('h3','清除浏览数据'),element('p','勾选后确认。清除 Cookie 与站点数据会退出网站登录。下载记录清除不会删除已下载文件。'));
    const checked=[];
    for(const [key,label] of [['history','浏览历史'],['storage','Cookie、登录和站点存储'],['cache','缓存'],['downloads','已完成的下载记录']]){
      const l=element('label',undefined,'check'),i=element('input');i.type='checkbox';i.value=key;l.append(i,element('span',label));box.append(l);checked.push(i);
    }
    const status=element('p',clearedMessage||state.notice);
    box.append(button('清除所选数据',async()=>{const types=checked.filter(i=>i.checked).map(i=>i.value);if(!types.length){status.textContent='请先选择要清除的数据。';return}if(!await confirmAction('确认清除所选数据？此操作无法撤销。'))return;await command('clear',{types});clearedMessage='所选数据已清除，网页内存状态需刷新后更新。';status.textContent=clearedMessage},'primary'),status);
    box.append(element('hr'),element('h3','加速范围与实际反馈'),element('p','工具区显示页面时钟观测值与媒体 API 实际倍率。缓冲、暂停、循环和跳转会影响媒体进度测量。媒体 ×20 受 Chromium 限制，出现错误时会显示部分生效。高倍速有静音、丢帧或卡顿风险，声音听感需要实际确认。'),element('p','支持普通页面 Date/performance、定时器、RAF 时间戳、CSS/Web Animations 和 HTML5 video/audio。Worker、服务器计时、网络速度、自定义 WebAudio、封闭 Shadow DOM 与 DRM 有覆盖边界。服务器最终采用的浏览时长由其计时规则决定。'),element('h3','快捷键'),element('p','Ctrl+L 地址栏 · Ctrl+T 新标签页 · Ctrl+W 关闭 · Ctrl+D 书签 · Ctrl+H 历史 · Ctrl+J 下载 · Ctrl+R / F5 刷新 · Esc 停止 · Alt+←/→ 前进后退'),element('h3','Tempo beta-1'),element('p','Chromium / Electron · Windows x64 便携版。用户数据位于程序目录的 user-data，下载位于 Downloads。账号同步、扩展商店、密码库、自动更新、DRM 授权和摄像头/麦克风权限尚未提供。'));
    body.append(box);return;
  }
  const rows=state[panel];if(!rows?.length){body.append(element('p',{bookmarks:'点击地址栏中的 ☆ 保存当前网页。',history:'访问过的网页会显示在这里。',downloads:'下载任务和进度会显示在这里。'}[panel],'empty'));return}
  for(const row of rows.slice(0,250)){
    const e=element('div',undefined,'entry');
    if(panel==='downloads'){
      e.append(element('strong',row.name));const mb=n=>(n/1048576).toFixed(2)+' MB';
      const labels={progressing:row.paused?'已暂停':'下载中',completed:'已完成',cancelled:'已取消',interrupted:'已中断'};
      e.append(element('div',`${labels[row.state]||row.state} · ${mb(row.received)} / ${row.total?mb(row.total):'未知大小'}`,'meta'));
      const progress=element('progress',undefined,'progress');progress.max=row.total||1;progress.value=row.received;e.append(progress);
      const a=element('div',undefined,'entry-actions');
      if(row.state==='progressing'){a.append(button(row.paused?'继续':'暂停',()=>command('download',{id:row.id,action:row.paused?'resume':'pause'})),button('取消',()=>command('download',{id:row.id,action:'cancel'})))}
      if(row.state==='completed')a.append(button('打开所在文件夹',()=>command('download',{id:row.id,action:'show'})));
      e.append(a);
    }else{
      e.append(button(row.title||row.url,()=>command('navigate',row.url),'link'),element('div',row.url,'url'));
      if(panel==='history')e.append(element('div',new Date(row.date).toLocaleString('zh-CN'),'meta'));
      else e.append(button('移除',()=>command('remove-bookmark',row.url)));
    }body.append(e);
  }
}
function render(next){
  state=next;const t=state.tabs.find(t=>t.id===state.activeId);
  document.body.classList.toggle('dark',state.theme==='dark');
  $('tabs').replaceChildren(...state.tabs.map(tab=>{
    const e=element('div',undefined,'tab'+(tab.id===state.activeId?' active':''));e.setAttribute('role','tab');e.setAttribute('aria-selected',String(tab.id===state.activeId));e.tabIndex=0;e.title=tab.title;e.onclick=()=>command('select',tab.id);e.onkeydown=ev=>{if(ev.key==='Enter')command('select',tab.id)};
    e.append(element('span',tab.loading?'◌':'◈','indicator'),element('span',tab.title,'tab-title'));
    if(tab.enabled&&tab.rate!==1)e.append(element('span','×'+tab.rate,'mini-rate'));
    const close=button('×',ev=>{ev.stopPropagation();command('close',tab.id)},'close');close.setAttribute('aria-label','关闭 '+tab.title);e.append(close);return e;
  }));
  if(!t)return;
  if(document.activeElement!==$('address'))$('address').value=t.url;
  $('security').textContent=t.url.startsWith('https:')?'◇':t.url?'!':'⌕';$('security').title=t.url.startsWith('https:')?'HTTPS 加密连接':t.url?'HTTP 未加密连接':'地址或搜索';
  $('back').disabled=!t.back;$('forward').disabled=!t.forward;
  $('reload').textContent=t.loading?'×':'↻';$('reload').title=t.loading?'停止加载 Esc':'刷新 F5';
  $('loading').classList.toggle('busy',t.loading);
  $('bookmark').classList.toggle('saved',state.bookmarks.some(b=>b.url===t.url));$('bookmark').textContent=state.bookmarks.some(b=>b.url===t.url)?'★':'☆';
  $('acceleration-enabled').checked=t.enabled;$('speed').value=rates.indexOf(t.rate);$('rate').textContent='×'+t.rate;
  $('speed').setAttribute('aria-valuetext','所选倍率 '+t.rate+' 倍');
  $('scope').textContent=t.enabled?'统一控制 HTML5 音视频、动画与页面计时':'统一加速已关闭，当前页面按原速运行';
  $('page-status').textContent=t.error?'访问失败':t.loading?'正在加载…':t.url?new URL(t.url).hostname:'准备就绪';
  const media=t.stats.flatMap(f=>(f.status?.media||[]).map(m=>({...m,origin:f.origin})));const errors=media.filter(m=>m.error);const observed=media.filter(m=>m.observed!==null&&m.observed!==undefined&&!m.paused);
  let text='',warn=false;
  const effectiveRate = t.enabled ? t.rate : 1;
  const clocks = t.stats.map(frame => frame.status?.observedClock).filter(Number.isFinite);
  text = t.enabled ? '已开启 · 所选 ×' + t.rate : '已关闭 · 实际 ×1';
  text += ' · 时钟 ' + (clocks.length ? '×' + clocks[0].toFixed(2) : '待测');
  if (media.length) {
    text += ' · 媒体 API ' + [...new Set(media.map(item => '×' + item.actual))].join('/');
    if (observed.length) text += ' · 进度 ' + observed.map(item => '×' + item.observed.toFixed(2)).join('/');
  } else {
    text += ' · 未发现媒体';
  }
  if (errors.length) {
    text += ' · 部分生效：媒体倍率受内核限制';
    warn = true;
  }
  if (clocks.some(value => Math.abs(value - effectiveRate) / effectiveRate > 0.25)) {
    text += ' · 页面时钟偏差较大';
    warn = true;
  }
  if (observed.some(item => Math.abs(item.observed - effectiveRate) / effectiveRate > 0.25)) {
    text += ' · 媒体进度偏差较大或正在缓冲';
    warn = true;
  }
  if (media.some(item => item.dropped > 5)) {
    text += ' · 检测到丢帧';
    warn = true;
  }
  if (t.enabled && t.rate >= 5) {
    text += ' · 高倍率可能静音或卡顿';
    warn = true;
  }
  if(t.issue){text+=' · '+t.issue;warn=true}
  $('speed-status').textContent=text;$('speed-status').title=[text,...errors.map(item=>item.error)].join('\n');$('speed-status').classList.toggle('warn',warn);
  $('error').hidden=!t.error;$('error-text').textContent=t.error;
  const count=state.downloads.filter(d=>d.state==='progressing').length;$('download-badge').textContent=count||'';
  if(panel&&panel!=='settings')renderPanel();
}
$('new').onclick=()=>command('new');$('home').onclick=()=>command('home');$('back').onclick=()=>command('back');$('forward').onclick=()=>command('forward');$('reload').onclick=()=>command(state?.tabs.find(t=>t.id===state.activeId)?.loading?'stop':'reload');$('retry').onclick=()=>command('reload');$('bookmark').onclick=()=>command('bookmark');
$('address-form').onsubmit=ev=>{ev.preventDefault();command('navigate',$('address').value);$('address').blur()};
$('acceleration-enabled').onchange=()=>command('speed',{enabled:$('acceleration-enabled').checked,rate:rates[Number($('speed').value)]});
$('speed').oninput=()=>{const rate=rates[Number($('speed').value)];command('speed',{enabled:rate!==1,rate})};
$('reset').onclick=()=>command('speed',{enabled:false,rate:1});
$('theme').onclick=()=>command('theme',state?.theme==='dark'?'light':'dark');
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>setPanel(b.dataset.panel));$('panel-close').onclick=()=>{panel=null;$('panel').hidden=true;resize()};
window.browser.onState(render);window.browser.onFocusAddress(()=>{$('address').focus();$('address').select()});window.browser.onOpenPanel(setPanel);
command('state').then(render);
