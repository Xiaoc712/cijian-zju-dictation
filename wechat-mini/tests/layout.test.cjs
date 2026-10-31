const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {studyLayout}=require('../miniprogram/lib/study-layout');

test('question, controls and menu fit within both short and tall usable viewports',()=>{
  for(const available of [180,220,260,300,310,400,480,600,800,1200]){
    const s=studyLayout(available);
    assert.ok(s.studyQuestionHeight>=40);
    assert.ok(s.studyControlsHeight>=0);
    assert.equal(s.studyQuestionHeight+s.studyControlsHeight+50,s.studyCardHeight);
    assert.ok(8+s.studyCardHeight<=s.studyNavTop,'the card must end before the menu');
    assert.equal(s.studyNavTop+s.studyNavHeight,available);
  }
  const safe=studyLayout(800,34),keyboard=studyLayout(480);
  assert.equal(safe.studyNavHeight,82);assert.equal(safe.studyNavPadding,34);
  assert.equal(keyboard.studyNavPadding,0);
});

test('native page cannot scroll and the answer input has no question or page scroller ancestor',()=>{
  const root=path.resolve(__dirname,'../miniprogram/pages/study');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'index.json'),'utf8')).disableScroll,true);
  const source=fs.readFileSync(path.join(root,'index.wxml'),'utf8'),stack=[],nodes=[];
  for(const match of source.matchAll(/<\/?([a-z][\w-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/g)){
    const raw=match[0];if(raw.startsWith('</')){stack.pop();continue;}
    const attrs=Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const node={tag:match[1],attrs,parent:stack.at(-1)};nodes.push(node);
    if(!raw.endsWith('/>'))stack.push(node);
  }
  const has=(n,c)=>(n.attrs.class||'').split(' ').includes(c);
  const find=c=>nodes.find(n=>has(n,c));
  const ancestors=n=>{const all=[];for(let p=n.parent;p;p=p.parent)all.push(p);return all;};
  const stage=find('study-stage'),question=find('stage-question'),controls=find('stage-controls');
  assert.equal(question.parent,stage);assert.equal(controls.parent,stage);
  const inputs=nodes.filter(n=>n.tag==='input'&&n.attrs.name==='answer');assert.equal(inputs.length,1);
  assert.ok(ancestors(inputs[0]).includes(controls));
  assert.ok(!ancestors(inputs[0]).includes(question));
  assert.ok(!ancestors(inputs[0]).includes(find('page-scroll')));
  assert.equal(inputs[0].attrs['adjust-position'],'{{false}}');
  for(const page of ['memorize-page','account-page','library-page'])assert.ok(ancestors(find(page)).includes(find('page-scroll')),page+' remains independently scrollable');
});

test('normal pages allocate real layout space for navigation and scroll the final card above it',()=>{
  const root=path.resolve(__dirname,'../miniprogram/pages/study');
  const source=fs.readFileSync(path.join(root,'index.wxml'),'utf8');
  const css=fs.readFileSync(path.join(root,'index.wxss'),'utf8');
  const rules=new Map();
  for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    const selector=m[1].replace(/\/\*[\s\S]*?\*\//g,'').trim();
    rules.set(selector,(rules.get(selector)||'')+';'+m[2]);
  }
  const declarations=selector=>Object.fromEntries(rules.get(selector).split(';').filter(Boolean).map(value=>value.split(':').map(v=>v.trim())));
  const screen=declarations('.screen'),scroll=declarations('.page-scroll'),nav=declarations('.bottom-nav');
  assert.equal(screen.position,'fixed');assert.equal(screen.top,'0');assert.equal(screen.bottom,'0');
  assert.equal(screen.display,'flex');assert.equal(screen['flex-direction'],'column');
  assert.equal(screen.height,undefined,'native available height is not replaced by a vh or JS estimate');
  assert.equal(scroll.flex,'1');assert.equal(scroll['min-height'],'0');assert.equal(scroll.height,'0');
  assert.equal(nav.position,'relative');assert.equal(nav.flex,'none','the menu cannot overlap or shrink the list');
  assert.equal(declarations('.stage-mode .bottom-nav').position,'fixed','dictation retains its separate keyboard layout');
  assert.ok(!source.includes('pageScrollHeight'));
  assert.ok(source.includes("'min-height:' + (64 + pageSafeBottom)"),'normal navigation can grow with its content');
  assert.ok(source.includes('<view class="page-scroll-end" aria-hidden="true"></view></view></scroll-view>'));
  assert.equal(declarations('.page-scroll-end').height,'24px');
});
