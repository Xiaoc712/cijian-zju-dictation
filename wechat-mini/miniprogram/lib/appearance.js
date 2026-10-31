const STORAGE_KEY = 'cijian-appearance-v1';
const PALETTES = {
  light: { background: '#f7f8fc', navigation: '#ffffff', foreground: '#000000', textStyle: 'dark' },
  dark: { background: '#101116', navigation: '#1b1d25', foreground: '#ffffff', textStyle: 'light' }
};

class Appearance {
  constructor(wxAPI) {
    this.wx = wxAPI;
    let saved;
    try { saved = wxAPI.getStorageSync(STORAGE_KEY); } catch (_) {}
    this.mode = saved === 'dark' ? 'dark' : 'light';
  }
  apply() {
    const palette = PALETTES[this.mode];
    const call = (name, options) => {
      try { if (typeof this.wx[name] === 'function') this.wx[name]({ ...options, fail() {} }); }
      catch (_) { /* Native chrome support varies by client; the page theme still applies. */ }
    };
    call('setNavigationBarColor', { frontColor: palette.foreground, backgroundColor: palette.navigation });
    call('setBackgroundColor', { backgroundColor: palette.background, backgroundColorTop: palette.background, backgroundColorBottom: palette.background });
    call('setBackgroundTextStyle', { textStyle: palette.textStyle });
  }
  select(mode) {
    if (mode !== 'light' && mode !== 'dark') return true;
    this.mode = mode;
    this.apply();
    try { this.wx.setStorageSync(STORAGE_KEY, mode); return true; }
    catch (_) { return false; }
  }
}

module.exports = { Appearance, STORAGE_KEY, PALETTES };
