const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):[path.join(dir,item.name)]);}
assert.equal(require('../miniprogram/config').appVersion,require('../package.json').version,'visible version matches package');
const source=files(root).filter(file=>!/[\\/](node_modules|outputs)[\\/]/.test(file));
for(const file of source){
  if(file.endsWith('.json'))JSON.parse(fs.readFileSync(file,'utf8'));
  if(/\.(js|cjs)$/.test(file))new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
}
const config=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));
const mini=path.join(root,config.miniprogramRoot);
const app=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8'));
for(const page of app.pages){
  for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(mini,page+'.'+ext)),page+'.'+ext);
  const wxml=fs.readFileSync(path.join(mini,page+'.wxml'),'utf8');
  const js=fs.readFileSync(path.join(mini,page+'.js'),'utf8');
  const stack=[];
  for(const match of wxml.matchAll(/<\/?([a-z][\w-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/g)){
    const tag=match[1],raw=match[0];
    assert.ok(['view','text','button','input','switch','block','scroll-view','image','form','picker'].includes(tag),'native tag '+tag);
    if(raw.startsWith('</'))assert.equal(stack.pop(),tag,'WXML nesting');
    else if(!raw.endsWith('/>'))stack.push(tag);
  }
  assert.equal(stack.length,0,'unclosed WXML tags');
  for(const match of wxml.matchAll(/(?:bind\w+|catch\w+)="(\w+)"/g))assert.ok(new RegExp('\\b'+match[1]+'\\s*\\(').test(js),'missing handler '+match[1]);
}
for(const file of files(mini).filter(file=>file.endsWith('.js'))){
  for(const match of fs.readFileSync(file,'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g))assert.ok(fs.existsSync(path.resolve(path.dirname(file),match[1]+'.js')),'missing import '+match[1]);
}
const size=files(mini).reduce((sum,file)=>sum+fs.statSync(file).size,0);
assert.ok(size<2*1024*1024,'frontend must fit 2 MiB');
const audioFiles=files(path.join(mini,'assets/audio'));
assert.deepEqual(audioFiles.map(file=>path.basename(file)).sort(),['correct.mp3','wrong.mp3'],'only runtime MP3 cues belong in the upload directory');
const audioSize=audioFiles.reduce((sum,file)=>sum+fs.statSync(file).size,0);
assert.ok(audioSize<10*1024,'combined offline cues must fit 10 KiB');
const mediaFiles=files(mini).filter(file=>/\.(png|jpe?g|gif|webp|svg|mp3|wav|aac|m4a|ogg|flac)$/i.test(file));
const mediaSize=mediaFiles.reduce((sum,file)=>sum+fs.statSync(file).size,0);
assert.ok(mediaSize<200000,'all packaged image and audio resources combined must stay below 200 KB');
assert.equal(require('../miniprogram/data/vocabulary').words.length,2616);
const executable = file => fs.readFileSync(file,'utf8').replace(/^\/\/[^\n]*\n/,'');
assert.equal(executable(path.join(mini,'lib/learning.js')),executable(path.join(root,'cloudfunctions/studySync/learning.js')),'shared core versions');
console.log(`Native project validated: ${app.pages.length} page, ${size} frontend bytes, ${audioSize} audio bytes, ${mediaSize} combined image/audio bytes, 2616 entries. AppID: ${config.appid}`);
