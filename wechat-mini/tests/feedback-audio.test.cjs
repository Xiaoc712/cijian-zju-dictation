const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {FeedbackAudio}=require('../miniprogram/lib/feedback-audio');
const {nativeAPI}=require('./helpers.cjs');
function audioAPI(deferred=false){
  const wxAPI=nativeAPI();wxAPI.contexts=[];wxAPI.calls=[];wxAPI.drivers=[];
  wxAPI.createInnerAudioContext=options=>{
    wxAPI.drivers.push(options.useWebAudioImplement);
    const audio={plays:0,stops:0,destroys:0,play(){this.plays++;wxAPI.calls.push('play '+this.src);},stop(){this.stops++;wxAPI.calls.push('stop '+this.src);},destroy(){this.destroys++;},onError(fn){this.error=fn;},onEnded(fn){this.ended=fn;}};
    if(deferred)audio.onCanplay=fn=>{audio.canplay=fn;};
    wxAPI.contexts.push(audio);return audio;
  };
  return wxAPI;
}

test('answer cues reuse prepared players, stop only current playback and respect system mute',()=>{
  const wxAPI=audioAPI(),feedback=new FeedbackAudio(wxAPI);
  feedback.play('correct');feedback.play('wrong');feedback.play('correct');
  assert.equal(wxAPI.contexts.length,2);
  const [correct,wrong]=wxAPI.contexts;
  assert.equal(correct.src,'/assets/audio/correct.mp3');assert.equal(wrong.src,'/assets/audio/wrong.mp3');
  assert.equal(correct.plays,2);assert.equal(wrong.plays,1);
  assert.equal(correct.stops,1);assert.equal(wrong.stops,1);
  assert.equal(correct.obeyMuteSwitch,true);assert.equal(correct.autoplay,false);
  assert.deepEqual(wxAPI.drivers,[true,true]);
  feedback.destroy();assert.equal(correct.destroys,1);assert.equal(wrong.destroys,1);
  feedback.play('correct');assert.equal(correct.plays,2);
});

test('muting persists across restarts and does not allocate audio resources',()=>{
  const wxAPI=audioAPI(),first=new FeedbackAudio(wxAPI);
  assert.equal(first.setEnabled(false),true);
  const reopened=new FeedbackAudio(wxAPI);reopened.play('correct');
  assert.equal(reopened.enabled,false);assert.equal(wxAPI.contexts.length,0);
  reopened.setEnabled(true);reopened.play('wrong');assert.equal(wxAPI.contexts.length,1);
  first.destroy();reopened.destroy();
});

test('failed playback rebuilds once with the native driver and never reuses a broken player',()=>{
  const wxAPI=audioAPI();let notices=0;
  const feedback=new FeedbackAudio(wxAPI,()=>{notices++;});feedback.play('wrong');
  const first=wxAPI.contexts[0];first.error({errCode:10004});
  assert.equal(first.destroys,1);assert.equal(notices,0);assert.equal(wxAPI.contexts.length,2);
  assert.deepEqual(wxAPI.drivers,[true,false]);
  assert.equal(wxAPI.contexts[1].src,'assets/audio/wrong.mp3');
  first.error({errCode:10004});assert.equal(wxAPI.contexts.length,2);
  wxAPI.contexts[1].error({errCode:10001});assert.equal(notices,1);assert.equal(wxAPI.contexts[1].destroys,1);
  feedback.play('correct');assert.equal(wxAPI.contexts[2].plays,1);
  feedback.destroy();wxAPI.contexts[0].error();assert.equal(notices,1);
  const broken=audioAPI();broken.createInnerAudioContext=()=>{throw Error('unavailable');};
  assert.doesNotThrow(()=>new FeedbackAudio(broken).play('correct'));
});

test('only the newest cue plays after loading; hide, mute and disposal cancel pending playback',()=>{
  const wxAPI=audioAPI(true),feedback=new FeedbackAudio(wxAPI);
  feedback.play('correct');feedback.play('wrong');
  const [correct,wrong]=wxAPI.contexts;correct.canplay();assert.equal(correct.plays,0);
  wrong.canplay();wrong.canplay();assert.equal(wrong.plays,1);
  feedback.play('correct');assert.equal(correct.plays,1);assert.equal(wrong.stops,1);
  correct.ended();feedback.play('wrong');assert.equal(wrong.plays,2);
  feedback.destroy();correct.canplay();wrong.canplay();assert.equal(wrong.plays,2);
  const pending=new FeedbackAudio(wxAPI);pending.play('correct');const audio=wxAPI.contexts.at(-1);
  pending.stop();audio.canplay();assert.equal(audio.plays,0);
  pending.play('wrong');const muted=wxAPI.contexts.at(-1);pending.setEnabled(false);muted.canplay();
  assert.equal(muted.plays,0);pending.destroy();
});

test('a loading timeout retries once without leaving timers or late playback behind',t=>{
  let next=0;const timers=new Map();
  t.mock.method(globalThis,'setTimeout',callback=>{timers.set(++next,callback);return next;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  const wxAPI=audioAPI(true);let notices=0;
  const feedback=new FeedbackAudio(wxAPI,()=>{notices++;});feedback.play('correct');
  timers.get(1)();assert.equal(wxAPI.contexts.length,2);assert.equal(wxAPI.contexts[0].destroys,1);
  timers.get(2)();assert.equal(notices,1);assert.equal(timers.size,0);
  wxAPI.contexts[0].canplay();wxAPI.contexts[1].canplay();
  assert.ok(wxAPI.contexts.every(audio=>audio.plays===0));feedback.destroy();
});

test('packaged cues use device-local copies when supported and gracefully fall back if storage is full',()=>{
  const wxAPI=audioAPI(),files=new Set(),copies=[];
  wxAPI.env={USER_DATA_PATH:'/user'};
  wxAPI.getFileSystemManager=()=>({accessSync:file=>{if(!files.has(file))throw Error('missing');},copyFileSync:(source,target)=>{copies.push(source);files.add(target);}});
  const feedback=new FeedbackAudio(wxAPI);feedback.play('correct');feedback.play('correct');
  assert.equal(copies.length,1);assert.equal(copies[0],'assets/audio/correct.mp3');
  assert.equal(wxAPI.contexts[0].src,'/user/cijian-feedback-mp3-v1-correct.mp3');feedback.destroy();
  const reopened=new FeedbackAudio(wxAPI);reopened.play('correct');
  assert.equal(copies.length,2,'refresh an existing cache to recover damaged old cue files');reopened.destroy();
  const full=audioAPI();full.env=wxAPI.env;full.getFileSystemManager=()=>({copyFileSync(){throw Error('quota');}});
  const fallback=new FeedbackAudio(full);fallback.play('correct');assert.equal(full.contexts[0].src,'/assets/audio/correct.mp3');fallback.destroy();
});

test('bundled cues are distinct, nonempty short mono PCM audio files',()=>{
  const files=['correct.wav','wrong.wav'].map(name=>fs.readFileSync(path.join(__dirname,'../scripts/audio-masters',name)));
  for(const data of files){
    assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');
    assert.equal(data.readUInt16LE(20),1);assert.equal(data.readUInt16LE(22),1);assert.equal(data.readUInt32LE(24),22050);assert.equal(data.readUInt16LE(34),16);
    const length=data.readUInt32LE(40);assert.equal(length,data.length-44);assert.ok(length/44100>0.2&&length/44100<0.6);
    let peak=0;for(let i=44;i<data.length;i+=2)peak=Math.max(peak,Math.abs(data.readInt16LE(i)));
    assert.ok(peak>1000&&peak<30000,'audible samples without clipping');
  }
  assert.notDeepEqual(files[0],files[1]);
});
test('bundled MP3 files contain audio frames rather than renamed WAV files or empty headers',()=>{
  const files=['correct.mp3','wrong.mp3'].map(name=>fs.readFileSync(path.join(__dirname,'../miniprogram/assets/audio',name)));
  for(const data of files){
    assert.ok(data.length>1000&&data.length<20000);
    assert.notEqual(data.toString('ascii',0,4),'RIFF');
    assert.ok(data.toString('ascii',0,3)==='ID3'||(data[0]===255&&(data[1]&224)===224));
  }
  assert.notDeepEqual(files[0],files[1]);
});
module.exports={audioAPI};
