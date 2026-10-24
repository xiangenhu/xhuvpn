const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=script.slice(script.indexOf('  function selectWorkspace('),script.indexOf("  let currentConfig"));
function workspace(isAdmin){
 const elements={};for(const id of ['personal-workspace','management-workspace','traffic-section','traffic-workspace-button','personal-workspace-button','management-workspace-button'])elements[id]={setAttribute(key,value){this[key]=value;}};
 const select=vm.runInNewContext(source+';selectWorkspace',{isAdmin,document:{getElementById:id=>elements[id]}});
 return {elements,select};
}
test('owner can switch between self and management; member cannot open management',()=>{
 const owner=workspace(true);owner.select('personal');
 assert.equal(owner.elements['personal-workspace'].hidden,false);assert.equal(owner.elements['management-workspace'].hidden,true);
 assert.equal(owner.elements['management-workspace-button'].hidden,false);
 owner.select('management');assert.equal(owner.elements['personal-workspace'].hidden,true);assert.equal(owner.elements['management-workspace-button']['aria-pressed'],'true');
 const member=workspace(false);member.select('management');
 assert.equal(member.elements['management-workspace'].hidden,true);assert.equal(member.elements['personal-workspace'].hidden,false);assert.equal(member.elements['management-workspace-button'].hidden,true);
});
test('owner personal list excludes other members while management receives all devices',async()=>{
 const devices=[{name:'mine',owner:'owner@example.com'},{name:'friend-phone',owner:'friend@example.com'}],rendered=[];
 const loadSource=script.slice(script.indexOf('  async function loadPeers('),script.indexOf('  function renderPeerRows('));
 const load=vm.runInNewContext(loadSource+';loadPeers',{
  currentUser:{email:'owner@example.com'},isAdmin:true,apiFetch:async()=>({ok:true,json:async()=>devices}),renderPeerRows:(...args)=>rendered.push(args)
 });
 await load();assert.equal(rendered[0][0],'peers-list');assert.equal(rendered[0][1].length,1);assert.equal(rendered[0][1][0].name,'mine');
 assert.equal(rendered[1][0],'admin-peers-list');assert.equal(rendered[1][1].length,2);assert.equal(rendered[1][2],true);
});
test('the portal offers WireGuard without extension or remote-browser controls',()=>{
 assert.ok(html.includes('id="wireguard-panel"'));
 for(const id of ['connection-mode','extension-panel','browser-panel','extension-install'])assert.ok(!html.includes('id="'+id+'"'));
 assert.ok(!script.includes('/api/extension/'));assert.ok(!script.includes('/api/browser/'));
 assert.ok(!html.includes('Research Network extension'));
});
test('personal saved-file view does not expose device names or IP addresses',()=>{
 const makeNode=()=>({children:[],append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(){}});
 const personal=makeNode(),management=makeNode();
 const renderSource=script.slice(script.indexOf('  function renderPeerRows('),script.indexOf('  function loadAll('));
 const render=vm.runInNewContext(renderSource+';renderPeerRows',{
  document:{getElementById:id=>id==='peers-list'?personal:management,createElement:makeNode},viewConfig(){},checkConnection(){},removePeer(){}
 });
 const records=[{name:'internal-device-name',ip:'10.8.0.2',owner:'colleague@example.com',hasConfig:true}];
 render('peers-list',records,false);
 const text=personal.children[0].children.map(n=>n.textContent).join(' ');
 assert.match(text,/WireGuard configuration/);assert.ok(!text.includes('internal-device-name'));assert.ok(!text.includes('10.8.0.2'));assert.ok(!/device/i.test(text));
 render('admin-peers-list',records,true);assert.match(management.children[0].children[0].textContent,/internal-device-name.*10\.8\.0\.2.*colleague@example.com/);
});
