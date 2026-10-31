import {spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
const savedFlags = [process.env.USE_OAUTH_GCS, process.env.USE_OAUTH_LRS];
process.env.USE_OAUTH_GCS = 'false'; process.env.USE_OAUTH_LRS = 'false';
const {configureInfrastructure,policy} = await import('./oauth-infrastructure.mjs');
for (const [index,key] of ['USE_OAUTH_GCS','USE_OAUTH_LRS'].entries()) {
  if (savedFlags[index] === undefined) delete process.env[key]; else process.env[key] = savedFlags[index];
}
const original=()=>({PROXY_CLIENT_ID:'test-client',PROXY_CLIENT_SECRET:'test-secret',...Object.fromEntries(policy.bucket.map(k=>[k,'original-bucket'])),LRS_ENDPOINT:'https://original.example/xapi/',LRS_USERNAME:'old-user',LRS_PASSWORD:'old-secret'});
const settings={bucket:'registered-bucket',primary:{endpoint:'https://learn.example/xapi/',username:'u',password:'s'},debug:{endpoint:'https://debug.example/xapi/',username:'du',password:'ds'},webhooks:{endpoint:'https://hooks.example/xapi/',username:'hu',password:'hs'}};
const response=s=>({ok:true,json:async()=>({appId:'test-client',optionalConnections:s})});
test('off by default; no network or native settings changes',async()=>{const env=original(),before={...env};await configureInfrastructure(env,()=>{throw Error('Unexpected fetch');});assert.deepEqual(env,before);});
test('all four switch combinations and native mappings',async()=>{
for(const gcs of [false,true])for(const lrs of [false,true]){
const env={...original(),USE_OAUTH_GCS:String(gcs),USE_OAUTH_LRS:String(lrs)};let calls=0;
await configureInfrastructure(env,async(url,o)=>{calls++;assert.equal(url.pathname,'/genai/services/config');assert.deepEqual(JSON.parse(o.body),{gcs,lrs});assert.equal(o.redirect,'error');assert.equal(o.headers.Authorization,'Basic '+Buffer.from('test-client:test-secret').toString('base64'));return response(settings);});
assert.equal(calls,gcs||lrs?1:0);
for(const k of policy.bucket)assert.equal(env[k],gcs?'registered-bucket':'original-bucket');
assert.equal(env.LRS_PASSWORD,lrs?'s':'old-secret');
if(lrs){assert.equal(env.BUG_LRS_PASSWORD,'ds');assert.equal(env.WORKBUDDY_LRS_PASSWORD,'hs');assert.equal(env.XAPI_AUTHORIZATION,'Basic '+Buffer.from('u:s').toString('base64'));}
}});
test('missing/partial profiles and outages preserve originals',async()=>{const env={...original(),USE_OAUTH_GCS:'true',USE_OAUTH_LRS:'true'},before={...env};await configureInfrastructure(env,async()=>response({primary:{endpoint:'https://partial.example/'}}));assert.deepEqual(env,before);await configureInfrastructure(env,async()=>{throw Error('offline');});assert.deepEqual(env,before);for(const status of [429,500,503]){await configureInfrastructure(env,async()=>({ok:false,status}));assert.deepEqual(env,before);}});
test('bad credentials/identity/profile fail without partial writes',async()=>{const env={...original(),USE_OAUTH_GCS:'true',USE_OAUTH_LRS:'true'},before={...env};for(const status of [401,403,404])await assert.rejects(configureInfrastructure(env,async()=>({ok:false,status})));await assert.rejects(configureInfrastructure(env,async()=>({ok:true,json:async()=>({appId:'other',optionalConnections:settings})})));await assert.rejects(configureInfrastructure(env,async()=>response({...settings,debug:{...settings.debug,endpoint:'http://bad.example/'}})));assert.deepEqual(env,before);});


test('real Node preloader completes before entrypoint with default-false switches',()=>{
 const env={...process.env,GCS_BUCKET:'startup-original',GCS_BUCKET_NAME:'startup-original'};
 delete env.USE_OAUTH_GCS; delete env.USE_OAUTH_LRS;
 env.SKIP_DOTENV='true';
 const child=spawnSync(process.execPath,['--import','./oauth-infrastructure.mjs','--input-type=module','-e',"console.log(JSON.stringify([process.env.USE_OAUTH_GCS,process.env.USE_OAUTH_LRS,process.env.GCS_BUCKET,process.env.GCS_BUCKET_NAME]))"],{env,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout.trim()),['false','false','startup-original','startup-original']);
});
