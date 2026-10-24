const {test}=require('node:test'),assert=require('node:assert/strict');
const {profileStep}=require('../lib/profile-step');
const {AccessError}=require('../lib/access');
test('profile failures identify the stage and a log reference without exposing private errors',async()=>{
 const logged=[];
 await assert.rejects(profileStep('saving this device registration',async()=>{throw Error('private key secret');},(...args)=>logged.push(args)),error=>{
  assert.equal(error.status,503);assert.match(error.message,/saving this device registration/);
  assert.match(error.message,new RegExp(logged[0][1].reference));assert.ok(!error.message.includes('private key secret'));return true;
 });
 assert.ok(!JSON.stringify(logged).includes('private key secret'));
 const known=new AccessError(409,'Device address is already reserved');
 await assert.rejects(profileStep('checking existing VPN devices',async()=>{throw known;}),error=>error===known);
 assert.equal(await profileStep('saving',async()=>42),42);
});
