const config = require('./config');
App({
  globalData: { cloudReady: false },
  onLaunch() {
    if (config.storageMode === 'cloud' && config.cloudEnv && wx.cloud) {
      try { wx.cloud.init({ env: config.cloudEnv }); this.globalData.cloudReady = true; }
      catch (error) { console.error('云开发初始化失败', error); }
    }
  }
});
