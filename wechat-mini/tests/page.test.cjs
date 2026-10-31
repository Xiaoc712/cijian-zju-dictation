const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {nativeAPI,clone}=require('./helpers.cjs');
const core=require('../miniprogram/lib/learning');
const vocabulary=require('../miniprogram/data/vocabulary');
const byId=new Map(vocabulary.words.map(word=>[word.id,word]));
const pagePath=path.resolve(__dirname,'../miniprogram/pages/study/index.js');
function setup(t, wxAPI = nativeAPI()) {
  let definition;
  const app={globalData:{cloudReady:false}};
  vm.runInNewContext(fs.readFileSync(pagePath,'utf8'),{require:createRequire(pagePath),Page:value=>{definition=value;},wx:wxAPI,getApp:()=>app,console});
  const page={...definition,data:clone(definition.data),setData(patch,callback){
    assert.ok(Buffer.byteLength(JSON.stringify(patch))<1024*1024,'native setData must stay under 1 MB');
    Object.assign(this.data,patch);
    if(callback)callback();
  }};
  page.onLoad();
  t.after(()=>{page.onUnload();page._store.destroy();});
  return {page,wxAPI};
}
const event=dataset=>({currentTarget:{dataset}});

test('clear marks confirms the full unit, preserves order and draft, and supports cancellation',t=>{
  const {page,wxAPI}=setup(t);page.begin();input(page,'keep reset draft');
  page.changePage(event({page:'memorize'}));
  const all=page._memorize.words(),first=all[0],unloaded=all[70];
  page._memorize.mark(first.id,1);page._memorize.mark(unloaded.id,1);
  page.selectMemorize(event({key:'order',value:'proficiency'}));
  const order=page._memorize.words().map(word=>word.id),state=clone(page._store.view.state);
  let modal;wxAPI.showModal=options=>{modal=options;};
  page.clearMemorizeMarks();assert.ok(modal.content.includes(String(all.length)));
  modal.success({confirm:false});assert.equal(page._memorize.score(first),1);
  page.clearMemorizeMarks();modal.success({confirm:true});
  assert.ok(page._memorize.words().every(word=>page._memorize.score(word)===0));
  assert.deepEqual(page._memorize.words().map(word=>word.id),order);
  assert.deepEqual(clone(page._store.view.state),state);
  page._memorize.mark(first.id,1);page.clearMemorizeMarks();
  page.selectMemorize(event({key:'unit',value:page.data.memorizeUnits[1].id}));
  modal.success({confirm:true});assert.equal(page._memorize.score(first),1,'stale confirmation cannot clear another unit');
});

test('native friend share has a packaged landing page, cover and explicit entry',t=>{
  const wxAPI=nativeAPI(),menus=[];
  wxAPI.showShareMenu=options=>menus.push(options.menus);
  const {page}=setup(t,wxAPI);assert.deepEqual(Array.from(menus[0]),['shareAppMessage']);
  const share=page.onShareAppMessage();assert.equal(share.title,'词间默写');
  for(const file of [share.path+'.wxml',share.imageUrl])assert.ok(fs.existsSync(path.join(__dirname,'../miniprogram',file)));
  assert.ok(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/study/index.wxml'),'utf8').includes('open-type="share"'));
});

test('card taps reveal once then accumulate only that sense without reordering or changing dictation',t=>{
  const {page}=setup(t);page.begin();input(page,'preserved draft');
  const state=clone(page._store.view.state);
  page.changePage(event({page:'memorize'}));page.selectMemorize(event({key:'mode',value:'english'}));
  const [first,second]=page.data.memorizeRows,order=page.data.memorizeRows.map(row=>row.id);
  assert.equal(first.english,second.english);assert.equal(first.showChinese,false);
  page.revealMemorize(event({id:first.id}));
  assert.equal(page.data.memorizeRows[0].showChinese,true);assert.equal(page.data.memorizeRows[0].score,0);
  for(let i=0;i<4;i++)page.revealMemorize(event({id:first.id}));
  assert.equal(page.data.memorizeRows[0].score,4);assert.equal(page.data.memorizeRows[1].score,0);
  page.markMemorize(event({id:first.id,delta:'-1'}));assert.equal(page.data.memorizeRows[0].score,3);
  assert.deepEqual(page.data.memorizeRows.map(row=>row.id),order);
  assert.deepEqual(clone(page._store.view.state),state);
});

test('adding a novice word is idempotent, preserves the round, and a correct review removes it',t=>{
  const {page}=setup(t);page.begin();input(page,'keep draft');
  const state=clone(page._store.view.state);
  page.changePage(event({page:'memorize'}));const word=vocabulary.words[0],key=core.wordKey(word);
  page.addMemorizeNovice(event({id:word.id}));page.addMemorizeNovice(event({id:word.id}));
  assert.equal(page._store.view.records[key].wrong,true);assert.equal(page.data.wrongCount,1);
  assert.equal(page.data.memorizeRows[0].novice,true);
  assert.equal(page.data.memorizeRows[0].score,0);assert.deepEqual(clone(page._store.view.state),state);
  assert.equal(page.data.tabs.find(tab=>tab.id==='wrong').label,'生词');
  page.changePage(event({page:'wrong'}));assert.equal(page.data.wordRows.length,1);
  page.begin(event({review:true}));assert.equal(page.data.review,true);
  input(page,core.cleanEnglish(current(page)));page.submit();
  assert.equal(page._store.view.records[key].wrong,false);assert.equal(page.data.wrongCount,0);
});

test('backup import accepts distinct card marks and migrates older shared marks without replacing the round',t=>{
  const wxAPI=nativeAPI(),{page}=setup(t,wxAPI);page.begin();input(page,'keep backup draft');
  const state=clone(page._store.view.state),[first,second]=vocabulary.words;
  let backup={version:1,records:{},memorize:{version:2,scores:{[first.id]:{score:3,at:100},[second.id]:{score:8,at:100}}}};
  wxAPI.chooseMessageFile=options=>options.success({tempFiles:[{size:100,path:'test.json'}]});
  wxAPI.getFileSystemManager=()=>({readFile:options=>options.success({data:JSON.stringify(backup)})});
  page.importBackup();assert.equal(page._memorize.score(first),3);assert.equal(page._memorize.score(second),8);
  assert.deepEqual(clone(page._store.view.state),state);
  backup={version:1,records:{},memorize:{version:1,scores:{[core.wordKey(first)]:{score:9,at:200}}}};
  page.importBackup();assert.equal(page._memorize.score(first),9);assert.equal(page._memorize.score(second),9);
  page._memorize.mark(first.id,1);assert.equal(page._memorize.score(first),10);assert.equal(page._memorize.score(second),9);
});

test('appearance switching persists without changing learning state, loaded words or mark order',t=>{
  const wxAPI=nativeAPI(),{page}=setup(t,wxAPI);
  page.begin();input(page,'keep this answer');page.changePage(event({page:'memorize'}));
  page.selectMemorize(event({key:'order',value:'proficiency'}));page.onPageScrollLower();
  const id=page.data.memorizeRows.find(row=>row.score===0).id;
  page.markMemorize(event({id,delta:'1'}));page.changePage(event({page:'account'}));
  const state=clone(page._store.view.state),records=clone(page._store.view.records),rows=clone(page.data.memorizeRows);
  page.selectTheme(event({value:'dark'}));assert.equal(page.data.themeMode,'dark');
  assert.deepEqual(clone(page._store.view.state),state);assert.deepEqual(clone(page._store.view.records),records);
  assert.deepEqual(clone(page.data.memorizeRows),rows);
  page.changePage(event({page:'memorize'}));assert.equal(page.data.themeMode,'dark');
  assert.deepEqual(clone(page.data.memorizeRows),rows);
  const {page:reopened}=setup(t,wxAPI);assert.equal(reopened.data.themeMode,'dark');
  reopened.selectTheme(event({value:'light'}));assert.equal(reopened.data.themeMode,'light');
});

test('a failed theme save still changes the visible mode and reports the storage problem',t=>{
  const {page,wxAPI}=setup(t);
  wxAPI.setStorageSync=()=>{throw Error('quota');};
  page.selectTheme(event({value:'dark'}));assert.equal(page.data.themeMode,'dark');
  assert.ok(wxAPI.toasts.includes('外观设置未保存，请检查设备存储空间'));
});

test('mark buttons preserve positions and loaded rows until the selected mark-order button is tapped again',t=>{
  const {page}=setup(t);page.changePage(event({page:'memorize'}));
  const first=page.data.memorizeRows[0].id;
  page.markMemorize(event({id:first,delta:'1'}));
  page.selectMemorize(event({key:'order',value:'proficiency'}));
  page.onPageScrollLower();const order=page.data.memorizeRows.map(row=>row.id);
  const target=page.data.memorizeRows.find(row=>row.score===0).id;
  page.markMemorize(event({id:target,delta:'1'}));page.markMemorize(event({id:target,delta:'1'}));
  page.markMemorize(event({id:first,delta:'-1'}));
  assert.deepEqual(page.data.memorizeRows.map(row=>row.id),order);
  assert.equal(page.data.memorizeRows.find(row=>row.id===target).score,2);
  page.selectMemorize(event({key:'order',value:'proficiency'}));
  assert.equal(page.data.memorizeRows[0].score,2);
  assert.notDeepEqual(page.data.memorizeRows.map(row=>row.id),order.slice(0,40));
});

test('reaching the list bottom loads all remaining words without resetting order, reveals or dictation',t=>{
  const {page}=setup(t);page.begin();input(page,'keep my draft');
  const state=clone(page._store.view.state);
  page.changePage(event({page:'memorize'}));
  page.selectMemorize(event({key:'order',value:'proficiency'}));
  page.selectMemorize(event({key:'mode',value:'chinese'}));
  const first=page.data.memorizeRows.map(row=>row.id),id=first[0];
  page.revealMemorize(event({id,side:'english'}));
  page.onPageScrollLower();assert.equal(page.data.memorizeRows.length,80);
  assert.deepEqual(page.data.memorizeRows.slice(0,40).map(row=>row.id),first);
  assert.equal(page.data.memorizeRows.find(row=>row.id===id).showEnglish,true);
  page.onPageScrollLower();assert.equal(page.data.memorizeRows.length,104);
  assert.equal(page.data.memorizeHasMore,false);
  assert.equal(new Set(page.data.memorizeRows.map(row=>row.id)).size,104);
  const limit=page._memorize.limit;page.onPageScrollLower();page.moreMemorize();
  assert.equal(page._memorize.limit,limit);
  assert.deepEqual(clone(page._store.view.state),state);
  page.selectMemorize(event({key:'unit',value:'unit2.csv'}));
  assert.equal(page.data.memorizeRows.length,40);
  page.changePage(event({page:'account'}));page.onPageScrollLower();
  assert.equal(page._memorize.limit,40,'other pages do not append hidden memorization rows');
});

test('navigation safe area is retained on resize without imposing a calculated scroll height',t=>{
  const wxAPI=nativeAPI();
  wxAPI.getWindowInfo=()=>({windowHeight:800,windowWidth:393,screenHeight:880,safeArea:{bottom:846}});
  const {page}=setup(t,wxAPI);
  assert.equal(page.data.pageSafeBottom,34);
  assert.equal(page.data.viewportHeight,800);
  assert.equal(page.data.pageScrollHeight,undefined);
  page.onResize({size:{windowHeight:600,windowWidth:393}});
  assert.equal(page.data.viewportHeight,600);assert.equal(page.data.pageSafeBottom,34);
  page.onShow();assert.equal(page.data.viewportHeight,800);assert.equal(page.data.pageSafeBottom,34);
});

test('right swipe opens actions, left swipe closes, and scrolling or swiping cannot add a mark',t=>{
  const {page}=setup(t);page.changePage(event({page:'memorize'}));const id=page.data.memorizeRows[0].id;
  const touch=(x,y)=>({clientX:x,clientY:y});
  page.onMemSwipeStart({...event({id}),touches:[touch(60,100)]});
  page.onMemSwipeMove({touches:[touch(230,103)]});assert.equal(page.data.memorizeSwipeDragging,true);
  page.onMemSwipeEnd({changedTouches:[touch(260,103)]});
  assert.equal(page.data.memorizeSwipeId,id);assert.equal(page.data.memorizeSwipeOffset,192);assert.equal(page.data.memorizeSwipeDragging,false);
  page.revealMemorize(event({id}));assert.equal(page.data.memorizeRows[0].score,0);
  page.onMemSwipeStart({...event({id}),touches:[touch(300,100)]});page.onMemSwipeMove({touches:[touch(90,104)]});
  page.onMemSwipeEnd({changedTouches:[touch(90,104)]});assert.equal(page.data.memorizeSwipeId,'');
  page.onMemSwipeStart({...event({id}),touches:[touch(100,100)]});page.onMemSwipeMove({touches:[touch(104,220)]});
  page.onMemSwipeEnd({changedTouches:[touch(104,220)]});assert.equal(page.data.memorizeSwipeId,'');assert.equal(page.data.memorizeSwipeDragging,false);
  page.onMemSwipeStart({...event({id}),touches:[touch(60,100)]});page.onMemSwipeMove({touches:[touch(260,103)]});
  page.changePage(event({page:'account'}));assert.equal(page.data.memorizeSwipeId,'');assert.equal(page.data.memorizeSwipeDragging,false);
});

test('marking scores leaves dictation untouched; cutting removes the word from memorization and dictation',t=>{
  const wxAPI=nativeAPI(),{page}=setup(t,wxAPI);page.begin();const word=current(page),key=core.wordKey(word);
  page.changePage(event({page:'memorize'}));const session=clone(page._store.view.state.session);
  page.markMemorize(event({id:word.id,delta:'1'}));assert.equal(page._memorize.score(word),1);
  assert.deepEqual(clone(page._store.view.state.session),session);
  page.cutMemorize(event({id:word.id}));
  assert.ok(page.data.memorizeRows.every(row=>core.wordKey(row)!==key));
  page.changePage(event({page:'practice'}));assert.notEqual(core.wordKey(current(page)),key);
  const future=core.makeSession(vocabulary,page.data.preferences,page._store.view.records);
  assert.ok(future.deck.every(id=>core.wordKey(byId.get(id))!==key));
  page.changePage(event({page:'mastered'}));page.restoreWord(event({id:word.id}));page.changePage(event({page:'memorize'}));
  assert.ok(page.data.memorizeRows.some(row=>row.id===word.id));assert.equal(page._memorize.score(word),1);
  const {page:reopened}=setup(t,wxAPI);assert.equal(reopened._memorize.score(word),1);
});

test('question height follows measured content and ignores a delayed measurement from the previous word',t=>{
  const wxAPI=nativeAPI(),pending=[];
  wxAPI.getWindowInfo=()=>({windowHeight:800,windowWidth:393});
  wxAPI.createSelectorQuery=()=>({in(){return this;},select(){return this;},boundingClientRect(fn){pending.push(fn);return this;},exec(){}});
  const {page}=setup(t,wxAPI);page.begin();const old=pending.shift();
  page.skip();const latest=pending.shift(),initial=page.data.studyQuestionHeight;
  old({height:500});assert.equal(page.data.studyQuestionHeight,initial);
  latest({height:74});assert.equal(page.data.studyQuestionHeight,78);
  assert.equal(page.data.shortStage,false,'short text does not hide the caption in a roomy viewport');
  page.onInputFocus({detail:{height:320}});
  assert.equal(page.data.studyQuestionHeight,78);assert.equal(page.data.stageMode,true);
  const before=page.data.studyCardHeight;page.onUnload();latest({height:200});
  assert.equal(page.data.studyCardHeight,before);
});

test('practice is pinned before focus and remains pinned when the keyboard closes',t=>{
  const {page,wxAPI}=setup(t);page.begin();
  assert.equal(page.data.stageMode,true);assert.equal(page.data.keyboardShown,false);
  const fullHeight=page.data.studyCardHeight;
  page.onInputFocus();assert.equal(page.data.stageMode,true);
  wxAPI.emitKeyboard(300);assert.ok(page.data.studyCardHeight<fullHeight);
  page.onInputBlur();assert.equal(page.data.stageMode,true);
  wxAPI.emitKeyboard(0);assert.equal(page.data.stageMode,true);
  assert.equal(page.data.studyCardHeight,fullHeight);
  page.changePage(event({page:'wrong'}));assert.equal(page.data.stageMode,false);
  page.changePage(event({page:'practice'}));assert.equal(page.data.stageMode,true);
});

test('four tabs are ordered as requested and the mastered library is reachable from My',t=>{
  const {page}=setup(t);assert.deepEqual(page.data.tabs.map(tab=>tab.id),['memorize','practice','wrong','account']);
  page.begin();page.cut();page.changePage(event({page:'account'}));
  assert.equal(page.data.masteredCount,1);
  page.changePage(event({page:'mastered'}));assert.equal(page.data.wordRows.length,1);
  page.restoreWord(event({id:page.data.wordRows[0].id}));assert.equal(page.data.masteredCount,0);
  page.changePage(event({page:'account'}));assert.equal(page.data.page,'account');
});

test('memorization filters and reveals never change an ongoing dictation round or records',t=>{
  const wxAPI=nativeAPI(),{page}=setup(t,wxAPI);page.begin();input(page,'saved answer draft');
  const state=clone(page._store.view.state),records=clone(page._store.view.records);
  page.changePage(event({page:'memorize'}));
  page.selectMemorize(event({key:'book',value:'book2'}));page.selectMemorizeUnit({detail:{value:'1'}});
  page.selectMemorize(event({key:'mode',value:'chinese'}));
  const row=page.data.memorizeRows[0];page.revealMemorize(event({id:row.id,side:'english'}));
  assert.equal(page.data.memorizeRows[0].showEnglish,true);
  assert.deepEqual(clone(page._store.view.state),state);assert.deepEqual(clone(page._store.view.records),records);
  page.changePage(event({page:'practice'}));assert.equal(page.data.answer,'saved answer draft');
  const {page:reopened}=setup(t,wxAPI);assert.equal(reopened.data.memorizeMode,'chinese');
  assert.equal(reopened.data.memorizeUnitTitle,'Unit 1-2');
});

test('split-unit choices are unique and switching any book selects an existing first unit',t=>{
  const {page}=setup(t);
  for(const book of vocabulary.books){
    page.selectBook(event({id:book.id}));
    assert.equal(page.data.preferences.units[0],book.units[0].id);
    assert.equal(new Set(page.data.units.map(unit=>unit.title)).size,book.units.length);
    page.begin();assert.ok(page.data.total>0);assert.equal(current(page).book,book.id);
  }
});

test('legacy invalid unit preferences are repaired without changing the current round or draft',t=>{
  const {page}=setup(t);page.begin();input(page,'keep this draft');
  const session=clone(page._store.view.state.session);
  page.updatePreferences({book:'book2',units:['unit1.csv']});
  assert.deepEqual([...page.data.preferences.units],['unit1-1.csv']);
  assert.deepEqual(clone(page._store.view.state.session),session);
  assert.equal(page.data.answer,'keep this draft');
  page.updatePreferences({units:[]});assert.equal(page.data.preferences.units.length,0,'an intentional empty selection is preserved');
});
test('sharing opens the public practice page without including personal learning data',t=>{
  const wxAPI=nativeAPI();let menu;
  wxAPI.showShareMenu=options=>{menu=options;};
  const {page}=setup(t,wxAPI);page.begin();input(page,'private draft');
  page.changePage(event({page:'account'}));
  const share=clone(page.onShareAppMessage());
  assert.deepEqual([...menu.menus],['shareAppMessage']);
  assert.equal(share.path,'/pages/study/index');assert.match(share.title,/词间默写/);
  assert.ok(fs.existsSync(path.resolve(__dirname,'../miniprogram'+share.imageUrl)));
  assert.equal(JSON.stringify(share).includes('private draft'),false);
  assert.deepEqual(Object.keys(share).sort(),['imageUrl','path','title']);
});
const current=page=>byId.get(page._store.view.state.session.deck[page._store.view.state.session.index]);
function input(page,value){page.onInput({detail:{value}});}
test('three books retain all 2616 original entries with unique IDs',()=>{
  assert.deepEqual(vocabulary.books.map(book=>book.count),[801,916,899]);
  assert.equal(vocabulary.words.length,2616);assert.equal(byId.size,2616);
});
test('local launch skips cloud initialization even if an environment ID remains configured',()=>{
  const localConfig=require('../miniprogram/config');
  assert.equal(localConfig.storageMode,'local');
  let definition,cloudCalls=0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/app.js'),'utf8'),{
    require:()=>({...localConfig,cloudEnv:'unused-environment'}),
    App:value=>{definition=value;},
    wx:{cloud:{init(){cloudCalls++;}},login(){throw Error('local mode must not request login');}},console
  });
  definition.onLaunch();
  assert.equal(cloudCalls,0);assert.equal(definition.globalData.cloudReady,false);
});
test('closing and reopening locally restores the current round, draft, wrong words and mastery',t=>{
  const wxAPI=nativeAPI();
  wxAPI.cloud={callFunction(){throw Error('local mode must not call cloud');}};
  const {page}=setup(t,wxAPI);page.updatePreferences({firstLetter:true});page.begin();
  input(page,'incorrect!');page.submit();
  page.cut();input(page,'unfinished draft');
  const savedState=clone(page._store.view.state),savedRecords=clone(page._store.view.records);
  page.onHide();page.onUnload();page._store.destroy();
  const {page:reopened}=setup(t,wxAPI);
  assert.deepEqual(clone(reopened._store.view.state),savedState);
  assert.deepEqual(clone(reopened._store.view.records),savedRecords);
  assert.equal(reopened.data.answer,'unfinished draft');
  assert.equal(reopened.data.cloudEnabled,false);assert.equal(reopened.data.statusLabel,'本机保存');
  reopened.syncNow();assert.equal(wxAPI.toasts.at(-1),'学习记录已保存在当前设备');
});
test('keyboard dismissal, tab changes and reopening reset stale keyboard state',t=>{
  const {page}=setup(t);page.begin();page.onInputFocus();page.onKeyboard({detail:{height:300}});
  assert.equal(page.data.keyboardShown,true);
  page.onInputBlur();assert.equal(page.data.keyboardShown,true,'blur alone must not unfold the page under a visible keyboard');
  page.onKeyboard({detail:{height:0}});assert.equal(page.data.keyboardShown,false);
  page.onKeyboard({detail:{height:300}});assert.equal(page.data.keyboardShown,false);
  page.onInputFocus();page.onKeyboard({detail:{height:300}});page.changePage(event({page:'account'}));
  assert.equal(page.data.keyboardShown,false);
  page.onKeyboard({detail:{height:300}});assert.equal(page.data.keyboardShown,false);
  page.changePage(event({page:'practice'}));page.onInputFocus();page.onKeyboard({detail:{height:300}});
  page.onHide();page.onShow();assert.equal(page.data.keyboardShown,false);assert.equal(page.data.inputFocus,false);
});

test('global keyboard events preserve the question through blur, submission and the next focus',t=>{
  const wxAPI=nativeAPI();wxAPI.getWindowInfo=()=>({windowHeight:800});
  const {page}=setup(t,wxAPI);page.begin();page.onInputFocus();wxAPI.emitKeyboard(320);
  const height=page.data.studyQuestionHeight;
  page.onInputBlur();
  input(page,core.cleanEnglish(current(page)));page.submit();
  assert.equal(page.data.keyboardShown,true);
  assert.ok(page.data.studyQuestionHeight>=60);
  assert.equal(page.data.studyQuestionHeight,height);
  wxAPI.emitKeyboard(360);assert.ok(page.data.studyQuestionHeight>0);
  page.onInputFocus();page.skip();assert.equal(page.data.keyboardShown,true);
  wxAPI.emitKeyboard(0);page.onInputBlur();assert.equal(page.data.keyboardShown,false);
  wxAPI.emitKeyboard(320);assert.equal(page.data.keyboardShown,false,'late positive events after dismissal are ignored');
  page.onUnload();assert.equal(wxAPI.keyboardListeners.size,0);
});

test('window resize can establish keyboard layout before the height event arrives',t=>{
  const wxAPI=nativeAPI();wxAPI.getWindowInfo=()=>({windowHeight:800});
  const {page}=setup(t,wxAPI);page.begin();page.onInputFocus();
  page.onResize({size:{windowHeight:470}});
  assert.equal(page.data.keyboardShown,true);assert.equal(page.data.studyNavTop+page.data.studyNavHeight,470);
  wxAPI.emitKeyboard(330);assert.equal(page.data.studyNavTop+page.data.studyNavHeight,470);
  page.resetKeyboard();wxAPI.emitKeyboard(330);assert.equal(page.data.keyboardShown,false);
});

test('keyboard overlay and resized windows reserve the same usable study space',t=>{
  const wxAPI=nativeAPI();let windowHeight=800;
  wxAPI.getWindowInfo=()=>({windowHeight});
  const {page}=setup(t,wxAPI);page.begin();page.onInputFocus();
  page.onKeyboard({detail:{height:320}});
  const overlay=clone(page.data);
  assert.equal(overlay.studyNavTop+overlay.studyNavHeight,480);
  assert.ok(overlay.studyCardHeight<480);
  windowHeight=480;page.onResize({size:{windowHeight}});
  assert.equal(page.data.studyCardHeight,overlay.studyCardHeight,'resizing must not subtract the keyboard twice');
  page.onKeyboard({detail:{height:360}});
  assert.equal(page.data.studyNavTop+page.data.studyNavHeight,440,'changing keyboard panels recomputes the visible area');
  assert.ok(page.data.studyCardHeight>0);
  page.skip();assert.equal(page.data.keyboardShown,true,'moving to a new word keeps the compact question visible');
  page.onKeyboard({detail:{height:0}});assert.equal(page.data.keyboardShown,false);
});

test('focus height handles an already-open keyboard, and completion restores the normal layout',t=>{
  const wxAPI=nativeAPI();wxAPI.getWindowInfo=()=>({windowHeight:700});
  const {page}=setup(t,wxAPI);page.begin();page.onInputFocus({detail:{height:300}});
  assert.equal(page.data.keyboardShown,true);
  assert.equal(page.data.studyNavTop+page.data.studyNavHeight,400);
  const state=page._store.view.state;
  page._store.change({...state,session:{...state.session,deck:[state.session.deck[0]],index:0}});
  page.submit();assert.equal(page.data.finished,true);assert.equal(page.data.keyboardShown,false);
  page.onKeyboard({detail:{height:300}});assert.equal(page.data.keyboardShown,false);
});
test('native grading plays the matching cue and the sound switch survives reopening',t=>{
  const wxAPI=nativeAPI();const plays=[];let stopped=0,destroyed=0;
  wxAPI.createInnerAudioContext=()=>({play(){plays.push(this.src);},stop(){stopped++;},destroy(){destroyed++;},onError(){}});
  const {page}=setup(t,wxAPI);page.begin();page.submit();
  assert.deepEqual(plays,['/assets/audio/wrong.mp3']);
  input(page,core.cleanEnglish(current(page)));page.submit();
  input(page,'incorrect!');page.submit();
  assert.deepEqual(plays,['/assets/audio/wrong.mp3','/assets/audio/correct.mp3','/assets/audio/wrong.mp3']);
  page.onSoundChange({detail:{value:false}});input(page,'incorrect!');page.submit();
  assert.equal(plays.length,3);page.onHide();assert.ok(stopped>0);
  const {page:reopened}=setup(t,wxAPI);assert.equal(reopened.data.soundEnabled,false);
  page.onUnload();assert.equal(destroyed,2);
});
test('native input ignores Unicode spaces and case, backtracking restores the draft',t=>{
  const {page}=setup(t);page.begin();const first=current(page);
  const answer=core.cleanEnglish(first).toUpperCase().split('').join('\u3000');
  input(page,answer);page.submit();
  assert.equal(page.data.stats.correct,1);
  assert.equal(page._store.view.state.session.index,1);
  page.previous();assert.equal(page.data.answer,answer);
  page.submit();assert.equal(page.data.stats.correct,1);
  assert.notEqual(core.normalize('apple!'),core.normalize('apple'));
});
test('blank submission is wrong and retry replaces the round result on correction',t=>{
  const {page,wxAPI}=setup(t);page.updatePreferences({retry:true});page.begin();
  const key=core.wordKey(current(page));
  page.submit();assert.equal(page.data.stats.wrong,1);assert.equal(wxAPI.toasts.length,0);
  assert.equal(page._store.view.records[key].wrong,true);
  assert.equal(page.data.history[0].inputLabel,'（未作答）');
  input(page,' \u3000\t\u200b');page.submit();
  assert.equal(page._store.view.state.session.index,0);assert.equal(page.data.stats.wrong,1);
  input(page,core.cleanEnglish(current(page)));page.submit();
  assert.equal(page.data.stats.correct,1);assert.equal(page.data.stats.wrong,0);
});

test('native form submits an empty value instead of a stale correct draft',t=>{
  const {page}=setup(t);page.updatePreferences({retry:true});page.begin();const word=current(page);
  input(page,core.cleanEnglish(word));assert.equal(page.data.answerBlank,false);
  page.submit({detail:{value:{answer:''}}});
  assert.equal(page.data.stats.wrong,1);assert.equal(page.data.stats.correct,0);
  assert.equal(page._store.view.records[core.wordKey(word)].wrong,true);
  assert.equal(page.data.answer,'');assert.equal(page.data.answerBlank,true);
  assert.match(page.data.feedback,/空白已计错/);
  assert.equal(page.data.history[0].inputLabel,'（未作答）');
  page.confirmAnswer({detail:{value:core.cleanEnglish(word).toUpperCase()}});
  assert.equal(page.data.stats.correct,1);assert.equal(page.data.stats.wrong,0);
});

test('keyboard confirmation uses the current blank or whitespace value without a preceding input event',t=>{
  for(const blank of ['', ' \t\u3000\u200b']){
    const {page}=setup(t);page.begin();const word=current(page);
    input(page,core.cleanEnglish(word));page.confirmAnswer({detail:{value:blank}});
    assert.equal(page.data.stats.wrong,1);assert.equal(page.data.stats.correct,0);
    assert.equal(page._store.view.state.session.index,1);
    assert.equal(page._store.view.records[core.wordKey(word)].wrong,true);
    assert.equal(page._store.view.state.session.drafts[word.id],blank);
  }
});

test('empty and whitespace-only answers advance, persist as wrong, and remain wrong during review',t=>{
  const wxAPI=nativeAPI();const {page}=setup(t,wxAPI);page.begin();
  const first=core.wordKey(current(page));page.submit();
  page.skip(); // The original dictionary includes a second sense of ambition.
  const second=core.wordKey(current(page));input(page,' \t\u3000\u200b');page.submit();
  assert.equal(page._store.view.state.session.index,3);assert.equal(page.data.stats.wrong,2);
  assert.equal(page._store.view.records[first].wrong,true);assert.equal(page._store.view.records[second].wrong,true);
  page.onHide();
  const {page:reopened}=setup(t,wxAPI);
  assert.equal(reopened.data.stats.wrong,2);assert.equal(reopened.data.wrongCount,2);
  assert.equal(reopened.data.history[0].inputLabel,'（未作答）');
  reopened.begin(event({review:true}));const reviewed=core.wordKey(current(reopened));reopened.submit();
  assert.equal(reopened._store.view.records[reviewed].wrong,true);
  assert.equal(reopened.data.stats.wrong,1);
});
test('cut excludes the word from later rounds, undo restores its position and draft',t=>{
  const {page}=setup(t);page.begin();const first=current(page),key=core.wordKey(first);
  input(page,'draft');page.cut();
  assert.equal(page._store.view.records[key].mastered,true);
  assert.equal(page.data.canUndo,true);
  const future=core.makeSession(vocabulary,page._store.view.state.preferences,page._store.view.records);
  assert.ok(future.deck.every(id=>core.wordKey(byId.get(id))!==key));
  page.undoCut();assert.equal(current(page).id,first.id);assert.equal(page.data.answer,'draft');
  assert.equal(page._store.view.records[key].mastered,false);
});
test('review skips keep wrong records; only a correct review answer removes one',t=>{
  const {page}=setup(t);page.begin();const first=current(page),key=core.wordKey(first);
  input(page,'incorrect!');page.submit();
  page.begin(event({review:true}));page.skip();
  assert.equal(page._store.view.records[key].wrong,true);
  page.previous();input(page,core.cleanEnglish(current(page)));page.submit();
  assert.equal(page._store.view.records[key].wrong,false);
  assert.equal(page.data.wrongCount,0);
});
test('library restoration hides stale undo and preserves the original wrong flag',t=>{
  const {page}=setup(t);page.begin();const first=current(page),key=core.wordKey(first);
  input(page,'incorrect!');page.submit();page.previous();page.cut();
  page.changePage(event({page:'mastered'}));
  page.searchWords({detail:{value:core.cleanEnglish(first)}});
  assert.ok(page.data.wordRows.some(word=>core.wordKey(word)===key));
  page.restoreWord(event({id:first.id}));
  assert.equal(page.data.canUndo,false);
  assert.equal(page._store.view.records[key].wrong,true);
  assert.equal(page._store.view.records[key].mastered,false);
});
test('random order stays fixed on previous/skip and example blanks stay stable',t=>{
  const {page}=setup(t);page.updatePreferences({order:'random',mode:'example',firstLetter:true});page.begin();
  const deck=[...page._store.view.state.session.deck],question=page.data.question;
  assert.ok(question.includes('________'));assert.ok(!question.includes('[['));
  page.skip();page.previous();assert.equal(page.data.question,question);
  assert.deepEqual([...page._store.view.state.session.deck],deck);
  assert.ok(core.parseStudyState(page._store.view.state));
  assert.equal(core.parseStudyState({...page._store.view.state,session:{...page._store.view.state.session,index:-1}}),null);
});
