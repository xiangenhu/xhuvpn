'use strict';
const crypto = require('node:crypto');
const ADMIN = 'xiangenhu@gmail.com';
class AccessError extends Error { constructor(status, message) { super(message); this.status=status; } }
const emailOf = value => {
  if(typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || value.length>254) throw new AccessError(400,'Enter a valid email address');
  return value.trim().toLowerCase();
};
const digest = code => crypto.createHash('sha256').update(code).digest('hex');
function createAccess({store,origin,now=Date.now}) {
  async function role(user) {
    const email=emailOf(user.email);
    if(email===ADMIN) return 'admin';
    const {value}=await store.read();
    if(value.users[email]?.enabled===false) return 'pending';
    return value.users[email]?.enabled ? 'user' : value.requests?.[email] ? 'pending' : null;
  }
  async function invite(email) {
    email=emailOf(email);
    if(email===ADMIN) throw new AccessError(400,'The administrator does not need an invitation');
    const code=crypto.randomBytes(18).toString('base64url');
    const expires=now()+7*86400000;
    await store.update(state=>{
      const pending=new Set(Object.values(state.invites).filter(i=>i.expires>now()).map(i=>i.email));
      Object.entries(state.users).filter(([,u])=>u.enabled).forEach(([e])=>pending.add(e));
      if(!pending.has(email) && pending.size>=9) throw new AccessError(409,'Limit: nine friends plus the administrator');
      for(const [hash,invite] of Object.entries(state.invites)) if(invite.email===email || invite.expires<=now()) delete state.invites[hash];
      state.invites[digest(code)]={email,expires};
    });
    return {email,code,expires:new Date(expires).toISOString(),url:origin+'/#invite='+encodeURIComponent(code)};
  }
  async function redeem(user,code) {
    const email=emailOf(user.email);
    if(email===ADMIN) return;
    if(typeof code!=='string' || !/^[\w-]{24}$/.test(code)) throw new AccessError(403,'A valid invitation is required');
    await store.update(state=>{
      const invite=state.invites[digest(code)];
      if(!invite || invite.expires<=now() || invite.email!==email) throw new AccessError(403,'Invitation is expired, already used, or belongs to another email');
      // Disabling deletes every outstanding code. A valid new code therefore
      // represents a fresh, explicit administrator grant, including reapproval.
      state.users[email]={email,name:typeof user.name==='string'?user.name:email,enabled:true,joinedAt:state.users[email]?.joinedAt || new Date(now()).toISOString()};
      delete state.invites[digest(code)];
      if(state.requests) delete state.requests[email];
    });
  }
  async function disable(email) {
    email=emailOf(email);
    if(email===ADMIN) throw new AccessError(400,'The sole administrator cannot be disabled');
    await store.update(state=>{
      state.users[email]={...(state.users[email] || {}),email,enabled:false,disabledAt:new Date(now()).toISOString()};
      for(const [hash,invite] of Object.entries(state.invites)) if(invite.email===email) delete state.invites[hash];
      state.retiredPeerKeys ||= {};
      for(const peer of state.peers)if(peer.owner?.toLowerCase()===email && peer.pubKey)state.retiredPeerKeys[peer.pubKey]=true;
      state.peers=state.peers.filter(p=>p.owner?.toLowerCase()!==email);
      if(state.requests) delete state.requests[email];
    });
  }
  async function registerVerifiedEmail(user) {
    const email=emailOf(user.email);
    if(email===ADMIN) return;
    await store.update(state=>{
      if(state.users[email]?.enabled) return;
      state.requests ||= {};
      state.requests[email] ||= {email,name:user.name || email,createdAt:new Date(now()).toISOString()};
    });
  }
  async function requestApproval(user) {
    const email=emailOf(user.email);
    return store.update(state=>{
      const request=state.requests?.[email];
      if(!request || state.users[email]?.enabled) throw new AccessError(409,'Approval request is not needed');
      if(request.requestedAt && now()-Date.parse(request.requestedAt)<86400000) return {email,alreadyRequested:true};
      request.requestedAt=new Date(now()).toISOString();
      return {email,requestedAt:request.requestedAt};
    });
  }
  async function summary() {
    const {value}=await store.read();
    return {users:Object.values(value.users).map(u=>({...u,deviceCount:value.peers.filter(p=>p.owner===u.email).length})),invitations:Object.values(value.invites).filter(i=>i.expires>now()),requests:Object.values(value.requests || {}).filter(r=>r.requestedAt)};
  }
  return {role,invite,redeem,disable,summary,registerVerifiedEmail,requestApproval};
}
module.exports={ADMIN,AccessError,emailOf,createAccess};
