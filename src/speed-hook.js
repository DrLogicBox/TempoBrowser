/* Serialized into a sandboxed web page. No Node or host capabilities. */
function installTempo(initial) {
  if (globalThis.__tempo) { globalThis.__tempo.set(initial); return; }
  const NativeDate = Date;
  const realNow = performance.now.bind(performance);
  const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
  const interval = window.setInterval.bind(window);
  const raf = window.requestAnimationFrame.bind(window);
  const mediaRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  const nativeAnimate = Element.prototype.animate;
  const nativeAnimationRate = Animation.prototype.updatePlaybackRate;
  const timers = new Map(), media = new Set(), animations = new Map();
  let serial = 1000000000, realAnchor = realNow(), virtualAnchor = realAnchor;
  const epoch = NativeDate.now() - realAnchor;
  let config = { enabled: false, rate: 1 }, pageRate = 1, lastError = '';
  const virtualNow = () => virtualAnchor + (realNow() - realAnchor) * pageRate;
  function VirtualDate(...args) {
    if (!new.target) return new NativeDate(epoch + virtualNow()).toString();
    return Reflect.construct(NativeDate, args.length ? args : [epoch + virtualNow()], new.target);
  }
  Object.setPrototypeOf(VirtualDate, NativeDate);
  VirtualDate.prototype = NativeDate.prototype;
  VirtualDate.now = () => epoch + virtualNow();
  window.Date = VirtualDate;
  Object.defineProperty(performance, 'now', { configurable: true, value: virtualNow });
  function schedule(id) {
    const item = timers.get(id);
    if (!item) return;
    clear(item.handle);
    item.handle = timeout(() => {
      if (!timers.has(id)) return;
      if (item.period === null) timers.delete(id);
      try {
        if (typeof item.callback === 'function') item.callback(...item.args);
        else (0, eval)(String(item.callback));
      } finally {
        if (item.period !== null && timers.has(id)) {
          item.due = virtualNow() + item.period;
          schedule(id);
        }
      }
    }, Math.max(0, (item.due - virtualNow()) / pageRate));
  }
  function addTimer(callback, delay, period, args) {
    const id = ++serial, ms = Math.min(2147483647, Math.max(0, Number(delay) || 0));
    timers.set(id, { callback, args, due: virtualNow() + ms, period: period ? ms : null });
    schedule(id); return id;
  }
  window.setTimeout = (cb, ms, ...args) => addTimer(cb, ms, false, args);
  window.setInterval = (cb, ms, ...args) => addTimer(cb, ms, true, args);
  window.clearTimeout = window.clearInterval = id => {
    const item = timers.get(id);
    if (item) { clear(item.handle); timers.delete(id); } else clear(id);
  };
  window.requestAnimationFrame = callback => raf(() => callback(virtualNow()));
  function applyMedia(el) {
    media.add(el);
    const wanted = config.enabled ? config.rate : 1;
    try {
      if (mediaRate.get.call(el) !== wanted) mediaRate.set.call(el, wanted);
      if (el.defaultPlaybackRate !== wanted) el.defaultPlaybackRate = wanted;
      el.__tempoError = '';
    } catch (error) { el.__tempoError = error.message; }
  }
  function watch(el) {
    if (!media.has(el)) {
      el.addEventListener('ratechange', () => applyMedia(el));
      el.addEventListener('loadedmetadata', () => applyMedia(el));
      el.addEventListener('play', () => applyMedia(el));
    }
    applyMedia(el);
  }
  function applyAnimation(animation) {
    if (!animations.has(animation)) animations.set(animation, animation.playbackRate || 1);
    const wanted = animations.get(animation) * pageRate;
    if (animation.playbackRate !== wanted) nativeAnimationRate.call(animation, wanted);
  }
  Element.prototype.animate = function (...args) {
    const animation = nativeAnimate.apply(this, args);
    applyAnimation(animation); return animation;
  };
  function scan(root = document) {
    root.querySelectorAll('video,audio').forEach(watch);
    root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) scan(el.shadowRoot); });
    if (root.getAnimations) root.getAnimations().forEach(applyAnimation);
  }
  let pendingScan = false;
  const observer = new MutationObserver(() => {
    if (pendingScan) return;
    pendingScan = true;
    timeout(() => { pendingScan = false; scan(); }, 0);
  });
  observer.observe(document, { childList: true, subtree: true });
  interval(() => {
    media.forEach(el => { if (!el.isConnected) media.delete(el); else applyMedia(el); });
    document.getAnimations().forEach(applyAnimation);
    animations.forEach((_, a) => { if (a.playState === 'finished' || a.playState === 'idle') animations.delete(a); });
  }, 250);
  const api = {
    set(next) {
      if (typeof next.enabled !== 'boolean' || ![1,2,3,5,10,20].includes(next.rate)) return;
      const now = realNow(); virtualAnchor = virtualNow(); realAnchor = now;
      config = { enabled: next.enabled, rate: next.rate };
      pageRate = config.enabled ? config.rate : 1;
      timers.forEach((_, id) => schedule(id));
      scan(); media.forEach(applyMedia); animations.forEach((_, a) => applyAnimation(a));
    },
    snapshot() {
      return {
        enabled: config.enabled, requested: config.rate, effectiveRate: pageRate,
        pageClockRate: pageRate, clock: virtualNow(), error: lastError,
        media: [...media].filter(el => el.isConnected).map(el => ({
          tag: el.tagName, actual: mediaRate.get.call(el), time: el.currentTime,
          paused: el.paused, ended: el.ended, readyState: el.readyState,
          error: el.__tempoError || (el.error ? el.error.message : ''),
          frames: el.getVideoPlaybackQuality ? el.getVideoPlaybackQuality().droppedVideoFrames : null,
          muted: el.muted, src: (el.currentSrc || '').slice(0, 180)
        }))
      };
    }
  };
  Object.defineProperty(globalThis, '__tempo', { value: api, configurable: false });
  try { api.set(initial); } catch (e) { lastError = e.message; }
}
module.exports = { installTempo, source: config => `(${installTempo.toString()})(${JSON.stringify(config)})` };
