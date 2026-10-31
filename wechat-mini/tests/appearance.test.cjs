const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { nativeAPI } = require('./helpers.cjs');
const { Appearance, STORAGE_KEY, PALETTES } = require('../miniprogram/lib/appearance');

test('appearance defaults to light, validates saved values and persists both manual choices', () => {
  const wx = nativeAPI(), appearance = new Appearance(wx);
  assert.equal(appearance.mode, 'light');
  appearance.select('dark');assert.equal(new Appearance(wx).mode, 'dark');
  appearance.select('light');assert.equal(new Appearance(wx).mode, 'light');
  for (const value of ['system', '__proto__', {}, null]) {
    wx.storage.set(STORAGE_KEY, value);
    assert.equal(new Appearance(wx).mode, 'light');
  }
  appearance.select('dark');appearance.select('unsupported');
  assert.equal(appearance.mode, 'dark');
});

test('both themes update native navigation text, background and overscroll colors together', () => {
  const wx = nativeAPI(), calls = {};
  for (const api of ['setNavigationBarColor', 'setBackgroundColor', 'setBackgroundTextStyle']) wx[api] = options => { calls[api] = options; };
  const appearance = new Appearance(wx);
  for (const mode of ['dark', 'light']) {
    appearance.select(mode);
    assert.equal(calls.setNavigationBarColor.frontColor, PALETTES[mode].foreground);
    assert.equal(calls.setNavigationBarColor.backgroundColor, PALETTES[mode].navigation);
    assert.equal(calls.setBackgroundColor.backgroundColor, PALETTES[mode].background);
    assert.equal(calls.setBackgroundColor.backgroundColorBottom, PALETTES[mode].background);
    assert.equal(calls.setBackgroundTextStyle.textStyle, PALETTES[mode].textStyle);
  }
});

test('storage and unsupported native chrome APIs cannot stop appearance switching', () => {
  const wx = nativeAPI();
  wx.getStorageSync = () => { throw Error('storage unavailable'); };
  wx.setStorageSync = () => { throw Error('quota'); };
  wx.setNavigationBarColor = () => { throw Error('unsupported'); };
  const appearance = new Appearance(wx);
  assert.equal(appearance.mode, 'light');
  assert.equal(appearance.select('dark'), false);
  assert.equal(appearance.mode, 'dark');
  assert.doesNotThrow(() => appearance.apply());
});

test('shared palettes cover every UI color token and maintain readable text contrast', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const theme = fs.readFileSync(path.join(root, 'pages/study/theme.wxss'), 'utf8');
  const palettes = [...theme.matchAll(/(\.screen(?:\.theme-dark)?)\s*\{([^}]+)\}/g)]
    .map(match => Object.fromEntries([...match[2].matchAll(/--([\w-]+):\s*(#[\da-f]+);/g)].map(m => [m[1], m[2]])))
    .filter(palette => palette.ink);
  assert.equal(palettes.length, 2);
  const css = ['app.wxss', 'pages/study/index.wxss'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const luminance = hex => {
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i, i+2),16)/255).map(c => c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
  };
  for (const palette of palettes) {
    for (const match of css.matchAll(/var\(--([\w-]+)\)/g)) if (!match[1].startsWith('preview-')) assert.ok(palette[match[1]], match[1]);
    for (const [text,background] of [['ink','surface'],['text','surface'],['muted','surface-alt'],['mask-ink','mask'],['accent','accent-soft'],['on-accent','accent-fill'],['positive','positive-soft'],['negative','negative-soft'],['warning','warning-soft'],['on-accent','action-plus-top'],['on-accent','action-plus-bottom'],['on-accent','action-minus-top'],['on-accent','action-minus-bottom'],['action-cut-ink','action-cut-top'],['action-cut-ink','action-cut-bottom']]) {
      const values = [luminance(palette[text]),luminance(palette[background])].sort((a,b)=>b-a);
      assert.ok((values[0]+0.05)/(values[1]+0.05)>=4.5, text+' on '+background);
    }
    assert.equal(palette.canvas, palettes.indexOf(palette)===0?PALETTES.light.background:PALETTES.dark.background);
    assert.equal(palette.surface, palettes.indexOf(palette)===0?PALETTES.light.navigation:PALETTES.dark.navigation);
  }
});
