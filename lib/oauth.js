'use strict';
const crypto = require('node:crypto');
function createOAuth({ env = process.env, records, access, fetchImpl = fetch }) {
  const adminEmail = 'xiangenhu@gmail.com';
  const origin = env.APP_URL;
  const gateway = 'https://oauth.skoonline.org';
  // Email verification uses the fixed gateway directly; client registration is
  // needed only for the Google handshake, not for encrypted local sessions.
  const ready = Boolean(origin && /^[a-f0-9]{64}$/i.test(env.SESSION_ENCRYPTION_KEY || ''));
  const googleReady = Boolean(ready && env.PROXY_CLIENT_ID && env.PROXY_CLIENT_SECRET);
  if (origin && (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)) throw Error('APP_URL must be an HTTPS origin without trailing slash');
  const key = ready ? Buffer.from(env.SESSION_ENCRYPTION_KEY, 'hex') : null;
  const callback = origin + '/api/auth/oauth/callback';
  function seal(data) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([iv, cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }
  function unseal(value) {
    const b = Buffer.from(value, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0,12));
    decipher.setAuthTag(b.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(b.subarray(12,-16)), decipher.final()]).toString());
  }
  const random = () => crypto.randomBytes(32).toString('base64url');
  const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
  const setCookie = (res, name, value, age) => res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
  const recordName = (kind,id) => `auth/${kind}/${crypto.createHash('sha256').update(id).digest('hex')}.json`;
  const role = async user => user.email.toLowerCase() === adminEmail ? 'admin' : access ? access.role(user) : null;
  async function post(endpoint, body) {
    const response = await fetchImpl(gateway + endpoint, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json', Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')}, body:JSON.stringify(body)});
    if (!response.ok) throw Object.assign(Error('Proxy request failed'),{proxyStatus:response.status});
    return response.json();
  }
  function mount(app) {
    app.get('/api/auth/config', (req,res)=>{res.set('Cache-Control','no-store');res.json({enabled:ready,emailLogin:ready,googleLogin:googleReady});});
    app.post('/api/auth/email/login',async(req,res)=>{
      res.set('Cache-Control','no-store');
      if(!ready) return res.status(503).json({error:'Sign-in is not available yet. Please contact Xiangen Hu for help, or try again later.'});
      if(req.headers.origin!==origin || req.headers['x-vpn-request']!=='1') return res.status(403).json({error:'Sign-in could not be completed. Refresh this page and try again.'});
      const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
      const password=req.body?.password;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || typeof password!=='string' || !password || password.length>1024)
        return res.status(400).json({error:'Enter your proxy email and password'});
      try {
        // Shared durable rate limit across Cloud Run instances: five attempts per
        // email per 15-minute window. Storage create preconditions reserve slots.
        const window=Math.floor(Date.now()/900000);let reserved=false;
        for(let slot=0;slot<5;slot++) {
          try {await records.put(recordName('email-attempts',email+':'+window+':'+slot),seal({expires:(window+1)*900000}));reserved=true;break;}
          catch(error){if(error.code!==412)throw error;}
        }
        if(!reserved) return res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});
        const response=await fetchImpl(gateway+'/user/login',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
        if(!response.ok) return res.status(401).json({error:'Sign-in failed. Check your proxy credentials and email verification.'});
        const data=await response.json();const u=data.user;
        const verified=[u?.emailVerified,u?.email_verified,u?.verified];
        if(data.success===false || typeof data.token!=='string' || !data.token || typeof u?.email!=='string' ||
           u.email.trim().toLowerCase()!==email || verified.includes(false) || !verified.includes(true))
          return res.status(401).json({error:'The proxy did not confirm a verified email identity'});
        const user={email,name:typeof u.name==='string'?u.name:email,provider:'email'};
        if(email!==adminEmail) {
          if(!access?.registerVerifiedEmail) throw Error('Registration unavailable');
          await access.registerVerifiedEmail(user);
          if(req.body.invite && await role(user)==='pending') await access.redeem(user,req.body.invite);
        }
        if(!await role(user)) return res.status(403).json({error:'Access denied'});
        const sid=random();
        await records.put(recordName('sessions',sid),seal({user,expires:Date.now()+28800000}));
        setCookie(res,'__Host-vpn-session',sid,28800);
        res.json({ok:true});
      } catch(error) {
        if(error.status===403) return res.status(403).json({error:error.message});
        res.status(502).json({error:'Email sign-in is temporarily unavailable. Please retry.'});
      } finally {if(req.body) delete req.body.password;}
    });
    const start = async (req,res)=>{
      if(req.method==='POST' && (req.headers.origin!==origin || req.headers['x-vpn-request']!=='1')) return res.sendStatus(403);
      res.set('Cache-Control','no-store');
      if (!googleReady) return res.status(503).send('Google sign-in is not available yet. Please use your SKO email account or try again later.');
      let stage='storage';
      try {
        const id=random(), state=random(), verifier=random();
        await records.put(recordName('pending',id), seal({state,verifier,invite:typeof req.body?.invite==='string' && /^[\w-]{24}$/.test(req.body.invite)?req.body.invite:null,expires:Date.now()+600000}));
        stage='proxy';
        const result=await post('/genai/services/oauth/start',{redirect_uri:callback,state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        stage='response';
        const url=new URL(result.url);
        if(url.origin!==gateway) throw Error('Unexpected redirect');
        setCookie(res,'__Host-vpn-login',id,600);
        if(req.method==='POST') res.json({url:url.href}); else res.redirect(url.href);
      } catch(error) {
        // Only controlled fields; never log secrets, response bodies or login URLs.
        const status=Number.isInteger(error.proxyStatus) ? error.proxyStatus : null;
        const code=stage==='storage' ? 'oauth_storage' : stage==='response' ? 'oauth_response' : status ? 'oauth_proxy_'+status : 'oauth_proxy_unavailable';
        console.warn('OAuth start failed', {code,stage,status});
        const message='Google sign-in is temporarily unavailable. Please use your SKO email account. Reference: '+code;
        res.status(502);
        if(req.method==='POST') return res.json({error:message,code});
        res.set('Content-Type','text/html; charset=utf-8');
        return res.send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in unavailable</title><body style="font:16px system-ui;background:#0a0e1a;color:#e2e8f0;padding:32px"><main style="max-width:480px;margin:10vh auto;line-height:1.7"><h1>Let’s try email sign-in</h1><p>'+message+'</p><a href="/" style="color:#83e5c8">Return to sign in</a></main></body></html>');
      }
    };
    app.get('/api/auth/oauth/start',start);
    app.post('/api/auth/oauth/start',start);
    app.get('/api/auth/oauth/callback', async(req,res)=>{
      res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
      if(!googleReady) return res.status(503).send('Google sign-in is not configured.');
      try {
        const id=cookie(req,'__Host-vpn-login');
        if(!id || !/^[\w-]{43}$/.test(id)) throw Error('Missing login');
        const pending=unseal(await records.take(recordName('pending',id)));
        setCookie(res,'__Host-vpn-login','',0);
        if(pending.expires<Date.now() || typeof req.query.state!=='string' || pending.state!==req.query.state || typeof req.query.code!=='string') throw Error('Invalid callback');
        const result=await post('/genai/services/oauth/token',{code:req.query.code,redirect_uri:callback,code_verifier:pending.verifier});
        // This endpoint authenticates Google identities; never trust identity from browser input.
        const u=result.user;
        const verified=[u?.email_verified,u?.emailVerified,u?.verified];
        if(!u || typeof u.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) || verified.includes(false) || !verified.includes(true) || (u.provider && u.provider!=='google')) throw Error('Invalid identity');
        const user={email:u.email.trim().toLowerCase(),name:typeof u.name==='string'?u.name:u.email};
        if(access && user.email!==adminEmail)await access.registerVerifiedEmail(user);
        if(access && pending.invite && user.email!==adminEmail) await access.redeem(user,pending.invite);
        if(!await role(user)) return res.status(403).send('Unable to determine VPN access. Please contact Xiangen.');
        const sid=random();
        await records.put(recordName('sessions',sid),seal({user,expires:Date.now()+28800000}));
        setCookie(res,'__Host-vpn-session',sid,28800);
        res.redirect('/');
      }catch {res.status(401).send('Sign-in failed or expired. Return to the homepage and try again.');}
    });
    app.post('/api/auth/logout',async(req,res)=>{
      if(req.headers.origin!==origin) return res.sendStatus(403);
      const sid=cookie(req,'__Host-vpn-session');
      try {if(sid && /^[\w-]{43}$/.test(sid)) await records.take(recordName('sessions',sid));}catch(error){if(error.code!==404) return res.status(503).json({error:'Unable to revoke session. Retry sign-out.'});}
      setCookie(res,'__Host-vpn-session','',0); res.json({ok:true});
    });
  }
  async function auth(req,res,next) {
    res.set('Cache-Control','no-store');
    if(!ready) return res.status(503).json({error:'Proxy login is not configured'});
    try{
      const sid=cookie(req,'__Host-vpn-session');
      if(!sid || !/^[\w-]{43}$/.test(sid)) return res.status(401).json({error:'Sign in required'});
      const session=unseal(await records.get(recordName('sessions',sid)));
      if(session.expires<Date.now()) return res.status(401).json({error:'Session expired'});
      req.authType=await role(session.user); req.user=session.user;
      if(!req.authType) return res.status(403).json({error:'Access revoked'});
      if(!['GET','HEAD','OPTIONS'].includes(req.method) && (req.headers.origin!==origin || req.headers['x-vpn-request']!=='1')) return res.status(403).json({error:'Invalid request origin'});
      if(req.authType==='pending' && !['GET /api/me','POST /api/access/request','POST /api/access/redeem'].includes(req.method+' '+req.path))
        return res.status(403).json({error:'Enter your administrator’s invitation code to unlock VPN setup',needsApproval:true});
      next();
    }catch {res.status(401).json({error:'Session unavailable; sign in again'});}
  }
  return {mount,auth};
}
module.exports={createOAuth};
