(function(root){
  'use strict';
  function validSession(s,now=Date.now()) {
    return Boolean(s && /^[A-Za-z0-9_-]{43}$/.test(s.id) && /^[A-Za-z0-9_-]{43}$/.test(s.password) &&
      Number.isFinite(s.expires) && s.expires>now && s.expires<=now+9*3600000 &&
      s.proxy?.scheme==='https' && /^[a-z0-9.-]+$/i.test(s.proxy.host) && s.proxy.host.includes('.') &&
      Number.isInteger(s.proxy.port) && s.proxy.port>0 && s.proxy.port<65536);
  }
  function credentials(details,session,tried=false,now=Date.now()) {
    if(!details.isProxy || !session || details.challenger?.host?.toLowerCase()!==session.proxy.host.toLowerCase() || details.challenger?.port!==session.proxy.port)return {};
    if(tried || session.expires<=now)return {cancel:true};
    return {authCredentials:{username:session.id,password:session.password}};
  }
  function bypass(host,portalHost,proxyHost) {return [portalHost,proxyHost].includes(host.toLowerCase().replace(/\.$/,''));}
  const api={validSession,credentials,bypass};
  root.ResearchProxy=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
