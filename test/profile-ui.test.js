const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=script.slice(script.indexOf('  async function addPeer()'),script.indexOf('  async function viewConfig('));
function fixture(request) {
 const elements={'peer-name':{value:'My-Windows'},'add-btn':{disabled:false},'profile-problem':{hidden:true},'profile-result':{hidden:true},'add-msg':{scrollIntoView(){},focus(){this.focused=true;}}};
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
 assert.equal(f.downloads(),0);assert.match(f.elements['add-msg'].textContent,/Click Download/);
 assert.equal(f.elements['add-btn'].disabled,false);assert.equal(f.refreshed(),1);
});
test('failed preflight stays visible and does not pretend to create a profile',async()=>{
 const f=fixture(async()=>{throw Error('Server setup needs attention');});await f.addPeer();
 assert.equal(f.elements['add-msg'].textContent,'Server setup needs attention');assert.equal(f.opened.length,0);
 assert.equal(f.elements['peer-name'].value,'My-Windows');assert.equal(f.elements['add-msg'].focused,true);
 assert.equal(f.elements['profile-problem'].hidden,false);assert.equal(f.elements['profile-result'].hidden,true);
});
test('client timeout directs users to saved devices instead of silently retrying creation',async()=>{
 const f=fixture((path,body,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
 const pending=f.addPeer();f.timeout();await pending;
 assert.match(f.elements['add-msg'].textContent,/Check Download a previous WireGuard file/);assert.equal(f.calls(),1);assert.equal(f.opened.length,0);
});
test('profile instructions remain open until explicit dismissal and focus follows the dialog',()=>{
 const elements={};
 const names=new Set();
 for(const id of ['inline-import-instructions','inline-connection-result','profile-create-step','profile-ready-inline','profile-download','modal-download','profile-filename','profile-result','profile-problem','device-platform','profile-steps','setup-instructions','connection-result','config-details','modal-title','modal-config','modal-qr','config-modal','profile-dialog','add-btn'])
  elements[id]={value:'windows',style:{},scrollIntoView(){},focus(){this.focused=true;},removeAttribute(key){delete this[key];},classList:{add:name=>names.add(name),remove:name=>names.delete(name)}};
 const modalSource=script.slice(script.indexOf('  function showModal('),script.indexOf('  async function importDevices('));
 const modal=vm.runInNewContext(modalSource+';({showModal,closeModal})',{
  document:{getElementById:id=>elements[id]},currentConfig:'',currentPeerName:'',
  setTimeout:()=>{throw Error('Profile instructions must not auto-dismiss');}
 });
 modal.showModal('My-Windows','[Interface]','qr');
 assert.equal(elements['profile-download'].href,'/api/peers/My-Windows/config');
 assert.equal(elements['profile-download'].download,'My-Windows.conf');
 assert.equal(elements['modal-download'].textContent,'Download My-Windows.conf');
 assert.equal(names.has('open'),true);assert.equal(elements['profile-dialog'].focused,true);
 assert.equal(elements['profile-steps'].hidden,false);
 assert.match(elements['setup-instructions'].textContent,/Activate/);
 modal.closeModal();assert.equal(names.has('open'),false);assert.equal(elements['add-btn'].focused,true);
 assert.equal(elements['profile-result'].hidden,false);assert.equal(elements['profile-download'].href,'/api/peers/My-Windows/config');
 assert.equal(elements['modal-config'].textContent,'');
 elements['device-platform'].value='mobile';modal.showModal('Phone','[Interface]','qr');
 assert.equal(elements['profile-steps'].hidden,true);assert.match(elements['setup-instructions'].textContent,/scan this QR code/);
 modal.closeModal();elements['device-platform'].value='windows';modal.showModal('Desktop','[Interface]','qr',false);
 assert.equal(names.has('open'),false);assert.equal(elements['profile-create-step'].hidden,false);assert.equal(elements['profile-result'].hidden,false);
 assert.equal(elements['profile-ready-inline'].focused,true);assert.equal(elements['profile-download'].download,'Desktop.conf');
 assert.throws(()=>modal.showModal('Broken',undefined,''),/No downloadable profile/);
});
test('opening an unavailable saved profile leaves a readable error on the page',async()=>{
 const elements={'profile-problem':{hidden:true},'add-msg':{focus(){this.focused=true;},scrollIntoView(){}}};
 const viewSource=script.slice(script.indexOf('  async function viewConfig('),script.indexOf('  async function removePeer('));
 const viewConfig=vm.runInNewContext(viewSource+';viewConfig',{
  document:{getElementById:id=>elements[id]},
  apiFetch:async()=>({ok:false,json:async()=>({error:'Imported device: use its original file.'})}),
  showModal:()=>{throw Error('Must not report a missing file as ready');},
  alert:()=>{throw Error('Errors must stay on the page');}
 });
 await viewConfig('Old-device');assert.match(elements['add-msg'].textContent,/original file/);
 assert.equal(elements['profile-problem'].hidden,false);assert.equal(elements['add-msg'].focused,true);
});
