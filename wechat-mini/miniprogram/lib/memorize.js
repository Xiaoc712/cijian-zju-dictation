const core = require('./learning');
const { unitTitle } = require('./unit-label');
const { pronunciation } = require('./pronunciation');
const { englishFontSize } = require('./memory-layout');
const MODES = ['both', 'chinese', 'english'];
const ORDERS = ['sequential', 'random', 'proficiency'];
const STORAGE_KEY = 'daying-mini-memorize-v2';
const LEGACY_STORAGE_KEY = 'daying-mini-memorize-v1';
class MemorizeList {
  constructor(vocabulary, wxAPI) {
    this.vocabulary = vocabulary;
    this.wx = wxAPI;
    let saved;
    try {
      saved = wxAPI.getStorageSync(STORAGE_KEY);
      if (!saved || saved.version !== 2) saved = wxAPI.getStorageSync(LEGACY_STORAGE_KEY);
    } catch (_) {}
    saved = saved && typeof saved === 'object' ? saved : {};
    const book = vocabulary.books.find(item => item.id === saved.book) || vocabulary.books[0];
    this.book = book.id;
    this.unit = book.units.some(item => item.id === saved.unit) ? saved.unit : book.units[0].id;
    this.mode = MODES.includes(saved.mode) ? saved.mode : 'both';
    this.order = ORDERS.includes(saved.order) ? saved.order : 'sequential';
    this.knownIds = new Set(vocabulary.words.map(word => word.id));
    this.scores = this.cleanScores(saved.scores, saved.version === 2 ? 2 : 1);
    this.records = {};
    this.limit = 40;
    this.revealed = new Set();
    this.width = 393;
  }
  save() {
    try {
      this.wx.setStorageSync(STORAGE_KEY, { version: 2, book: this.book, unit: this.unit, mode: this.mode, order: this.order, scores: this.scores });
      return true;
    } catch (_) { return false; }
  }
  select(key, value) {
    if (key === 'book') {
      const book = this.vocabulary.books.find(item => item.id === value);
      if (!book) return true;
      this.book = book.id; this.unit = book.units[0].id;
    } else if (key === 'unit') {
      const book = this.vocabulary.books.find(item => item.id === this.book);
      if (!book.units.some(item => item.id === value)) return true;
      this.unit = value;
    } else if (key === 'mode' && MODES.includes(value)) this.mode = value;
    else if (key === 'order' && ORDERS.includes(value)) this.order = value;
    else return true;
    if (key !== 'mode') this.orderIds = null;
    this.limit = 40; this.revealed.clear();
    return this.save();
  }
  tap(id) {
    if (!this.words().slice(0, this.limit).some(item => item.id === id)) return true;
    if (this.mode !== 'both' && !this.revealed.has(id)) { this.revealed.add(id); return true; }
    return this.mark(id, 1);
  }
  cleanScores(value, version = 2) {
    const next = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
    const valid = entry => entry && Number.isSafeInteger(entry.score) && entry.score >= 0 && Number.isFinite(entry.at) && entry.at >= 0;
    if (version === 1) {
      // Shared legacy marks become each matching card's starting value; future edits are independent.
      this.vocabulary.words.forEach(word => {
        const entry = value[core.wordKey(word)];
        if (valid(entry)) next[word.id] = { score: entry.score, at: entry.at };
      });
      return next;
    }
    Object.entries(value).forEach(([id, entry]) => {
      if (this.knownIds.has(id) && valid(entry)) next[id] = { score: entry.score, at: entry.at };
    });
    return next;
  }
  score(word) { const entry = this.scores[word.id]; return entry ? entry.score : 0; }
  mark(id, delta) {
    const word = this.words().find(item => item.id === id);
    if (!word || (delta !== 1 && delta !== -1)) return true;
    const key = word.id, old = this.scores[key];
    this.scores[key] = { score: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, this.score(word) + delta)), at: Math.max(Date.now(), old ? old.at + 1 : 0) };
    return this.save();
  }
  exportState() { return { version: 2, scores: this.cleanScores(this.scores) }; }
  clearMarks(ids) {
    const allowed = new Set(this.words().map(word => word.id));
    const targets = [...new Set(ids)].filter(id => allowed.has(id));
    const previous = this.scores;
    this.scores = Object.assign(Object.create(null), previous);
    targets.forEach(id => {
      const old = previous[id];
      // Keep a dated zero so importing an older backup cannot restore cleared marks.
      this.scores[id] = { score: 0, at: Math.max(Date.now(), old ? old.at + 1 : 0) };
    });
    if (this.save()) return true;
    this.scores = previous;
    return false;
  }
  mergeScores(value, version = 2) {
    if (version !== 1 && version !== 2) return true;
    Object.entries(this.cleanScores(value, version)).forEach(([key, entry]) => {
      if (!this.scores[key] || entry.at > this.scores[key].at) this.scores[key] = entry;
    });
    return this.save();
  }
  words() {
    let words = this.vocabulary.words.filter(word => word.book === this.book && word.unit === this.unit);
    if (this.order === 'random' || this.order === 'proficiency') {
      if (!this.orderIds) {
        this.orderIds = words.map(word => word.id);
        for (let i = this.orderIds.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.orderIds[i], this.orderIds[j]] = [this.orderIds[j], this.orderIds[i]]; }
        if (this.order === 'proficiency') {
          const ties = new Map(this.orderIds.map((id, index) => [id, index]));
          words.sort((a,b) => this.score(b) - this.score(a) || ties.get(a.id) - ties.get(b.id));
          this.orderIds = words.map(word => word.id);
        }
      }
      // Freeze the entire browsing order until book/unit/order is selected again.
      const ranks = new Map(this.orderIds.map((id, index) => [id, index]));
      words.sort((a,b) => ranks.get(a.id) - ranks.get(b.id));
    }
    return words.filter(word => !(this.records[core.wordKey(word)] || {}).mastered);
  }
  more() { this.limit += 40; }
  view(records, width) {
    if (records) this.records = records;
    if (Number.isFinite(width) && width > 0) this.width = width;
    const book = this.vocabulary.books.find(item => item.id === this.book), words = this.words();
    return {
      memorizeBooks: this.vocabulary.books.map((item, index) => ({ id: item.id, label: '第' + ['一','二','三'][index] + '册', selected: item.id === this.book })),
      memorizeUnits: book.units.map(unit => ({ ...unit, title: unitTitle(unit) })),
      memorizeUnitIndex: book.units.findIndex(item => item.id === this.unit),
      memorizeUnitTitle: unitTitle(book.units.find(item => item.id === this.unit)),
      memorizeMode: this.mode, memorizeOrder: this.order, memorizeTotal: words.length, memorizeHasMore: words.length > this.limit,
      memorizeRows: words.slice(0, this.limit).map((word, index) => ({
        id: word.id, number: index + 1, score: this.score(word), english: core.cleanEnglish(word), chinese: core.chineseHint(word.chinese),
        englishTokens: core.cleanEnglish(word).split(/\s+/).map((text, index) => ({ id: index, text })),
        englishFontSize: englishFontSize(core.cleanEnglish(word), this.width),
        ...pronunciation(core.cleanEnglish(word)),
        novice: !!(this.records[core.wordKey(word)] || {}).wrong,
        showEnglish: this.mode !== 'chinese' || this.revealed.has(word.id),
        showChinese: this.mode !== 'english' || this.revealed.has(word.id),
        englishRevealed: this.mode === 'chinese' && this.revealed.has(word.id),
        chineseRevealed: this.mode === 'english' && this.revealed.has(word.id)
      }))
    };
  }
}
module.exports = { MemorizeList, STORAGE_KEY, LEGACY_STORAGE_KEY };
