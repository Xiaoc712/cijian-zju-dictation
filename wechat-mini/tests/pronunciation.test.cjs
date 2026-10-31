const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { entries: data, notices } = require('../miniprogram/data/phonetics');
const vocabulary = require('../miniprogram/data/vocabulary');
const core = require('../miniprogram/lib/learning');
const { MemorizeList } = require('../miniprogram/lib/memorize');
const { englishFontSize } = require('../miniprogram/lib/memory-layout');
const { pronunciation } = require('../miniprogram/lib/pronunciation');
const { nativeAPI } = require('./helpers.cjs');

test('offline phonetics are scoped to the vocabulary, explicit about fallback readings and safe for missing names', () => {
  const terms = new Set(vocabulary.words.map(word => core.cleanEnglish(word).toLowerCase()).filter(word=>! /\s/.test(word)));
  assert.ok(Object.keys(data).length >= terms.size-10);
  for (const [word,entry] of Object.entries(data)) {
    assert.ok(terms.has(word));assert.ok(typeof entry.ipa==='string'&&entry.ipa.length>0);
    assert.ok(['','美','逐词','字母'].includes(entry.label));
    assert.ok(!/[<>]/.test(entry.ipa));
  }
  assert.ok(pronunciation('AMBITION').phonetic.includes('ʃ'));
  assert.equal(pronunciation('crowdfunding').phonetic,'ˈkraʊd.fʌn.dɪŋ');
  assert.equal(pronunciation('gps').phoneticLabel,'字母');
  assert.ok(pronunciation('gps').phonetic.includes('dʒ'));
  assert.deepEqual(pronunciation('unlisted-proper-name'),{phonetic:'',phoneticLabel:''});
  assert.deepEqual(pronunciation('press conference'),{phonetic:'',phoneticLabel:''});
  assert.ok(Object.keys(data).every(word=>! /\s/.test(word)));
  assert.ok(notices.ECDICT.includes('MIT License'));assert.ok(notices['ipa-dict'].includes('Copyright'));
});

test('words stay whole and font fitting supports narrow phones, long words and tablet layouts', () => {
  for (const width of [320,350,375,393,768,800,1024]) {
    const list = new MemorizeList(vocabulary,nativeAPI());
    const view = list.view(undefined,width);
    for (const row of view.memorizeRows) assert.equal(row.englishTokens.map(token=>token.text).join(' '),row.english);
    for (const word of vocabulary.words) {
      const size=englishFontSize(core.cleanEnglish(word),width);
      assert.ok(Number.isFinite(size)&&size>=10&&size<=(width>=800?22:18));
    }
  }
  assert.ok(englishFontSize('environmentalism',320)<englishFontSize('unit',320));
});

test('revealing long Chinese keeps the same underlying text, tokens and phonetics in the layout', () => {
  const list = new MemorizeList(vocabulary,nativeAPI());list.select('mode','english');
  const before=list.view().memorizeRows.find(row=>row.chinese.length>12);
  assert.ok(before);list.tap(before.id);
  const after=list.view().memorizeRows.find(row=>row.id===before.id);
  for(const field of ['english','chinese','englishTokens','englishFontSize','phonetic','phoneticLabel'])assert.deepEqual(after[field],before[field]);
  assert.equal(before.showChinese,false);assert.equal(after.showChinese,true);assert.equal(after.score,0);
});

test('native cards reserve concealed content height and use three right-swipe actions', () => {
  const root=path.resolve(__dirname,'../miniprogram/pages/study');
  const wxml=fs.readFileSync(path.join(root,'index.wxml'),'utf8');
  const css=fs.readFileSync(path.join(root,'index.wxss'),'utf8');
  assert.ok(wxml.includes('{{item.chinese}}</text></view>'));
  assert.ok(!wxml.includes('wx:if="{{item.showChinese}}"'));
  assert.ok(!wxml.includes('wx:if="{{item.showEnglish}}"'));
  assert.match(css,/\.memory-concealed\{visibility:hidden\}/);
  assert.match(css,/\.memory-cover\{[^}]*position:absolute/);
  assert.match(css,/\.memory-cell\{[^}]*flex:1 1 0;min-width:0/);
  assert.match(css,/\.memory-word-token\{[^}]*white-space:nowrap/);
  assert.match(css,/\.memory-swipe-actions\{[^}]*left:0/);
  const rowRule=css.match(/\.memory-card \.memory-row\{([^}]+)\}/)[1];
  const markRule=css.match(/\.memory-mark\{([^}]+)\}/)[1];
  const contentTop=Number(rowRule.match(/padding:(\d+)px/)[1]);
  const markBottom=Number(markRule.match(/top:(\d+)px/)[1])+Number(markRule.match(/line-height:(\d+)px/)[1]);
  assert.ok(contentTop>=markBottom+4,'mark has its own space above either concealed cell');
  const actions=[...wxml.matchAll(/class="memory-action (memory-[\w-]+)"/g)].map(match=>match[1]);
  assert.deepEqual(actions,['memory-decrease','memory-novice','memory-master']);
});
