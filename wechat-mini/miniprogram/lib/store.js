const { EMPTY_STUDY, parseStudyState, applyOperation, makeId } = require('./learning');
const clone = value => JSON.parse(JSON.stringify(value));
class StudyStore {
  constructor(options) {
    this.wx = options.wxAPI;
    this.enabled = !!options.cloudEnabled;
    this.transport = options.transport || (data => this.wx.cloud.callFunction({ name: options.functionName || 'studySync', data }).then(response => response.result));
    this.view = { state: clone(EMPTY_STUDY), records: {}, ready: false, status: this.enabled ? 'loading' : 'local', conflict: null, storageError: false, lastSynced: null };
    this.key = 'daying-mini-local-v1'; this.userKey = null; this.queue = []; this.revision = 0; this.sequence = 0; this.dirty = false; this.busy = false; this.online = true; this.listeners = []; this.timer = null; this.interval = null;
    this.onNetwork = event => { this.online = !!event.isConnected; if (this.online) this.flush(); else this.emit({ status: this.enabled ? 'offline' : 'local' }); };
  }
  subscribe(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter(item => item !== listener); }; }
  emit(patch) { this.view = Object.assign({}, this.view, patch); this.listeners.slice().forEach(listener => listener(this.view)); }
  readCache(key) {
    const cached = this.wx.getStorageSync(key);
    if (cached && cached.version === 1 && parseStudyState(cached.state)) return cached;
    return null;
  }
  loadCache(key) {
    try {
      const cached = this.readCache(key);
      this.key = key;
      if (!cached) return;
      this.queue = Array.isArray(cached.queue) ? cached.queue.filter(operation => operation && typeof operation.id === 'string' && typeof operation.key === 'string' && ['wrong','mastered','restore','resolved'].includes(operation.kind)) : [];
      this.revision = Number.isInteger(cached.revision) ? cached.revision : 0;
      this.dirty = !!cached.dirty;
      this.emit({ state: cached.state, records: cached.records || {}, lastSynced: cached.lastSynced || null });
    } catch (error) { this.emit({ storageError: true }); }
  }
  persist() {
    try {
      this.wx.setStorageSync(this.key, { version: 1, state: this.view.state, records: this.view.records, queue: this.queue, revision: this.revision, dirty: this.dirty, lastSynced: this.view.lastSynced });
      if (this.view.storageError) this.emit({ storageError: false });
      return true;
    } catch (error) { this.emit({ storageError: true }); return false; }
  }
  async initialize() {
    if (this.wx.onNetworkStatusChange) this.wx.onNetworkStatusChange(this.onNetwork);
    if (!this.enabled) { this.loadCache(this.key); this.emit({ ready: true, status: 'local' }); return; }
    await this.flush();
    if (!this.view.ready) { this.loadCache('daying-mini-local-v1'); this.emit({ ready: true, status: this.online ? 'error' : 'offline' }); }
    this.resume(false);
  }
  resume(syncNow = true) {
    if (!this.enabled) return;
    if (!this.interval) this.interval = setInterval(() => this.flush(), 20000);
    if (syncNow && this.view.ready) this.flush();
  }
  pause() { this.persist(); if (this.interval) clearInterval(this.interval); this.interval = null; }
  destroy() { this.pause(); if (this.timer) clearTimeout(this.timer); if (this.wx.offNetworkStatusChange) this.wx.offNetworkStatusChange(this.onNetwork); }
  change(state, operations, delay) {
    let records = this.view.records;
    (operations || []).forEach(operation => { const queued = Object.assign({ id: makeId() }, operation); this.queue.push(queued); records = applyOperation(records, queued); });
    this.sequence++; this.dirty = true;
    this.emit({ state, records, status: this.enabled ? (this.online ? 'saving' : 'offline') : 'local' });
    this.persist();
    if (this.enabled) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), delay === undefined ? 650 : delay); }
  }
  resolveConflict(useLocal) {
    if (!this.view.conflict) return;
    if (!useLocal) { this.emit({ state: this.view.conflict }); this.dirty = false; }
    else { this.sequence++; this.dirty = true; }
    this.emit({ conflict: null, status: 'saving' }); this.persist(); this.flush();
  }
  async flush() {
    if (!this.enabled || this.busy || this.view.conflict) return;
    if (!this.online) { this.emit({ status: 'offline' }); return; }
    this.busy = true; this.emit({ status: 'saving' });
    try {
      if (!this.userKey) {
        const cloud = await this.transport({ action: 'read' });
        if (!cloud || !cloud.ok || typeof cloud.userKey !== 'string') throw new Error('CLOUD_UNAVAILABLE');
        this.userKey = cloud.userKey;
        this.loadCache('daying-mini-user-v1:' + this.userKey);
        // 本地体验或临时离线产生的操作在确认微信身份后才合并，绝不猜测账号。
        const local = this.readCache('daying-mini-local-v1');
        const hasLocal = local && Array.isArray(local.queue) && (local.queue.length || local.dirty);
        if (hasLocal) {
          const queued = new Set(this.queue.map(operation => operation.id));
          this.queue = this.queue.concat(local.queue.filter(operation => !queued.has(operation.id)));
          if (local.dirty && !this.dirty) { this.emit({ state: local.state }); this.dirty = true; }
        }
        let records = cloud.records || {};
        this.queue.forEach(operation => { records = applyOperation(records, operation); });
        if (!this.dirty) this.revision = cloud.revision;
        this.emit({ ready: true, records, state: !this.dirty && cloud.state ? cloud.state : this.view.state });
        // 先确认新账号备份写入成功，再删除旧副本，避免存储空间不足时丢失记录。
        if (hasLocal && this.persist()) this.wx.removeStorageSync('daying-mini-local-v1');
      }
      const sequence = this.sequence;
      const operations = this.queue.slice(0, 30);
      const sendsState = this.dirty;
      const response = await this.transport(sendsState || operations.length ? { action: 'sync', operations, ...(sendsState ? { state: this.view.state, baseRevision: this.revision } : {}) } : { action: 'read' });
      if (!response || !response.ok || response.userKey !== this.userKey || !Number.isInteger(response.revision)) throw new Error('CLOUD_UNAVAILABLE');
      const acknowledged = new Set(response.acknowledged || []);
      this.queue = this.queue.filter(operation => !acknowledged.has(operation.id));
      let records = response.records || {};
      this.queue.forEach(operation => { records = applyOperation(records, operation); });
      this.revision = response.revision;
      const remote = response.state ? parseStudyState(response.state) : null;
      if (response.conflict && remote) this.emit({ records, ready: true, conflict: remote, status: 'conflict', lastSynced: Date.now() });
      else {
        const unchanged = this.sequence === sequence;
        if (sendsState && unchanged) this.dirty = false;
        this.emit({ records, ready: true, state: unchanged && remote ? remote : this.view.state, status: this.queue.length || this.dirty ? 'saving' : 'synced', lastSynced: Date.now() });
      }
      this.persist();
    } catch (error) { this.emit({ status: this.online ? 'error' : 'offline' }); }
    finally {
      this.busy = false;
      if (this.enabled && !this.view.conflict && this.view.status === 'saving' && (this.queue.length || this.dirty)) this.timer = setTimeout(() => this.flush(), 500);
    }
  }
}
module.exports = { StudyStore };
