const crypto = require('node:crypto');
const { parseStudyState, applyOperation, normalize } = require('./learning');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function documentValue(response) { const data = response && response.data; return Array.isArray(data) ? data[0] || null : data || null; }
function parseProfile(profile) {
  if (!profile) return { state: null, records: {}, revision: 0 };
  return { state: profile.stateJSON ? JSON.parse(profile.stateJSON) : null, records: profile.recordsJSON ? JSON.parse(profile.recordsJSON) : {}, revision: profile.revision || 0 };
}
function validate(event) {
  if (!event || typeof event !== 'object' || !['read', 'sync'].includes(event.action)) throw new Error('INVALID_REQUEST');
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > 900000) throw new Error('PAYLOAD_TOO_LARGE');
  const operations = event.operations || [];
  if (!Array.isArray(operations) || operations.length > 30) throw new Error('INVALID_OPERATIONS');
  const unique = new Set();
  for (const operation of operations) {
    if (!operation || typeof operation.id !== 'string' || !/^[a-zA-Z0-9-]{1,90}$/.test(operation.id)
      || typeof operation.key !== 'string' || !operation.key || operation.key.length > 256
      || operation.key !== normalize(operation.key) || ['__proto__','constructor','prototype'].includes(operation.key)
      || !['wrong','mastered','restore','resolved'].includes(operation.kind) || unique.has(operation.id)) throw new Error('INVALID_OPERATIONS');
    unique.add(operation.id);
  }
  if (event.state !== undefined && (!parseStudyState(event.state) || !Number.isInteger(event.baseRevision) || event.baseRevision < 0)) throw new Error('INVALID_STATE');
  return operations;
}
function createHandler({ db, getOpenid }) {
  return async event => {
    try {
      // 身份只来自微信运行上下文；客户端传入的 openid/userId 一律不参与授权。
      const openid = getOpenid();
      if (!openid || typeof openid !== 'string') return { ok: false, code: 'UNAUTHENTICATED' };
      const operations = validate(event);
      const profileId = digest('profile:' + openid);
      if (event.action === 'read') {
        const existing = documentValue(await db.collection('study_profiles').doc(profileId).get());
        return { ok: true, userKey: profileId, ...parseProfile(existing), acknowledged: [], conflict: false };
      }
      const result = await db.runTransaction(async transaction => {
        const ref = transaction.collection('study_profiles').doc(profileId);
        const profile = parseProfile(documentValue(await ref.get()));
        const pending = [];
        for (const operation of operations) {
          const eventId = digest('event:' + openid + ':' + operation.id);
          const eventRef = transaction.collection('study_events').doc(eventId);
          const existing = documentValue(await eventRef.get());
          if (existing && (existing.key !== operation.key || existing.kind !== operation.kind)) throw new Error('EVENT_ID_REUSED');
          if (!existing) pending.push({ operation, eventRef });
        }
        let records = profile.records;
        for (const item of pending) records = applyOperation(records, item.operation);
        const hasState = event.state !== undefined;
        const conflict = hasState && event.baseRevision !== profile.revision;
        const state = hasState && !conflict ? event.state : profile.state;
        const revision = hasState && !conflict ? profile.revision + 1 : profile.revision;
        const stateJSON = JSON.stringify(state);
        const recordsJSON = JSON.stringify(records);
        if (Buffer.byteLength(stateJSON + recordsJSON, 'utf8') > 850000) throw new Error('PAYLOAD_TOO_LARGE');
        for (const { operation, eventRef } of pending) await eventRef.set({ data: { key: operation.key, kind: operation.kind, createdAt: Date.now() } });
        if (pending.length || (hasState && !conflict)) await ref.set({ data: { stateJSON, recordsJSON, revision, updatedAt: Date.now() } });
        return { ok: true, userKey: profileId, state, records, revision, conflict, acknowledged: operations.map(operation => operation.id) };
      });
      return result && result.ok ? result : result.result;
    } catch (error) {
      const known = ['INVALID_REQUEST','INVALID_OPERATIONS','INVALID_STATE','PAYLOAD_TOO_LARGE','EVENT_ID_REUSED'];
      if (!known.includes(error.message)) console.error('studySync failed', error);
      return { ok: false, code: known.includes(error.message) ? error.message : 'CLOUD_UNAVAILABLE' };
    }
  };
}
module.exports = { createHandler, validate };
