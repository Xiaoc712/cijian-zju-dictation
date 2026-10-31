const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nativeAPI}=require('./helpers.cjs');
const vocabulary=require('../miniprogram/data/vocabulary');
const {MemorizeList,STORAGE_KEY,LEGACY_STORAGE_KEY}=require('../miniprogram/lib/memorize');
const core=require('../miniprogram/lib/learning');

test('bulk clear includes unloaded cards, leaves other units and retains dated zeros against old backups',()=>{
  const wx=nativeAPI(),list=new MemorizeList(vocabulary,wx),unit=list.unit,words=list.words();
  const other=vocabulary.words.find(word=>word.book===list.book&&word.unit!==unit);
  list.select('unit',other.unit);list.mark(other.id,1);list.select('unit',unit);
  for(const word of [words[0],words[70]])list.mark(word.id,1);
  const backup=list.exportState();list.select('order','proficiency');
  const order=list.words().map(word=>word.id);list.tap(words[0].id);
  assert.equal(list.clearMarks([...order,other.id,'unknown']),true);
  assert.ok(words.every(word=>list.score(word)===0));assert.equal(list.score(other),1);
  assert.deepEqual(list.words().map(word=>word.id),order);
  list.mergeScores(backup.scores);assert.ok(words.every(word=>list.score(word)===0));
  const reopened=new MemorizeList(vocabulary,wx);assert.equal(reopened.score(words[70]),0);assert.equal(reopened.score(other),1);
});

test('failed bulk save restores the marks instead of pretending they were cleared',()=>{
  const wx=nativeAPI(),list=new MemorizeList(vocabulary,wx),word=list.words()[0];list.mark(word.id,1);
  wx.setStorageSync=()=>{throw Error('full');};
  assert.equal(list.clearMarks([word.id]),false);assert.equal(list.score(word),1);
});

test('bilingual rows preserve the exact English/Chinese pairing and different senses',()=>{
  const list=new MemorizeList(vocabulary,nativeAPI()),view=list.view();
  const originals=vocabulary.words.filter(w=>w.book==='book1'&&w.unit==='unit1.csv');
  assert.equal(view.memorizeTotal,originals.length);
  assert.equal(view.memorizeRows.length,40);assert.equal(view.memorizeHasMore,true);
  view.memorizeRows.forEach((row,index)=>{
    assert.equal(row.id,originals[index].id);assert.equal(row.english,core.cleanEnglish(originals[index]));
    assert.equal(row.chinese,core.chineseHint(originals[index].chinese));
    assert.equal(row.number,index+1);assert.equal(row.showEnglish,true);assert.equal(row.showChinese,true);
  });
  assert.equal(view.memorizeRows[0].english,view.memorizeRows[1].english);
  assert.notEqual(view.memorizeRows[0].chinese,view.memorizeRows[1].chinese);
});

test('Chinese-only mode reveals a card first, then every subsequent tap adds only its mark',()=>{
  const list=new MemorizeList(vocabulary,nativeAPI());list.select('mode','chinese');
  const id=list.view().memorizeRows[0].id;
  assert.equal(list.view().memorizeRows[0].showEnglish,false);
  list.tap(id);let rows=list.view().memorizeRows;
  assert.equal(rows[0].showEnglish,true);assert.equal(rows[0].score,0);
  assert.equal(rows[1].showEnglish,false);assert.equal(rows[0].showChinese,true);
  list.tap(id);list.tap(id);list.tap(id);rows=list.view().memorizeRows;
  assert.equal(rows[0].showEnglish,true);assert.equal(rows[0].score,3);assert.equal(rows[1].score,0);
});

test('English-only mode reveals Chinese once and mode changes reset temporary reveals',()=>{
  const list=new MemorizeList(vocabulary,nativeAPI());list.select('mode','english');
  const id=list.view().memorizeRows[0].id;
  assert.equal(list.view().memorizeRows[0].showChinese,false);
  list.tap(id);assert.equal(list.view().memorizeRows[0].showChinese,true);
  list.tap(id);assert.equal(list.view().memorizeRows[0].score,1);
  list.select('mode','both');list.tap(id);assert.equal(list.view().memorizeRows[0].score,2);
  list.select('mode','english');assert.equal(list.view().memorizeRows[0].showChinese,false);
});

test('book and unit filters use unique split-unit labels and restore settings locally',()=>{
  const wx=nativeAPI(),list=new MemorizeList(vocabulary,wx);
  list.select('book','book2');let view=list.view();
  assert.equal(view.memorizeUnitTitle,'Unit 1-1');assert.equal(view.memorizeTotal,70);
  assert.equal(new Set(view.memorizeUnits.map(u=>u.title)).size,view.memorizeUnits.length);
  list.select('unit','unit1-2.csv');list.select('mode','chinese');
  const restored=new MemorizeList(vocabulary,wx);view=restored.view();
  assert.equal(restored.book,'book2');assert.equal(restored.unit,'unit1-2.csv');
  assert.equal(view.memorizeUnitTitle,'Unit 1-2');assert.equal(view.memorizeTotal,51);
  assert.equal(view.memorizeMode,'chinese');
  assert.deepEqual([...wx.storage.keys()],[STORAGE_KEY],'no dictation cache is overwritten');
});

test('load-more keeps the original order and changing units resets the loaded chunk',()=>{
  const list=new MemorizeList(vocabulary,nativeAPI());const ids=list.words().map(w=>w.id);
  list.more();list.more();let view=list.view();
  assert.equal(view.memorizeHasMore,false);assert.deepEqual(view.memorizeRows.map(w=>w.id),ids);
  list.select('unit','unit2.csv');view=list.view();
  assert.equal(view.memorizeRows.length,40);assert.equal(view.memorizeRows[0].number,1);
});

test('invalid saved selections fall back safely and storage failure leaves the list usable',()=>{
  const wx=nativeAPI();wx.storage.set(STORAGE_KEY,{book:'missing',unit:'bad',mode:'unsupported'});
  const list=new MemorizeList(vocabulary,wx);assert.equal(list.book,'book1');assert.equal(list.mode,'both');
  list.select('unit','does-not-exist');assert.equal(list.unit,'unit1.csv');
  wx.setStorageSync=()=>{throw Error('quota');};
  assert.equal(list.select('mode','chinese'),false);
  assert.equal(list.view().memorizeRows[0].showEnglish,false);
});

test('scores start at zero, increment by one, never go negative, and survive reopening',()=>{
  const wx=nativeAPI(),list=new MemorizeList(vocabulary,wx),word=list.words()[0];
  assert.equal(list.score(word),0);list.mark(word.id,-1);assert.equal(list.score(word),0);
  list.mark(word.id,1);list.mark(word.id,1);list.mark(word.id,-1);
  assert.equal(list.score(word),1);
  const reopened=new MemorizeList(vocabulary,wx);assert.equal(reopened.score(word),1);
  assert.equal(reopened.view().memorizeRows[0].score,1);assert.equal(reopened.view().memorizeRows[1].score,0);
});

test('random order is a stable permutation while revealing answers and updating scores',t=>{
  t.mock.method(Math,'random',()=>0);
  const list=new MemorizeList(vocabulary,nativeAPI()),original=list.words().map(w=>w.id);
  list.select('order','random');const first=list.words().map(w=>w.id);
  assert.notDeepEqual(first,original);assert.deepEqual([...first].sort(),[...original].sort());
  list.select('mode','chinese');list.tap(first[0]);list.mark(first[0],1);
  assert.deepEqual(list.words().map(w=>w.id),first);
  list.select('order','sequential');assert.deepEqual(list.words().map(w=>w.id),original);
});

test('mark sorting puts high scores first, uses shuffled ties, and keeps ties stable across redraws',t=>{
  t.mock.method(Math,'random',()=>0.5);
  const wx=nativeAPI(),list=new MemorizeList(vocabulary,wx),original=list.words();
  list.mark(original[2].id,1);list.mark(original[0].id,1);list.mark(original[0].id,1);
  list.select('order','proficiency');const words=list.words(),scores=words.map(w=>list.score(w));
  assert.deepEqual(scores,[...scores].sort((a,b)=>b-a));
  assert.equal(scores[0],2);assert.equal(scores.at(-1),0);
  const zeros=words.filter(w=>list.score(w)===0).map(w=>w.id);
  assert.notDeepEqual(zeros,original.filter(w=>list.score(w)===0).map(w=>w.id));
  const order=words.map(w=>w.id);list.view();list.tap(words[0].id);
  assert.deepEqual(list.words().map(w=>w.id),order);
  assert.equal(new MemorizeList(vocabulary,wx).order,'proficiency');
});

test('mark edits update numbers but keep the whole browsing order until mark sorting is selected again',t=>{
  t.mock.method(Math,'random',()=>0.5);
  const wx=nativeAPI(),list=new MemorizeList(vocabulary,wx),initialTop=list.words()[0];
  list.mark(initialTop.id,1);list.mark(initialTop.id,1);
  list.select('order','proficiency');
  const order=list.words().map(word=>word.id),target=list.words().find(word=>list.score(word)===0);
  list.mark(target.id,1);list.mark(target.id,1);list.mark(target.id,1);
  list.mark(initialTop.id,-1);list.mark(initialTop.id,-1);
  assert.equal(list.score(target),3);assert.equal(list.score(initialTop),0);
  assert.deepEqual(list.words().map(word=>word.id),order);
  list.select('mode','chinese');list.tap(target.id);list.more();list.more();
  const view=list.view();
  assert.deepEqual(view.memorizeRows.map(row=>row.id),order);
  assert.equal(view.memorizeRows.find(row=>row.id===target.id).score,3);
  const key=core.wordKey(target);
  list.view({[key]:{mastered:true}});
  assert.deepEqual(list.words().map(word=>word.id),order.filter(id=>core.wordKey(vocabulary.words.find(w=>w.id===id))!==key));
  list.view({});assert.deepEqual(list.words().map(word=>word.id),order);
  list.select('order','proficiency');
  const scores=list.words().map(word=>list.score(word));
  assert.equal(core.wordKey(list.words()[0]),key);
  assert.deepEqual(scores,[...scores].sort((a,b)=>b-a));
  assert.notDeepEqual(list.words().map(word=>word.id),order);
  assert.equal(new MemorizeList(vocabulary,wx).score(target),3);
});

test('mastered words disappear in every order and restoration preserves their score',()=>{
  const list=new MemorizeList(vocabulary,nativeAPI()),word=list.words()[0],key=core.wordKey(word);
  list.mark(word.id,1);
  for(const order of ['sequential','random','proficiency']){
    list.select('order',order);list.view({[key]:{mastered:true,wrong:false}});
    assert.ok(list.words().every(w=>core.wordKey(w)!==key));
    list.view({[key]:{mastered:false,wrong:false}});
    assert.ok(list.words().some(w=>w.id===word.id));assert.equal(list.score(word),1);
  }
});

test('score backups merge the newer edit and ignore malformed or unknown scores',()=>{
  const source=new MemorizeList(vocabulary,nativeAPI()),target=new MemorizeList(vocabulary,nativeAPI());
  const word=source.words()[0],key=word.id;source.mark(word.id,1);
  const backup=source.exportState();assert.equal(target.mergeScores(backup.scores),true);assert.equal(target.score(word),1);
  target.mark(word.id,1);target.mergeScores(backup.scores);assert.equal(target.score(word),2);
  target.mergeScores({unknown:{score:5,at:Date.now()},[key]:{score:-1,at:Date.now()+10000}});
  assert.equal(target.score(word),2);assert.equal(target.scores.unknown,undefined);
});

test('legacy shared marks migrate without losing counts and split into independent cards',()=>{
  const wx=nativeAPI(),[first,second]=vocabulary.words;
  assert.equal(core.wordKey(first),core.wordKey(second));
  const legacy={book:'book1',unit:'unit1.csv',mode:'both',order:'proficiency',scores:{[core.wordKey(first)]:{score:5,at:100}}};
  wx.storage.set(LEGACY_STORAGE_KEY,legacy);
  const list=new MemorizeList(vocabulary,wx);
  assert.equal(list.score(first),5);assert.equal(list.score(second),5);
  list.mark(first.id,1);list.mark(second.id,-1);
  assert.equal(list.score(first),6);assert.equal(list.score(second),4);
  const saved=wx.storage.get(STORAGE_KEY);
  assert.equal(saved.version,2);assert.ok(saved.scores[first.id]);assert.equal(saved.scores[core.wordKey(first)],undefined);
  assert.deepEqual(wx.storage.get(LEGACY_STORAGE_KEY),legacy,'keep the old copy for safe migration and older app versions');
  wx.storage.set(LEGACY_STORAGE_KEY,{...legacy,scores:{[core.wordKey(first)]:{score:999,at:Date.now()+9999}}});
  const reopened=new MemorizeList(vocabulary,wx);
  assert.equal(reopened.score(first),6);assert.equal(reopened.score(second),4);
});

test('version two backups preserve per-card marks while legacy backups still import by timestamp',()=>{
  const [first,second]=vocabulary.words,source=new MemorizeList(vocabulary,nativeAPI()),target=new MemorizeList(vocabulary,nativeAPI());
  source.mark(first.id,1);source.mark(first.id,1);source.mark(second.id,1);
  const backup=source.exportState();assert.equal(backup.version,2);
  target.mergeScores(backup.scores,backup.version);
  assert.equal(target.score(first),2);assert.equal(target.score(second),1);
  target.mergeScores({[core.wordKey(first)]:{score:7,at:Date.now()+1000}},1);
  assert.equal(target.score(first),7);assert.equal(target.score(second),7);
  target.mark(first.id,-1);assert.equal(target.score(first),6);assert.equal(target.score(second),7);
  target.mergeScores(backup.scores,2);assert.equal(target.score(first),6);assert.equal(target.score(second),7);
  target.mergeScores({[first.id]:{score:999,at:Date.now()+9999}},99);
  assert.equal(target.score(first),6);
});
