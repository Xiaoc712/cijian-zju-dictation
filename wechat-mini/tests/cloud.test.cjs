const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../cloudfunctions/studySync/service');
const { EMPTY_STUDY } = require('../miniprogram/lib/learning');
const { memoryDatabase, clone } = require('./helpers.cjs');
const operation = (id,kind='wrong',key='apple') => ({id,key,kind});

test('cloud trusts server identity and isolates different WeChat accounts', async () => {
  const db = memoryDatabase();
  const alice = createHandler({db,getOpenid:()=> 'alice'});
  const bob = createHandler({db,getOpenid:()=> 'bob'});
  await alice({action:'sync', operations:[operation('a')]});
  const result = await bob({action:'read',openid:'alice',userId:'alice'});
  assert.deepEqual(result.records,{});
  assert.notEqual(result.userKey,(await alice({action:'read'})).userKey);
  assert.equal((await createHandler({db,getOpenid:()=>null})({action:'read'})).code,'UNAUTHENTICATED');
});
test('retrying an old event cannot overwrite a newer restored word', async () => {
  const handler = createHandler({db:memoryDatabase(),getOpenid:()=> 'same'});
  const original = {action:'sync',operations:[operation('a','mastered')]};
  await handler(original);
  await handler({action:'sync',operations:[operation('b','wrong'),operation('c','restore')]});
  const retry = await handler(original);
  assert.deepEqual(retry.records.apple,{mastered:false,wrong:true});
  assert.deepEqual(retry.acknowledged,['a']);
});
test('competing devices merge word operations and detect progress conflicts', async () => {
  const handler = createHandler({db:memoryDatabase(),getOpenid:()=> 'same'});
  const first = clone(EMPTY_STUDY), second = clone(EMPTY_STUDY);
  second.preferences.book = 'book2';
  const results = await Promise.all([
    handler({action:'sync',state:first,baseRevision:0,operations:[operation('a','wrong')]}),
    handler({action:'sync',state:second,baseRevision:0,operations:[operation('b','mastered','banana')]})
  ]);
  assert.equal(results[0].conflict,false);
  assert.equal(results[1].conflict,true);
  assert.deepEqual(results[1].state,first);
  assert.equal(results[1].records.banana.mastered,true);
  assert.equal(results[1].records.apple.wrong,true);
  assert.equal(results[1].revision,1);
});
test('invalid event reuse rolls back the complete batch', async () => {
  const db = memoryDatabase(), handler = createHandler({db,getOpenid:()=> 'same'});
  await handler({action:'sync',operations:[operation('a')]});
  const count = db.count();
  const failed = await handler({action:'sync',operations:[operation('new','mastered','banana'),operation('a','restore')]});
  assert.equal(failed.code,'EVENT_ID_REUSED');
  assert.equal(db.count(),count);
  assert.equal((await handler({action:'read'})).records.banana,undefined);
});
test('malformed and oversized sync inputs are rejected before writing', async () => {
  const db = memoryDatabase(), handler = createHandler({db,getOpenid:()=> 'same'});
  for (const event of [
    {action:'other'},
    {action:'sync',operations:Array.from({length:31},(_,i)=>operation('n'+i))},
    {action:'sync',operations:[operation('a','wrong','__proto__')]},
    {action:'sync',operations:[operation('a'),operation('a')]},
    {action:'sync',state:{},baseRevision:0},
    {action:'sync',state:EMPTY_STUDY,baseRevision:-1},
    {action:'sync',extra:'x'.repeat(900001)}
  ]) assert.equal((await handler(event)).ok,false);
  assert.equal(db.count(),0);
});
