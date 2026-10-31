const SETTING_KEY = 'daying-mini-feedback-audio-v1';
const SOURCES = { correct: '/assets/audio/correct.mp3', wrong: '/assets/audio/wrong.mp3' };
const READY_TIMEOUT = 1200;

class FeedbackAudio {
  constructor(wxAPI, onUnavailable) {
    this.wx = wxAPI;
    this.contexts = {};
    this.localSources = {};
    this.enabled = true;
    this.warned = false;
    this.onUnavailable = onUnavailable;
    try {
      const setting = this.wx.getStorageSync(SETTING_KEY);
      if (typeof setting === 'boolean') this.enabled = setting;
    } catch (_) { /* A preference read failure must not stop practice. */ }
  }
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.stop();
    try { this.wx.setStorageSync(SETTING_KEY, this.enabled); return true; }
    catch (_) { return false; }
  }
  clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  unavailable(error) {
    this.lastError = error;
    if (this.warned || this.destroyed) return;
    this.warned = true;
    if (this.onUnavailable) this.onUnavailable(error);
  }
  source(kind) {
    if (this.localSources[kind]) return this.localSources[kind];
    try {
      const root = this.wx.env && this.wx.env.USER_DATA_PATH;
      if (root && typeof this.wx.getFileSystemManager === 'function') {
        const fs = this.wx.getFileSystemManager();
        if (typeof fs.copyFileSync === 'function') {
          const target = root + '/cijian-feedback-mp3-v1-' + kind + '.mp3';
          // Refresh our tiny generated cache once per instance, including any damaged old copy.
          fs.copyFileSync(SOURCES[kind].slice(1), target);
          this.localSources[kind] = target;
          return target;
        }
      }
    } catch (_) { /* Packaged paths remain a fallback when device storage is full. */ }
    return SOURCES[kind];
  }
  play(kind) {
    if (!this.enabled || this.destroyed || !SOURCES[kind] || typeof this.wx.createInnerAudioContext !== 'function') return;
    this.stop();
    const request = { kind, attempt: 0 };
    this.pending = request;
    this.prepare(request);
  }
  prepare(request) {
    if (this.pending !== request || this.destroyed || !this.enabled) return;
    let entry = this.contexts[request.kind];
    try {
      if (!entry) {
        if (typeof this.wx.createInnerAudioContext !== 'function') throw new Error('AUDIO_UNSUPPORTED');
        const audio = this.wx.createInnerAudioContext({ useWebAudioImplement: request.attempt === 0 });
        entry = { kind: request.kind, audio, ready: typeof audio.onCanplay !== 'function' };
        this.contexts[request.kind] = entry;
        request.entry = entry;
        audio.autoplay = false; audio.loop = false; audio.obeyMuteSwitch = true; audio.volume = 0.65; audio.startTime = 0;
        if (audio.onError) audio.onError(error => this.failed(entry, error));
        if (audio.onCanplay) audio.onCanplay(() => {
          if (this.destroyed || this.contexts[entry.kind] !== entry) return;
          entry.ready = true;
          if (this.pending && this.pending.entry === entry) this.start(entry, this.pending);
        });
        if (audio.onEnded) audio.onEnded(() => {
          if (this.active === entry) { this.active = null; this.activeRequest = null; }
        });
        audio.src = request.attempt === 0 ? this.source(request.kind) : this.localSources[request.kind] || SOURCES[request.kind].slice(1);
      } else request.entry = entry;
      if (this.pending !== request || request.entry !== entry || this.contexts[request.kind] !== entry) return;
      if (entry.ready) this.start(entry, request);
      else this.timer = setTimeout(() => {
        if (this.pending === request) this.failed(entry, { errCode: 'READY_TIMEOUT', errMsg: 'Audio did not become ready' });
      }, READY_TIMEOUT);
    } catch (error) {
      if (entry) this.failed(entry, error); else this.retry(request, error);
    }
  }
  start(entry, request) {
    if (this.pending !== request || this.destroyed || !this.enabled) return;
    this.clearTimer();
    this.pending = null; this.active = entry; this.activeRequest = request;
    try { entry.audio.play(); } catch (error) { this.failed(entry, error); }
  }
  failed(entry, error) {
    if (this.destroyed || this.contexts[entry.kind] !== entry) return;
    const request = this.pending && this.pending.entry === entry ? this.pending : this.active === entry ? this.activeRequest : null;
    delete this.contexts[entry.kind];
    if (this.active === entry) { this.active = null; this.activeRequest = null; }
    try { entry.audio.destroy(); } catch (_) {}
    if (request) this.retry(request, error);
  }
  retry(request, error) {
    if (this.destroyed || !this.enabled) return;
    this.clearTimer(); this.pending = null;
    this.lastError = error;
    if (request.attempt < 1) {
      request.attempt++; request.entry = null;
      this.pending = request; this.prepare(request);
    } else this.unavailable(error);
  }
  stop() {
    this.clearTimer(); this.pending = null;
    const entry = this.active;
    this.active = null; this.activeRequest = null;
    if (entry) {
      try { entry.audio.stop(); }
      catch (_) {
        delete this.contexts[entry.kind];
        try { entry.audio.destroy(); } catch (_) {}
      }
    }
  }
  destroy() {
    this.destroyed = true; this.stop();
    const entries = this.contexts; this.contexts = {};
    Object.values(entries).forEach(entry => { try { entry.audio.destroy(); } catch (_) {} });
  }
}
module.exports = { FeedbackAudio };
