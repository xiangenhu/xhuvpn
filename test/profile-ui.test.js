const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=script.slice(script.indexOf('  async function addPeer()'),script.indexOf('  async function viewConfig('));
function fixture(request) {
 const elements={'peer-name':{value:'My-Windows'},'add-btn':{disabled:false},'add-msg':{scrollIntoView(){},focus(){this.focused=true;}}};
 const opened=[];let calls=0,refreshed=0,downloads=0,timer;
 const addPeer=vm.runInNewContext(source+';addPeer',{
  document:{getElementById:id=>elements[id]},AbortController,
  devicePlatform:{value:'windows'},downloadConfig:()=>downloads++,
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{},
  jsonRequest:(...args)=>{calls++;return request(...args);},
  suggestDeviceName:()=>{elements['peer-name'].value='Next-device';},
  showModal:(...args)=>opened.push(args),loadAll:()=>refreshed++,
 });
 return {elements,opened,addPeer,calls:()=>calls,downloads:()=>downloads,refreshed:()=>refreshed,timeout:()=>timer()};
}
test('profile creation shows progress, prevents duplicate clicks and opens download setup',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=f.addPeer();
 assert.match(f.elements['add-msg'].textContent,/connecting to the VPN machine/);
 assert.equal(f.elements['add-btn'].disabled,true);
 await f.addPeer();assert.equal(f.calls(),1);
 finish({name:'My-Windows',ip:'10.8.0.2',config:'[Interface]\nPrivateKey = test',qr:'test-qr'});await pending;
 assert.equal(f.opened.length,1);assert.equal(f.opened[0][0],'My-Windows');
 assert.equal(f.downloads(),1);assert.match(f.elements['add-msg'].textContent,/download has started/);
 assert.equal(f.elements['add-btn'].disabled,false);assert.equal(f.refreshed(),1);
});
test('failed preflight stays visible and does not pretend to create a profile',async()=>{
 const f=fixture(async()=>{throw Error('Server setup needs attention');});await f.addPeer();
 assert.equal(f.elements['add-msg'].textContent,'Server setup needs attention');assert.equal(f.opened.length,0);
 assert.equal(f.elements['peer-name'].value,'My-Windows');assert.equal(f.elements['add-msg'].focused,true);
});
test('client timeout directs users to saved devices instead of silently retrying creation',async()=>{
 const f=fixture((path,body,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
 const pending=f.addPeer();f.timeout();await pending;
 assert.match(f.elements['add-msg'].textContent,/Check My devices/);assert.equal(f.calls(),1);assert.equal(f.opened.length,0);
});
