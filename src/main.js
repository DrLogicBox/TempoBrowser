const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { SpeedController } = require('./speed-controller');
const root = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const profileArg = process.argv.find(a => a.startsWith('--profile='));
const profile = profileArg ? path.resolve(root, profileArg.slice(10)) : path.join(root, 'user-data');
if (!profile.startsWith(root + path.sep)) throw new Error('用户数据目录必须位于程序目录内');
fs.mkdirSync(profile, {recursive:true});
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setPath('crashDumps', path.join(profile,'crashes'));
app.setAppLogsPath(path.join(profile,'logs'));
app.setPath('temp', path.join(profile,'temp'));
fs.mkdirSync(app.getPath('temp'),{recursive:true});
const stateFile=path.join(profile,'browser.json');
let store={theme:'light',bookmarks:[],history:[],downloads:[]};
try {store={...store,...JSON.parse(fs.readFileSync(stateFile,'utf8'))}} catch {}
store.downloads=store.downloads.map(d=>({...d,state:['progressing','interrupted'].includes(d.state)?'interrupted':d.state}));
function save() { const tmp=stateFile+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(store,null,2)); fs.renameSync(tmp,stateFile); }
let win, tabs=[], activeId=null, nextId=0, modalOpen=false, bounds={x:0,y:108,width:1200,height:600};
const liveDownloads=new Map();
const HOME=path.join(__dirname,'home.html');
function active(){return tabs.find(t=>t.id===activeId)}
function publicTab(t){const wc=t.view.webContents;return {id:t.id,title:t.title,url:t.url,loading:t.loading,error:t.error,rate:t.rate,enabled:t.enabled,issue:t.issue,stats:t.stats,back:wc.navigationHistory.canGoBack(),forward:wc.navigationHistory.canGoForward()}}
function state(){return {tabs:tabs.map(publicTab),activeId,theme:store.theme,bookmarks:store.bookmarks,history:store.history,downloads:store.downloads,notice:store.notice||''}}
function broadcast(){if(win&&!win.isDestroyed()){layout();win.webContents.send('state',state())}}
function layout(){for(const t of tabs){t.view.setVisible(t.id===activeId&&!t.error&&!modalOpen); if(t.id===activeId)t.view.setBounds(bounds)}}
function safeURL(input){
  const value=String(input||'').trim().slice(0,8192);
  if(!value)return null;
  if(/^https?:\/\//i.test(value)){try{return new URL(value).href}catch{return null}}
  if(/^[a-z][\w+.-]*:/i.test(value)&&!/^localhost:\d/i.test(value))return null;
  if(!/\s/.test(value)&&(/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(value)||/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(value)))return (/^(localhost|127\.)/.test(value)?'http://':'https://')+value;
  return 'https://www.bing.com/search?q='+encodeURIComponent(value);
}
function fail(t,message){t.error=message;t.loading=false;broadcast()}
async function navigate(t,input){const url=safeURL(input);if(!url){fail(t,'无法打开该地址。支持 http/https 网址和关键词搜索。');return}t.error='';await t.view.webContents.loadURL(url).catch(e=>{if(e.code!=='ERR_ABORTED')fail(t,e.message)})}
function select(id){if(!tabs.some(t=>t.id===id))return;activeId=id;layout();broadcast()}
function close(id){const index=tabs.findIndex(t=>t.id===id);if(index<0)return;const [t]=tabs.splice(index,1);win.contentView.removeChildView(t.view);t.view.webContents.close();if(!tabs.length){newTab();return}if(activeId===id)activeId=tabs[Math.min(index,tabs.length-1)].id;layout();broadcast()}
async function newTab(url){
  const view=new WebContentsView({webPreferences:{partition:'persist:tempo',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:true,spellcheck:false}});
  const t={id:++nextId,view,title:'新标签页',url:'',loading:true,error:'',enabled:false,rate:1,issue:'',stats:[]};
  t.ready=new Promise(resolve=>{t.resolveReady=resolve});
  tabs.push(t);win.contentView.addChildView(view);select(t.id);
  const wc=view.webContents;
  t.speed=new SpeedController(wc,msg=>{t.issue=msg;broadcast()});
  wc.on('did-start-loading',()=>{t.loading=true;t.error='';broadcast()});
  wc.on('did-stop-loading',()=>{t.loading=false;broadcast()});
  wc.on('page-title-updated',(_,title)=>{t.title=title;broadcast()});
  const update=(url,record)=>{t.url=url.startsWith('file:')?'':url;t.error='';if(record&&/^https?:/.test(url)){store.history.unshift({url,title:t.title,date:Date.now()});store.history=store.history.slice(0,2000);save()}broadcast()};
  wc.on('did-navigate',(_,url)=>update(url,true));
  wc.on('did-navigate-in-page',(_,url,isMain)=>{if(isMain)update(url,true)});
  wc.on('did-finish-load',()=>{t.title=wc.getTitle()||'无标题';const h=store.history.find(h=>h.url===t.url);if(h){h.title=t.title;save()}broadcast()});
  wc.on('did-fail-load',(_e,code,description,url,isMain)=>{if(isMain&&code!==-3)fail(t,`访问失败：${description} (${code})\n${url}`)});
  wc.on('render-process-gone',(_,details)=>fail(t,'网页进程已退出：'+details.reason+'，请刷新重试。'));
  wc.on('will-navigate',(event,url)=>{if(!/^https?:/i.test(url)){event.preventDefault();t.issue='已阻止外部协议或本地文件跳转。';broadcast()}});
  wc.setWindowOpenHandler(({url})=>{if(/^https?:/i.test(url))newTab(url);return {action:'deny'}});
  wc.on('before-input-event',(event,input)=>{if(input.type!=='keyDown')return; if(handleShortcut(input)){event.preventDefault()}});
  wc.on('context-menu',(_,params)=>{
    const template=[];
    if(params.linkURL&&/^https?:/.test(params.linkURL))template.push({label:'在新标签页打开链接',click:()=>newTab(params.linkURL)},{type:'separator'});
    template.push({label:'后退',enabled:wc.navigationHistory.canGoBack(),click:()=>wc.navigationHistory.goBack()},{label:'前进',enabled:wc.navigationHistory.canGoForward(),click:()=>wc.navigationHistory.goForward()},{label:'刷新',click:()=>wc.reload()},{type:'separator'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'});
    Menu.buildFromTemplate(template).popup({window:win});
  });
  try{
    await wc.loadURL('about:blank');
    if(wc.isDestroyed())return;
    try {await t.speed.init()}catch(e){t.issue='调速不可用：'+e.message}
    if(wc.isDestroyed())return;
    t.resolveReady();
    if(url)await navigate(t,url);else await wc.loadFile(HOME);
  }catch(e){if(!wc.isDestroyed())fail(t,e.message)}finally{t.resolveReady()}
  broadcast();return t.id;
}
async function setSpeed(tab, enabled, rate) {
  if (!tab || typeof enabled !== 'boolean' || ![1, 2, 3, 5, 10, 20].includes(rate)) return;
  await tab.ready;
  if (!tabs.includes(tab)) return;
  tab.enabled = enabled;
  tab.rate = rate;
  tab.issue = '';
  tab.previous = null;
  tab.stats = [];
  if (tab.speed) await tab.speed.set({ enabled, rate });
  broadcast();
}
function handleShortcut(input){
  if(modalOpen)return false;
  const key=input.key.toLowerCase();const ctrl=input.control||input.meta;
  if(ctrl&&key==='l'){win.webContents.send('focus-address');return true}
  if(ctrl&&key==='t'){newTab();return true}
  if(ctrl&&key==='w'){close(activeId);return true}
  if(ctrl&&key==='d'){bookmark();return true}
  if(ctrl&&(key==='h'||key==='j')){win.webContents.send('open-panel',key==='h'?'history':'downloads');return true}
  if((ctrl&&key==='r')||key==='f5'){active()?.view.webContents.reload();return true}
  if(key==='escape'){active()?.view.webContents.stop();return true}
  if(input.alt&&key==='arrowleft'){const wc=active()?.view.webContents;if(wc?.navigationHistory.canGoBack())wc.navigationHistory.goBack();return true}
  if(input.alt&&key==='arrowright'){const wc=active()?.view.webContents;if(wc?.navigationHistory.canGoForward())wc.navigationHistory.goForward();return true}
  return false;
}
function bookmark(){const t=active();if(!t||!/^https?:/.test(t.url))return;const index=store.bookmarks.findIndex(b=>b.url===t.url);if(index>=0)store.bookmarks.splice(index,1);else store.bookmarks.unshift({url:t.url,title:t.title,date:Date.now()});save();broadcast()}
function setupDownloads(ses){
  ses.on('will-download',(_event,item)=>{
    const dir=path.join(root,'Downloads');fs.mkdirSync(dir,{recursive:true});
    const name=path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
    const id=Date.now()+'-'+Math.random().toString(16).slice(2,8);let dest=path.join(dir,name);
    if(fs.existsSync(dest))dest=path.join(dir,id+'-'+name);
    item.setSavePath(dest);
    const record={id,name,path:dest,url:item.getURL(),total:item.getTotalBytes(),received:0,state:'progressing',paused:false,date:Date.now()};
    store.downloads.unshift(record);store.downloads=store.downloads.slice(0,200);liveDownloads.set(id,item);broadcast();
    item.on('updated',(_,status)=>{record.state=status;record.total=item.getTotalBytes();record.received=item.getReceivedBytes();record.paused=item.isPaused();broadcast()});
    item.once('done',(_,status)=>{record.state=status;record.received=item.getReceivedBytes();record.paused=false;liveDownloads.delete(id);save();broadcast()});
  });
}
ipcMain.handle('command',async(event,cmd,payload)=>{
  if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('不允许网页调用浏览器接口');
  const t=active();
  switch(cmd){
    case 'state':return state();
    case 'new':return newTab(typeof payload==='string'?safeURL(payload):null);
    case 'select':select(Number(payload));break;
    case 'close':close(Number(payload));break;
    case 'navigate':if(t){await t.ready;if(tabs.includes(t))await navigate(t,payload)}break;
    case 'home':if(t){await t.ready;if(tabs.includes(t))await t.view.webContents.loadFile(HOME)}break;
    case 'back':if(t?.view.webContents.navigationHistory.canGoBack())t.view.webContents.navigationHistory.goBack();break;
    case 'forward':if(t?.view.webContents.navigationHistory.canGoForward())t.view.webContents.navigationHistory.goForward();break;
    case 'reload':if(t)t.view.webContents.reload();break;
    case 'stop':if(t)t.view.webContents.stop();break;
    case 'speed':await setSpeed(t,payload?.enabled,Number(payload?.rate));break;
    case 'bookmark':bookmark();break;
    case 'remove-bookmark':store.bookmarks=store.bookmarks.filter(b=>b.url!==payload);save();broadcast();break;
    case 'theme':if(['light','dark'].includes(payload)){store.theme=payload;nativeTheme.themeSource=payload;save();broadcast()}break;
    case 'overlay':modalOpen=payload===true;layout();break;
    case 'bounds':{
      const [w,h]=win.getContentSize();const r=payload;
      if(r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)){
        const scale=win.webContents.getZoomFactor();
        const x=Math.max(0,Math.round(r.x*scale)),y=Math.max(0,Math.round(r.y*scale));
        bounds={x,y,width:Math.max(1,Math.min(w-x,Math.round(r.width*scale))),height:Math.max(1,Math.min(h-y,Math.round(r.height*scale)))};layout();
      }break;
    }
    case 'clear':{
      if(!payload||!Array.isArray(payload.types))break;
      const types=payload.types;
      if(types.includes('history'))store.history=[];
      const ses=session.fromPartition('persist:tempo');
      if(types.includes('storage'))await ses.clearStorageData();
      if(types.includes('cache'))await ses.clearCache();
      if(types.includes('downloads'))store.downloads=store.downloads.filter(d=>liveDownloads.has(d.id));
      save();store.notice='所选浏览数据已清除；已打开网页的内存状态需刷新后更新。';broadcast();break;
    }
    case 'download':{
      const d=store.downloads.find(d=>d.id===payload?.id),item=liveDownloads.get(payload?.id);
      if(payload?.action==='cancel')item?.cancel();
      if(payload?.action==='pause')item?.pause();
      if(payload?.action==='resume'&&item?.canResume())item.resume();
      if(payload?.action==='show'&&d&&fs.existsSync(d.path))shell.showItemInFolder(d.path);
      break;
    }
  }
});
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);nativeTheme.themeSource=store.theme;
  const ses=session.fromPartition('persist:tempo');
  ses.setPermissionRequestHandler((_wc,permission,callback)=>{callback(false);store.notice=`网站请求 ${permission} 权限，第一版暂未开放。`;broadcast()});
  ses.setPermissionCheckHandler(()=>false);
  setupDownloads(ses);
  win=new BrowserWindow({width:1360,height:900,minWidth:760,minHeight:580,title:'Tempo 浏览器 beta-1',backgroundColor:'#f4f6fa',webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('before-input-event',(e,input)=>{if(input.type==='keyDown'&&handleShortcut(input))e.preventDefault()});
  win.on('closed',()=>{for(const t of tabs)if(!t.view.webContents.isDestroyed())t.view.webContents.close();tabs=[];win=null});
  await win.loadFile(path.join(__dirname,'index.html'));
  await newTab();
  let sampling=false;
  setInterval(async()=>{
    const t=active();if(!t?.speed||sampling||!win)return;sampling=true;
    try{
      const stats=await t.speed.snapshot();const now=performance.now();
      const previous=t.previous;
      for(const frame of stats){
        const oldFrame=previous?.stats.find(f=>f.context===frame.context&&f.session===frame.session);
        const realElapsed=previous?(now-previous.now)/1000:0;
        if(frame.status)frame.status.observedClock=oldFrame?.status&&realElapsed>0?(frame.status.clock-oldFrame.status.clock)/1000/realElapsed:null;
        frame.status?.media.forEach((m,index)=>{
          const old=previous?.stats.find(f=>f.context===frame.context&&f.session===frame.session)?.status?.media[index];
          const elapsed=previous?(now-previous.now)/1000:0;
          const delta=old?m.time-old.time:0;
          m.observed=old&&elapsed>0&&delta>=0&&!m.paused&&!old.paused&&m.src===old.src?delta/elapsed:null;
          m.dropped=old&&m.frames!==null?m.frames-old.frames:0;
        });
      }
      t.stats=stats;t.previous={now,stats};broadcast();
    }catch(e){t.issue=e.message}finally{sampling=false}
  },1200).unref();
});
app.on('window-all-closed',()=>app.quit());
