const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
function startFixture() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if(url.pathname==='/slow'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.write('<title>慢速加载测试</title><p>等待结束</p>');
      const timer=setTimeout(()=>res.end('done'),30000);res.on('close',()=>clearTimeout(timer));return;
    }
    if (url.pathname === '/download') {
      res.writeHead(200, { 'Content-Type':'application/octet-stream', 'Content-Disposition':'attachment; filename="tempo-test.bin"', 'Content-Length':1048576 });
      let sent = 0; const timer = setInterval(() => { if (sent >= 1048576) { clearInterval(timer); res.end(); } else { res.write(Buffer.alloc(65536, 84)); sent += 65536; } }, 40);
      res.on('close', () => clearInterval(timer)); return;
    }
    if (url.pathname === '/media.webm') {
      const file = path.join(__dirname, 'media.webm');
      const size = fs.statSync(file).size;
      const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = match ? Number(match[1]) : 0, end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      res.writeHead(match ? 206 : 200, { 'Content-Type':'video/webm', 'Accept-Ranges':'bytes', 'Content-Length':end-start+1, ...(match ? {'Content-Range':`bytes ${start}-${end}/${size}`} : {}) });
      fs.createReadStream(file, { start, end }).pipe(res); return;
    }
    if (url.pathname === '/login') { res.setHeader('Set-Cookie', 'tempoLogin=verified; Max-Age=86400; SameSite=Lax; Path=/'); res.end('cookie set'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/frame') { res.end('<!doctype html><title>frame</title><video id="fv" muted loop src="/media.webm"></video><script>window.tick=0;setInterval(()=>tick++,1000);document.querySelector("video").play()</script>'); return; }
    res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>Tempo 可控验收页</title><style>body{font:16px "Segoe UI",sans-serif;background:#eef3f8;color:#172638;padding:28px}video{width:240px;border-radius:12px}.box{width:80px;height:30px;background:#087e8b;animation:move 1000s linear infinite}@keyframes move{to{transform:translateX(500px)}}iframe{width:300px;height:170px;border:1px solid #ccc}</style><h1>Tempo · 调速实验室</h1><p>视频 / 动态播放器 / CSS & Web Animations / 真实本地倒计时 / 嵌入框架</p><video id="video" src="/media.webm" muted loop controls></video><div id="dynamic"></div><div class="box"></div><div id="wa">Web Animation</div><p id="counter"></p><a href="/download">下载 1 MiB 测试文件</a><iframe id="same" src="/frame"></iframe><iframe id="cross" src="http://localhost:${server.address().port}/frame"></iframe><script>
      window.ticks=0; window.rafTime=0; window.started=Date.now(); window.perfStart=performance.now();
      window.wa=document.querySelector('#wa').animate([{opacity:0.2},{opacity:1}],{duration:1000000,iterations:Infinity});
      setInterval(()=>{ticks++;document.querySelector('#counter').textContent='剩余 '+(10000-ticks)+' 秒；Date 进度 '+((Date.now()-started)/1000).toFixed(2)},1000);
      function frame(t){window.rafTime=t;requestAnimationFrame(frame)} requestAnimationFrame(frame);
      window.addVideo=()=>{const v=document.createElement('video');v.id='dynamicVideo';v.muted=true;v.loop=true;v.src='/media.webm';document.querySelector('#dynamic').replaceChildren(v);return v.play()};
      window.measure=()=>({video:document.querySelector('#video').currentTime,dynamic:document.querySelector('#dynamicVideo')?.currentTime,audio:document.querySelector('audio')?.currentTime,date:Date.now(),perf:performance.now(),ticks,raf:rafTime,css:document.querySelector('.box').getAnimations()[0].currentTime,wa:wa.currentTime,tempo:__tempo.snapshot()});
      document.querySelector('#video').play();
    </script></html>`);
  });
  return new Promise(resolve => server.listen(0, '0.0.0.0', () => resolve({ server, url:`http://127.0.0.1:${server.address().port}` })));
}
module.exports = { startFixture };
