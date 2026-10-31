const clone = value => structuredClone(value);
function memoryDatabase() {
  let documents = new Map();
  let gate = Promise.resolve();
  const context = map => ({ collection: name => ({ doc: id => ({
    get: async () => ({ data: clone(map.get(name + '/' + id) || null) }),
    set: async ({ data }) => { map.set(name + '/' + id, clone(data)); }
  }) }) });
  return {
    collection: name => context(documents).collection(name),
    runTransaction(run) {
      const job = gate.then(async () => {
        const staged = clone(documents);
        const result = await run(context(staged));
        documents = staged;
        return result;
      });
      gate = job.catch(() => {});
      return job;
    },
    count: () => documents.size
  };
}
function nativeAPI(storage = new Map()) {
  const listeners = new Set();
  const keyboardListeners = new Set();
  return {
    storage, listeners, keyboardListeners, toasts: [],
    getStorageSync: key => clone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, clone(value)),
    removeStorageSync: key => storage.delete(key),
    onNetworkStatusChange: fn => listeners.add(fn),
    offNetworkStatusChange: fn => listeners.delete(fn),
    onKeyboardHeightChange: fn => keyboardListeners.add(fn),
    offKeyboardHeightChange: fn => keyboardListeners.delete(fn),
    emitKeyboard: height => keyboardListeners.forEach(fn => fn({height})),
    showToast(options) { this.toasts.push(options.title); },
    showModal: options => options.success({ confirm: true }),
    hideKeyboard() {}, pageScrollTo() {}
  };
}
module.exports = { clone, memoryDatabase, nativeAPI };
