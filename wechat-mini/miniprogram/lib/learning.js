// Generated from the tested web learning core. Run scripts/generate.cjs to refresh.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_STUDY = exports.DEFAULT_PREFERENCES = void 0;
exports.cleanEnglish = cleanEnglish;
exports.normalize = normalize;
exports.wordKey = wordKey;
exports.chineseHint = chineseHint;
exports.applyOperation = applyOperation;
exports.makeSession = makeSession;
exports.nextIndex = nextIndex;
exports.previousIndex = previousIndex;
exports.sessionStats = sessionStats;
exports.questionText = questionText;
exports.parseStudyState = parseStudyState;
exports.makeId = makeId;
exports.DEFAULT_PREFERENCES = { book: "book1", units: ["unit1.csv"], content: "all", order: "sequential", mode: "word", firstLetter: false, retry: false };
exports.EMPTY_STUDY = { preferences: exports.DEFAULT_PREFERENCES, session: null, history: [] };
function cleanEnglish(word) { return (typeof word === "string" ? word : word.english).split(",")[0].trim(); }
function normalize(value) { return value.replace(/[\s\u200b]/gu, "").toLowerCase(); }
function wordKey(word) { return normalize(cleanEnglish(word)); }
function chineseHint(value) { var _a; return ((_a = value.match(/[\u4e00-\u9fff][\u4e00-\u9fff；，。（）·、！？：]*/gu)) === null || _a === void 0 ? void 0 : _a.join(" / ")) || value; }
function applyOperation(records, operation) {
    const next = Object.assign({}, (records[operation.key] || { mastered: false, wrong: false }));
    if (operation.kind === "mastered")
        next.mastered = true;
    if (operation.kind === "restore")
        next.mastered = false;
    if (operation.kind === "wrong")
        next.wrong = true;
    if (operation.kind === "resolved")
        next.wrong = false;
    return Object.assign(Object.assign({}, records), { [operation.key]: next });
}
function makeSession(vocabulary, preferences, records, review = false) {
    let words = vocabulary.words.filter(word => {
        const flags = records[wordKey(word)];
        if (flags === null || flags === void 0 ? void 0 : flags.mastered)
            return false;
        if (review)
            return !!(flags === null || flags === void 0 ? void 0 : flags.wrong);
        if (word.book !== preferences.book || !preferences.units.includes(word.unit))
            return false;
        const phrase = /\s/u.test(cleanEnglish(word));
        if (preferences.content === "words" && phrase)
            return false;
        if (preferences.content === "phrases" && !phrase)
            return false;
        if (preferences.mode === "example" && !/\[\[[^\[\]]+\]\]/u.test(word.examples))
            return false;
        return true;
    });
    if (review)
        words = [...new Map(words.map(word => [wordKey(word), word])).values()];
    if (review || preferences.order === "random") {
        for (let index = words.length - 1; index > 0; index--) {
            const other = Math.floor(Math.random() * (index + 1));
            [words[index], words[other]] = [words[other], words[index]];
        }
    }
    return { id: makeId(), deck: words.map(word => word.id), index: 0, mode: review ? "word" : preferences.mode, firstLetter: preferences.firstLetter, retry: preferences.retry, review, results: {}, drafts: {}, startedAt: Date.now(), cut: null };
}
function nextIndex(session, records, byId, from = session.index + 1) {
    var _a;
    let index = Math.max(0, from);
    while (index < session.deck.length) {
        const word = byId.get(session.deck[index]);
        if (word && !((_a = records[wordKey(word)]) === null || _a === void 0 ? void 0 : _a.mastered))
            return index;
        index++;
    }
    return session.deck.length;
}
function previousIndex(session, records, byId) {
    var _a;
    for (let index = Math.min(session.index, session.deck.length) - 1; index >= 0; index--) {
        const word = byId.get(session.deck[index]);
        if (word && !((_a = records[wordKey(word)]) === null || _a === void 0 ? void 0 : _a.mastered))
            return index;
    }
    return session.index;
}
function sessionStats(session) {
    const stats = { correct: 0, wrong: 0, skipped: 0, mastered: 0 };
    for (const result of Object.values((session === null || session === void 0 ? void 0 : session.results) || {}))
        if (result in stats)
            stats[result]++;
    return stats;
}
function questionText(word, session) {
    if (session.mode === "word")
        return chineseHint(word.chinese);
    const sentence = word.examples.split("；").find(value => /\[\[[^\[\]]+\]\]/u.test(value)) || word.examples;
    return sentence.replace(/\[\[.*?\]\]/gu, (session.firstLetter ? cleanEnglish(word)[0] : "") + "________").replace(/^e\.g\.\s*/u, "");
}
function parseStudyState(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    const prefs = candidate.preferences;
    if (!prefs || !["book1", "book2", "book3"].includes(prefs.book)
        || !Array.isArray(prefs.units) || prefs.units.length > 100 || prefs.units.some(unit => typeof unit !== "string" || unit.length > 100)
        || !["all", "words", "phrases"].includes(prefs.content) || !["sequential", "random"].includes(prefs.order)
        || !["word", "example"].includes(prefs.mode) || typeof prefs.firstLetter !== "boolean" || typeof prefs.retry !== "boolean")
        return null;
    if (candidate.session !== null) {
        const session = candidate.session;
        if (!session || typeof session.id !== "string" || !Array.isArray(session.deck) || session.deck.length > 6000
            || session.deck.some(id => typeof id !== "string" || id.length > 100) || !Number.isInteger(session.index)
            || session.index < 0 || session.index > session.deck.length || !["word", "example"].includes(session.mode)
            || typeof session.firstLetter !== "boolean" || typeof session.retry !== "boolean" || typeof session.review !== "boolean"
            || !session.results || typeof session.results !== "object" || Array.isArray(session.results)
            || Object.values(session.results).some(result => !["correct", "wrong", "skipped", "mastered"].includes(result))
            || !session.drafts || typeof session.drafts !== "object" || Array.isArray(session.drafts)
            || Object.values(session.drafts).some(draft => typeof draft !== "string" || draft.length > 1000)
            || typeof session.startedAt !== "number")
            return null;
        if (session.cut && (typeof session.cut.wordId !== "string" || !Number.isInteger(session.cut.index)
            || session.cut.index < 0 || session.cut.index >= session.deck.length))
            return null;
    }
    if (!Array.isArray(candidate.history) || candidate.history.length > 200
        || candidate.history.some(entry => !entry || typeof entry.id !== "string" || typeof entry.english !== "string"
            || entry.english.length > 500 || !["correct", "wrong", "skipped", "mastered", "restore"].includes(entry.kind)
            || typeof entry.at !== "number" || (entry.input !== undefined && (typeof entry.input !== "string" || entry.input.length > 1000))))
        return null;
    return candidate;
}
function makeId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12) + "-" + Math.random().toString(36).slice(2, 12); }
