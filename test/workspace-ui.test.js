const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=script.slice(script.indexOf('  function selectWorkspace('),script.indexOf("  let currentConfig"));
function workspace(isAdmin){
 const elements={};for(const id of ['personal-workspace','management-workspace','personal-workspace-button','management-workspace-button'])elements[id]={setAttribute(key,value){this[key]=value;}};
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
test('extension setup remains selectable and legacy remote-browser selection falls back to extension',()=>{
 const elements={'extension-install':{}},mode={value:'wireguard'};let saved='browser',pending=false,choices=0;
 const configSource=script.slice(script.indexOf('  function configureConnectionModes('),script.indexOf("  document.getElementById('wireguard-installed')"));
 const configure=vm.runInNewContext(configSource+';configureConnectionModes',{
  URLSearchParams,location:{search:''},mode,document:{getElementById:id=>elements[id]},sessionStorage:{getItem:()=>pending?'ABCD-EF01-2345':null},localStorage:{getItem:()=>saved},chooseMode:()=>choices++
 });
 configure({extensionEnabled:false,browserEnabled:false});assert.equal(mode.value,'extension');assert.equal(elements['extension-install'].hidden,false);
 saved='wireguard';configure({extensionEnabled:true});assert.equal(mode.value,'wireguard');
 pending=true;configure({extensionEnabled:true});assert.equal(mode.value,'extension');assert.equal(choices,3);
 const select=html.match(/<select id="connection-mode">([\s\S]*?)<\/select>/)[1];
 assert.ok(select.includes('value="extension"'));assert.ok(!select.includes('disabled'));assert.ok(!select.includes('value="browser"'));
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
