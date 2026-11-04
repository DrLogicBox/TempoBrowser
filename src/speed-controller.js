const { source } = require('./speed-hook');
class SpeedController {
  constructor(wc, onIssue) {
    this.wc = wc; this.config = { enabled: false, rate: 1 };
    this.contexts = new Map(); this.scripts = new Map(); this.sessions = new Set(['']); this.onIssue = onIssue;
  }
  command(method, params = {}, session = '') { return this.wc.debugger.sendCommand(method, params, session || undefined); }
  async init() {
    this.wc.debugger.attach('1.3');
    this.wc.debugger.on('detach', (_, reason) => this.onIssue('调速连接断开：' + reason));
    this.wc.debugger.on('message', (_event, method, params, session = '') => {
      if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) {
        this.contexts.set(`${session}:${params.context.id}`, { id: params.context.id, session, origin:params.context.origin });
      }
      if (method === 'Runtime.executionContextDestroyed') this.contexts.delete(`${session}:${params.executionContextId}`);
      if (method === 'Runtime.executionContextsCleared') for (const [key,c] of this.contexts) if(c.session===session) this.contexts.delete(key);
      if (method === 'Target.attachedToTarget') {
        const sid = params.sessionId;
        if(params.targetInfo.type === 'iframe') {
          this.sessions.add(sid);
          this.prepare(sid).catch(e=>this.onIssue('嵌入框架调速不可用：'+e.message))
            .finally(()=>this.command('Runtime.runIfWaitingForDebugger',{},sid).catch(()=>{}));
        } else this.command('Runtime.runIfWaitingForDebugger',{},sid).catch(()=>{});
      }
      if (method === 'Target.detachedFromTarget') {
        this.sessions.delete(params.sessionId); this.scripts.delete(params.sessionId);
        for (const [key,c] of this.contexts) if(c.session===params.sessionId) this.contexts.delete(key);
      }
    });
    await this.prepare('');
    await this.command('Target.setAutoAttach', {autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  }
  async prepare(session) {
    await this.command('Page.enable', {}, session);
    const script = await this.command('Page.addScriptToEvaluateOnNewDocument', { source: source(this.config) }, session);
    this.scripts.set(session, script.identifier);
    await this.command('Runtime.enable', {}, session);
  }
  set(config) {
    this.queue = (this.queue || Promise.resolve()).catch(()=>{}).then(()=>this.apply(config));
    return this.queue;
  }
  async apply(config) {
    this.config = { ...config };
    for(const session of [...this.sessions]) {
      try {
        const old = this.scripts.get(session);
        if(old) await this.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:old},session);
        const next = await this.command('Page.addScriptToEvaluateOnNewDocument',{source:source(config)},session);
        this.scripts.set(session,next.identifier);
      } catch(e) { this.onIssue('刷新后的调速预设更新失败：'+e.message); }
    }
    await Promise.allSettled([...this.contexts.values()].map(c => this.command('Runtime.evaluate', {
      expression: source(config), contextId:c.id, returnByValue:true
    }, c.session).then(result=>{if(result.exceptionDetails)throw new Error(result.exceptionDetails.text)}).catch(e=>this.onIssue('部分框架未应用：'+e.message))));
  }
  async snapshot() {
    const rows = await Promise.all([...this.contexts.values()].map(async c => {
      try {
        const result = await this.command('Runtime.evaluate', {expression:'globalThis.__tempo ? __tempo.snapshot() : null',contextId:c.id,returnByValue:true},c.session);
        return { origin:c.origin, context:c.id, session:c.session, status:result.result?.value || null };
      } catch { return null; }
    }));
    return rows.filter(Boolean);
  }
}
module.exports = { SpeedController };
