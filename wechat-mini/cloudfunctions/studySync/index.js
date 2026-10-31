const cloud = require('wx-server-sdk');
const { createHandler } = require('./service');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
exports.main = createHandler({ db, getOpenid: () => cloud.getWXContext().OPENID });
