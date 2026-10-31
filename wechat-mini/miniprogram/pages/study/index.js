const vocabulary = require('../../data/vocabulary');
const core = require('../../lib/learning');
const { StudyStore } = require('../../lib/store');
const { FeedbackAudio } = require('../../lib/feedback-audio');
const config = require('../../config');
const { Appearance } = require('../../lib/appearance');
const { studyLayout } = require('../../lib/study-layout');
const { MemorizeList } = require('../../lib/memorize');
const { unitTitle } = require('../../lib/unit-label');
const byId = new Map(vocabulary.words.map(word => [word.id, word]));
const representatives = new Map();
vocabulary.words.forEach(word => { if (!representatives.has(core.wordKey(word))) representatives.set(core.wordKey(word), word); });
const STATUS = { loading: '正在读取', local: '本机保存', saving: '正在同步', synced: '微信云端已同步', offline: '离线保留中', error: '同步失败 · 点此重试', conflict: '进度待确认' };
const LABELS = { correct: '答对', wrong: '答错', skipped: '跳过', mastered: '已斩', restore: '恢复测试' };
Page({
  data: { appVersion: config.appVersion, themeMode: 'light', page: 'practice', ready: false, stageMode: false, memorizeSwipeId: '', memorizeSwipeOffset: 0, memorizeSwipeDragging: false, bodyAnchor: 'body-0', viewportHeight: 600, pageSafeBottom: 0, settingsOpen: false, helpOpen: false, keyboardShown: false, studyCardHeight: 0, studyQuestionHeight: 0, studyNavTop: 0, studyControlsHeight: 0, studyNavHeight: 48, soundEnabled: true, search: '', limit: 40, books: [], units: [], wordRows: [], history: [], answer: '', answerBlank: true, feedback: '', feedbackKind: 'info', inputFocus: false, tabs: [{ id: 'memorize', label: '背诵', mark: '▤' }, { id: 'practice', label: '默写', mark: '◫' }, { id: 'wrong', label: '生词', mark: '↺' }, { id: 'account', label: '我的', mark: '◎' }] },
  onLoad() {
    this._appearance = new Appearance(wx);
    this.setData({ themeMode: this._appearance.mode });
    this._appearance.apply();
    this._fullWindowHeight = this.windowHeight();
    this.setData({ ...this.viewportLayout(this._fullWindowHeight), ...this.stageLayout(this._fullWindowHeight, this._safeBottom) });
    this._memorize = new MemorizeList(vocabulary, wx);
    this.setData(this._memorize.view(undefined, this._viewportWidth));
    this._onKeyboardHeight = event => this.layoutKeyboard(event.height);
    if (typeof wx.onKeyboardHeightChange === 'function') wx.onKeyboardHeightChange(this._onKeyboardHeight);
    const app = getApp();
    if (typeof wx.showShareMenu === 'function') wx.showShareMenu({ menus: ['shareAppMessage'], fail() {} });
    this._audio = new FeedbackAudio(wx, () => this.notify('音效暂时不可用，练习可继续'));
    this.setData({ soundEnabled: this._audio.enabled });
    this._store = app.studyStore || new StudyStore({ wxAPI: wx, cloudEnabled: app.globalData.cloudReady, functionName: config.cloudFunction });
    app.studyStore = this._store;
    this._unsubscribe = this._store.subscribe(() => this.render());
    this.render();
    if (!this._store.view.ready) this._store.initialize();
  },
  onShow() { if (this._appearance) this._appearance.apply(); this._fullWindowHeight = this.windowHeight(); this.resetKeyboard(); this.setData(this.viewportLayout(this._fullWindowHeight)); if (this._store && this._store.view.ready) this._store.resume(); },
  onResize(event) {
    const height = event.size && event.size.windowHeight;
    if (!(height > 0)) return;
    this.setData(this.viewportLayout(height));
    if (this._keyboardHeight > 0) this.layoutKeyboard(this._keyboardHeight, height);
    else if (this._keyboardTracking && this._fullWindowHeight - height > 100) this.layoutKeyboard(this._fullWindowHeight - height, height);
    else if (!this._answerFocused) { this._fullWindowHeight = height; this.setData(this.stageLayout(height, this._safeBottom)); }
    const width = event.size.windowWidth;
    if (Number.isFinite(width)) {
      this._viewportWidth = width;
      if (this._store) this.render();
    }
  },
  onHide() { this.closeMemorizeSwipe(); this.resetKeyboard(); if (this._audio) this._audio.stop(); if (this._store) { this._store.flush(); this._store.pause(); } },
  onUnload() { this._questionMeasureKey = null; this._keyboardTracking = false; if (this._onKeyboardHeight && typeof wx.offKeyboardHeightChange === 'function') wx.offKeyboardHeightChange(this._onKeyboardHeight); if (this._unsubscribe) this._unsubscribe(); if (this._audio) this._audio.destroy(); },
  selectTheme(event) {
    const mode = event.currentTarget.dataset.value;
    if ((mode !== 'light' && mode !== 'dark') || mode === this.data.themeMode) return;
    const saved = this._appearance.select(mode);
    this.setData({ themeMode: this._appearance.mode });
    if (!saved) this.notify('外观设置未保存，请检查设备存储空间');
  },
  onShareAppMessage() { return { title: '词间默写', path: '/pages/study/index', imageUrl: '/assets/share-cover.png' }; },
  render() {
    const view = this._store.view, state = view.state, session = state.session, prefs = state.preferences;
    let word = session && byId.get(session.deck[session.index]);
    if (word && view.records[core.wordKey(word)] && view.records[core.wordKey(word)].mastered) {
      this._store.change({ ...state, session: { ...session, index: core.nextIndex(session, view.records, byId, session.index) } }); return;
    }
    const selectedBook = vocabulary.books.find(book => book.id === prefs.book) || vocabulary.books[0];
    const validUnits = prefs.units.filter(id => selectedBook.units.some(unit => unit.id === id));
    if (validUnits.length !== prefs.units.length) {
      // Older versions selected unit1.csv even for books whose files start at unit1-1.csv.
      this._store.change({ ...state, preferences: { ...prefs, units: validUnits.length ? validUnits : [selectedBook.units[0].id] } });
      return;
    }
    const finished = !!session && session.index >= session.deck.length;
    const stats = core.sessionStats(session);
    if (!word && this.data.keyboardShown) this.resetKeyboard();
    const records = Object.values(view.records);
    const rows = [];
    representatives.forEach((entry, key) => {
      const flags = view.records[key];
      if (!flags || !(this.data.page === 'mastered' ? flags.mastered : flags.wrong && !flags.mastered)) return;
      if (this.data.search && !core.normalize(entry.english).includes(core.normalize(this.data.search)) && !entry.chinese.includes(this.data.search)) return;
      rows.push({ id: entry.id, english: core.cleanEnglish(entry), chinese: core.chineseHint(entry.chinese), book: '大学英语 · 第' + ['一','二','三'][Number(entry.book.slice(-1)) - 1] + '册', unit: entry.unit.replace('.csv', '').replace('unit', 'Unit ') });
    });
    rows.sort((a,b) => a.english.localeCompare(b.english));
    const measureKey = word && word.id + ':' + session.mode + ':' + session.firstLetter + ':' + this._viewportWidth;
    const measure = this.data.page === 'practice' && !!word && (this._questionMeasureKey !== measureKey || !this.data.stageMode);
    if (measure) { this._questionMeasureKey = measureKey; this._questionContentHeight = undefined; }
    this.setData({
      ...(measure ? this.stageLayout(this._stageHeight || this._fullWindowHeight, this._stageSafeBottom) : {}),
      ...(this.data.page === 'memorize' ? this._memorize.view(view.records, this._viewportWidth) : {}),
      ready: view.ready, status: view.status, statusLabel: STATUS[view.status], cloudEnabled: this._store.enabled,
      storageError: view.storageError, lastSynced: view.lastSynced ? new Date(view.lastSynced).toLocaleTimeString() : '',
      books: vocabulary.books.map((book,index) => ({ ...book, label: '第' + ['一','二','三'][index] + '册', index, selected: prefs.book === book.id })),
      units: selectedBook.units.map(unit => ({ ...unit, title: unitTitle(unit), chosen: prefs.units.includes(unit.id) })), preferences: prefs,
      allUnits: prefs.units.length === selectedBook.units.length, selectedBookTitle: selectedBook.title,
      masteredCount: records.filter(flags => flags.mastered).length, wrongCount: records.filter(flags => flags.wrong && !flags.mastered).length,
      session: !!session, finished, stats, active: !!session && !finished, progress: session && session.deck.length ? Math.min(100, Math.round(session.index / session.deck.length * 100)) : 0,
      stageMode: this.data.page === 'practice' && !!word,
      current: session ? Math.min(session.index + 1, session.deck.length) : 0, total: session ? session.deck.length : 0,
      review: !!(session && session.review), modeLabel: session ? (session.review ? '生词复习' : session.mode === 'example' ? '例句填空' : '单词默写') : '单词默写',
      word: word ? { id: word.id, example: session.mode === 'example', chinese: core.chineseHint(word.chinese), firstLetter: session.firstLetter ? core.cleanEnglish(word)[0] : '' } : null,
      question: word ? core.questionText(word, session) : '', answer: word ? session.drafts[word.id] || '' : '',
      answerBlank: !word || !core.normalize(session.drafts[word.id] || ''),
      canPrevious: !!session && core.previousIndex(session, view.records, byId) !== session.index, canUndo: !!(session && session.cut && byId.get(session.cut.wordId) && view.records[core.wordKey(byId.get(session.cut.wordId))] && view.records[core.wordKey(byId.get(session.cut.wordId))].mastered),
      wordRows: rows.slice(0, this.data.limit), filteredCount: rows.length, hasMore: rows.length > this.data.limit,
      history: state.history.map(log => ({ ...log, label: LABELS[log.kind], time: new Date(log.at).toLocaleString(), inputLabel: log.kind === 'wrong' ? (core.normalize(log.input || '') ? log.input : '（未作答）') : '' })),
      recent: state.history.slice(0,3).map(log => ({ ...log, label: LABELS[log.kind] }))
    }, measure ? () => this.measureQuestion(measureKey) : undefined);
    if (view.conflict && !this._conflictOpen) {
      this._conflictOpen = true;
      wx.showModal({ title: '另一台设备更新了进度', content: '熟词和生词已合并。选择使用云端进度，或保留这台设备的进度。', confirmText: '使用云端', cancelText: '保留本机', success: result => { this._conflictOpen = false; this._store.resolveConflict(!result.confirm); }, fail: () => { this._conflictOpen = false; } });
    }
  },
  notify(title) { wx.showToast({ title, icon: 'none' }); },
  stageLayout(height, safeBottom = 0) {
    this._stageHeight = height;
    this._stageSafeBottom = safeBottom;
    return studyLayout(height, safeBottom, this._questionContentHeight);
  },
  measureQuestion(key) {
    if (!this.data.stageMode || typeof wx.createSelectorQuery !== 'function') return;
    try {
      wx.createSelectorQuery().in(this).select('.stage-question-content').boundingClientRect(rect => {
        if (!this.data.stageMode || this._questionMeasureKey !== key || !rect || !(rect.height > 0)) return;
        this._questionContentHeight = Math.ceil(rect.height) + 4;
        this.setData(this.stageLayout(this._stageHeight, this._stageSafeBottom));
      }).exec();
    } catch (_) { /* Keep the bounded fallback when layout information is unavailable. */ }
  },
  viewportLayout(height) {
    const safeBottom = Math.max(0, this._safeBottom || 0);
    // Normal pages use flex layout; the menu takes its actual height in the flow.
    return { viewportHeight: height, pageSafeBottom: safeBottom };
  },
  windowHeight() {
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      if (Number.isFinite(info.windowWidth)) this._viewportWidth = info.windowWidth;
      if (Number.isFinite(info.screenHeight) && info.safeArea && Number.isFinite(info.safeArea.bottom)) this._safeBottom = Math.max(0, info.screenHeight - info.safeArea.bottom);
      if (Number.isFinite(info.windowHeight) && info.windowHeight > 0) return info.windowHeight;
    } catch (_) {}
    return this._fullWindowHeight || 600;
  },
  resetKeyboard() { this._answerFocused = false; this._keyboardTracking = false; this._keyboardHeight = 0; this.setData({ keyboardShown: false, inputFocus: false, ...this.stageLayout(this._fullWindowHeight, this._safeBottom) }); wx.hideKeyboard(); },
  layoutKeyboard(height, currentHeight = this.windowHeight()) {
    if (!Number.isFinite(height) || height < 0) return;
    if (height === 0) {
      this._keyboardHeight = 0;
      this._keyboardTracking = !!this._answerFocused;
      this.setData({ keyboardShown: false, ...this.stageLayout(this._fullWindowHeight, this._safeBottom) });
      return;
    }
    if (!this._keyboardTracking || this.data.page !== 'practice' || !this.data.active) return;
    this._keyboardHeight = height;
    // Some clients overlay the keyboard; others also shrink windowHeight. Subtract only once.
    const available = Math.max(1, Math.min(currentHeight, this._fullWindowHeight - height));
    this.setData({ keyboardShown: true, ...this.stageLayout(available) });
  },
  changePage(event) { this.closeMemorizeSwipe(); this.resetKeyboard(); this.setData({ page: event.currentTarget.dataset.page, search: '', limit: 40, feedback: '' }); this.render(); this.resetBodyScroll(); },
  resetBodyScroll() { this._bodyAnchor = (this._bodyAnchor || 0) + 1; this.setData({ bodyAnchor: 'body-' + this._bodyAnchor }); },
  selectMemorize(event) { this.closeMemorizeSwipe(); if (!this._memorize.select(event.currentTarget.dataset.key, event.currentTarget.dataset.value)) this.notify('背诵设置未保存，请检查设备存储空间'); this.setData(this._memorize.view(this._store.view.records)); this.resetBodyScroll(); },
  selectMemorizeUnit(event) { const unit = this.data.memorizeUnits[Number(event.detail.value)]; if (unit) this.selectMemorize({ currentTarget: { dataset: { key: 'unit', value: unit.id } } }); },
  clearMemorizeMarks() {
    const model = this._memorize, book = model.book, unit = model.unit;
    const words = model.words();
    if (!words.some(word => model.score(word) > 0)) { this.notify('本单元没有标记'); return; }
    this.closeMemorizeSwipe();
    wx.showModal({
      title: '清除本页标记',
      content: '将当前单元全部 ' + words.length + ' 个词条的标记清零，包含尚未加载的词条。其他单元不受影响。',
      confirmText: '清除标记',
      success: result => {
        if (!result.confirm || this._memorize !== model || model.book !== book || model.unit !== unit) return;
        if (!model.clearMarks(words.map(word => word.id))) { this.notify('清除未保存，请检查设备存储空间'); return; }
        this.setData(model.view());
        this.notify('本页标记已清除');
      }
    });
  },
  revealMemorize(event) {
    if (Date.now() < (this._suppressMemorizeTapUntil || 0)) return;
    if (this.data.memorizeSwipeId) { this.closeMemorizeSwipe(); return; }
    if (!this._memorize.tap(event.currentTarget.dataset.id)) this.notify('标记未保存，请检查设备存储空间');
    this.setData(this._memorize.view());
  },
  onPageScrollLower() { if (this.data.page === 'memorize') this.moreMemorize(); },
  moreMemorize() {
    if (this.data.page !== 'memorize' || this.data.memorizeSwipeDragging || !this.data.memorizeHasMore) return;
    this._memorize.more(); this.setData(this._memorize.view(this._store.view.records));
  },
  closeMemorizeSwipe() { this._memSwipe = null; this.setData({ memorizeSwipeId: '', memorizeSwipeOffset: 0, memorizeSwipeDragging: false }); },
  onMemSwipeStart(event) {
    const point = event.touches && event.touches[0]; if (!point) return;
    const id = event.currentTarget.dataset.id;
    const base = this.data.memorizeSwipeId === id ? this.data.memorizeSwipeOffset || 0 : 0;
    this.closeMemorizeSwipe();
    this._memSwipe = { id, x: point.clientX, y: point.clientY, base, axis: null, offset: base };
    if (base) this.setData({ memorizeSwipeId: id, memorizeSwipeOffset: base });
  },
  onMemSwipeMove(event) {
    const touch = this._memSwipe, point = event.touches && event.touches[0]; if (!touch || !point) return;
    const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
    if (!touch.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) touch.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'horizontal' : 'vertical';
    if (touch.axis !== 'horizontal') return;
    touch.offset = Math.max(0, Math.min(192, touch.base + dx));
    this.setData({ memorizeSwipeId: touch.id, memorizeSwipeOffset: touch.offset, memorizeSwipeDragging: true });
  },
  onMemSwipeEnd(event) {
    const touch = this._memSwipe; if (!touch) return;
    const point = event.changedTouches && event.changedTouches[0];
    if (point && !touch.axis) this.onMemSwipeMove({ touches: [point] });
    this._memSwipe = null;
    if (touch.axis === 'horizontal') {
      this._suppressMemorizeTapUntil = Date.now() + 250;
      const open = touch.offset >= 64;
      this.setData({ memorizeSwipeId: open ? touch.id : '', memorizeSwipeOffset: open ? 192 : 0, memorizeSwipeDragging: false });
    } else this.setData({ memorizeSwipeDragging: false });
  },
  markMemorize(event) {
    if (!this._memorize.mark(event.currentTarget.dataset.id, Number(event.currentTarget.dataset.delta))) this.notify('标记未保存，请检查设备存储空间');
    this.closeMemorizeSwipe(); this.setData(this._memorize.view());
  },
  cutMemorize(event) { this.closeMemorizeSwipe(); this.cutFromList(event); },
  addMemorizeNovice(event) {
    const word = byId.get(event.currentTarget.dataset.id);
    if (!word) return;
    this.closeMemorizeSwipe();
    const view = this._store.view, key = core.wordKey(word);
    if ((view.records[key] || {}).wrong) { this.notify('已在生词本'); return; }
    // A manual vocabulary addition is not an incorrect dictation answer.
    this._store.change(view.state, [{ key, kind: 'wrong' }]);
    this.notify('已加入生词本');
  },
  toggleSettings() { this.resetKeyboard(); this.setData({ settingsOpen: !this.data.settingsOpen }); },
  closeSettings() { this.setData({ settingsOpen: false }); },
  ignoreTap() {},
  updatePreferences(patch) { const state = this._store.view.state; this._store.change({ ...state, preferences: { ...state.preferences, ...patch } }); },
  selectBook(event) { const book = vocabulary.books.find(item => item.id === event.currentTarget.dataset.id); if (book) this.updatePreferences({ book: book.id, units: [book.units[0].id] }); },
  selectUnit(event) { const units = this._store.view.state.preferences.units, id = event.currentTarget.dataset.id; this.updatePreferences({ units: units.includes(id) ? units.filter(unit => unit !== id) : units.concat(id) }); },
  toggleUnits() { const selected = vocabulary.books.find(book => book.id === this._store.view.state.preferences.book); this.updatePreferences({ units: this.data.allUnits ? [] : selected.units.map(unit => unit.id) }); },
  selectOption(event) { this.updatePreferences({ [event.currentTarget.dataset.key]: event.currentTarget.dataset.value }); },
  switchOption(event) { this.updatePreferences({ [event.currentTarget.dataset.key]: event.detail.value }); },
  onSoundChange(event) { const saved = this._audio.setEnabled(event.detail.value); this.setData({ soundEnabled: this._audio.enabled }); if (!saved) this.notify('音效设置未保存，请检查设备存储空间'); },
  begin(event) {
    const review = !!(event && event.currentTarget.dataset.review);
    const view = this._store.view;
    if (!review && !view.state.preferences.units.length) { this.notify('请至少选择一个单元'); this.setData({ settingsOpen: true }); return; }
    const session = core.makeSession(vocabulary, view.state.preferences, view.records, review);
    if (!session.deck.length) { this.notify(review ? '没有待复习的生词' : '没有符合筛选的待测词'); return; }
    const start = () => { this.resetKeyboard(); this.setData({ page: 'practice', settingsOpen: false, feedback: '' }); this._store.change({ ...this._store.view.state, session }); this.resetBodyScroll(); };
    const old = view.state.session;
    if (old && old.index < old.deck.length) wx.showModal({ title: '开始新一轮？', content: '会替换当前练习进度，已有熟词和生词保留。', success: result => { if (result.confirm) start(); } });
    else start();
  },
  onInput(event) { const state = this._store.view.state, session = state.session; if (!session) return; const id = session.deck[session.index]; if (id) this._store.change({ ...state, session: { ...session, drafts: { ...session.drafts, [id]: event.detail.value } } }, [], 1800); },
  onInputFocus(event) { this._answerFocused = true; this._keyboardTracking = true; if (event && event.detail.height > 0) this.layoutKeyboard(event.detail.height); },
  onKeyboard(event) { this.layoutKeyboard(event.detail.height); },
  onInputBlur() { this._answerFocused = false; if (!this._keyboardHeight) this._keyboardTracking = false; this.setData({ inputFocus: false }); },
  log(state, word, kind, input) { return [{ id: core.makeId(), english: core.cleanEnglish(word), kind, at: Date.now(), ...(kind === 'wrong' ? { input: input || '' } : {}) }, ...state.history].slice(0,100); },
  confirmAnswer(event) { this.submit(event); },
  submit(event) {
    const view = this._store.view, session = view.state.session;
    const word = session && byId.get(session.deck[session.index]); if (!word) return;
    const value = event && event.detail && event.detail.value;
    // Native form/confirm values are authoritative, including an explicitly empty string.
    const input = typeof value === 'string' ? value : value && typeof value.answer === 'string' ? value.answer : session.drafts[word.id] || '';
    const blank = !core.normalize(input);
    const correct = !blank && core.normalize(input) === core.wordKey(word);
    this._audio.play(correct ? 'correct' : 'wrong');
    const operations = !correct ? [{ key: core.wordKey(word), kind: 'wrong' }] : session.review ? [{ key: core.wordKey(word), kind: 'resolved' }] : [];
    this.setData({ feedbackKind: correct ? 'success' : 'error', feedback: correct ? '回答正确 · ' + core.cleanEnglish(word) : (blank ? '空白已计错 · ' : '') + '正确答案：' + core.cleanEnglish(word) + (session.retry ? ' · 再试一次' : ' · 已记入生词'), inputFocus: true });
    this._store.change({ ...view.state, session: { ...session, drafts: { ...session.drafts, [word.id]: input }, results: { ...session.results, [word.id]: correct ? 'correct' : 'wrong' }, index: correct || !session.retry ? core.nextIndex(session, view.records, byId) : session.index }, history: this.log(view.state, word, correct ? 'correct' : 'wrong', correct ? '' : input) }, operations);
  },
  previous() { const view = this._store.view, session = view.state.session; if (!session) return; const index = core.previousIndex(session, view.records, byId); if (index === session.index) { this.notify('已经是第一个待测词'); return; } this.setData({ feedback: '' }); this._store.change({ ...view.state, session: { ...session, index } }); },
  skip() { this.advance('skipped'); }, cut() { this.advance('mastered'); },
  advance(kind) {
    const view = this._store.view, session = view.state.session, word = session && byId.get(session.deck[session.index]); if (!word) return;
    const operation = { key: core.wordKey(word), kind: 'mastered' };
    const records = kind === 'mastered' ? core.applyOperation(view.records, operation) : view.records;
    const next = { ...session, results: { ...session.results, [word.id]: kind }, index: core.nextIndex(session, records, byId), ...(kind === 'mastered' ? { cut: { wordId: word.id, index: session.index, previousResult: session.results[word.id] } } : {}) };
    this.setData({ feedbackKind: kind === 'mastered' ? 'success' : 'info', feedback: kind === 'mastered' ? '已斩「' + core.cleanEnglish(word) + '」，后续不再测试。' : '已跳过，原有生词记录保留。' });
    this._store.change({ ...view.state, session: next, history: this.log(view.state, word, kind) }, kind === 'mastered' ? [operation] : []);
  },
  undoCut() {
    const view = this._store.view, session = view.state.session; if (!session || !session.cut) return;
    const word = byId.get(session.cut.wordId); if (!word) return;
    const results = { ...session.results }; if (session.cut.previousResult) results[word.id] = session.cut.previousResult; else delete results[word.id];
    this.setData({ feedback: '已撤销斩词，回到该词继续练习。', feedbackKind: 'info' });
    this._store.change({ ...view.state, session: { ...session, results, index: session.cut.index, cut: null }, history: this.log(view.state, word, 'restore') }, [{ key: core.wordKey(word), kind: 'restore' }]);
  },
  restoreWord(event) { const word = byId.get(event.currentTarget.dataset.id); if (!word) return; const view = this._store.view; this._store.change({ ...view.state, history: this.log(view.state, word, 'restore') }, [{ key: core.wordKey(word), kind: 'restore' }]); this.notify('已恢复，下次练习重新测试'); },
  cutFromList(event) { const word = byId.get(event.currentTarget.dataset.id); if (!word) return; const view = this._store.view; this._store.change({ ...view.state, history: this.log(view.state, word, 'mastered') }, [{ key: core.wordKey(word), kind: 'mastered' }]); this.notify('已加入熟词'); },
  searchWords(event) { this.setData({ search: event.detail.value, limit: 40 }); this.render(); },
  loadMore() { this.setData({ limit: this.data.limit + 60 }); this.render(); },
  syncNow() { if (this._store.enabled) this._store.flush(); else this.notify(this._store.persist() ? '学习记录已保存在当前设备' : '保存失败，请检查设备存储空间'); },
  showHelp() { this.resetKeyboard(); this.setData({ helpOpen: true }); }, closeHelp() { this.setData({ helpOpen: false }); },
  exportBackup() {
    const view = this._store.view;
    const content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), state: view.state, records: view.records, memorize: this._memorize.exportState() }, null, 2);
    const filePath = wx.env.USER_DATA_PATH + '/daying-backup-' + Date.now() + '.json';
    wx.getFileSystemManager().writeFile({ filePath, data: content, encoding: 'utf8', success: () => {
      if (wx.shareFileMessage) wx.shareFileMessage({ filePath, fileName: '词间默写-学习备份.json', fail: () => this.notify('已生成备份，可在开发者工具本地文件查看') });
      else this.notify('已生成备份文件，请更新微信后使用分享');
    }, fail: () => this.notify('备份生成失败，请检查存储空间') });
  },
  importBackup() {
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: result => {
      const file = result.tempFiles[0]; if (!file || file.size > 2000000) { this.notify('请选择小于 2MB 的 JSON 备份'); return; }
      wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: response => {
        try {
          const backup = JSON.parse(response.data); if (backup.version !== 1 || !backup.records || typeof backup.records !== 'object' || Array.isArray(backup.records)) throw new Error();
          const operations = [];
          Object.entries(backup.records).forEach(([key,flags]) => { if (!representatives.has(key) || !flags || typeof flags !== 'object') return; if (flags.mastered === true) operations.push({ key, kind: 'mastered' }); if (flags.wrong === true) operations.push({ key, kind: 'wrong' }); });
          const scoresSaved = !backup.memorize || this._memorize.mergeScores(backup.memorize.scores, backup.memorize.version);
          this._store.change(this._store.view.state, operations); this.notify(scoresSaved ? '已合并熟词、生词和标记' : '标记未保存，请检查存储空间');
        } catch (error) { this.notify('不是可识别的学习备份'); }
      }, fail: () => this.notify('无法读取这个备份') });
    }, fail: error => { if (!/cancel/.test(error.errMsg || '')) this.notify('暂时无法选择文件'); } });
  }
});
