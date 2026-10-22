'use strict';
const crypto = require('node:crypto');
function createOAuth({ env = process.env, records, fetchImpl = fetch }) {
  const adminEmail = 'xiangenhu@gmail.com';
  const origin = env.APP_URL;
  const gateway = 'https://oauth.skoonline.org';
  const ready = Boolean(origin && env.PROXY_CLIENT_ID && env.PROXY_CLIENT_SECRET && /^[a-f0-9]{64}$/i.test(env.SESSION_ENCRYPTION_KEY || ''));
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
  const role = user => user.email.toLowerCase() === adminEmail ? 'admin' : null;
  async function post(endpoint, body) {
    const response = await fetchImpl(gateway + endpoint, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json', Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')}, body:JSON.stringify(body)});
    if (!response.ok) throw Error('Proxy request failed');
    return response.json();
  }
  function mount(app) {
    app.get('/api/auth/config', (req,res)=>res.json({enabled:ready}));
    app.get('/api/auth/oauth/start', async (req,res)=>{
      res.set('Cache-Control','no-store');
      if (!ready) return res.status(503).send('Administrator must configure proxy login first.');
      try {
        const id=random(), state=random(), verifier=random();
        await records.put(recordName('pending',id), seal({state,verifier,expires:Date.now()+600000}));
        const result=await post('/genai/services/oauth/start',{redirect_uri:callback,state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        const url=new URL(result.url);
        if(url.origin!==gateway) throw Error('Unexpected redirect');
        setCookie(res,'__Host-vpn-login',id,600);
        res.redirect(url.href);
      } catch { res.status(502).send('Unable to start proxy login. Check client registration and try again.'); }
    });
    app.get('/api/auth/oauth/callback', async(req,res)=>{
      res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
      if(!ready) return res.status(503).send('Login is not configured.');
      try {
        const id=cookie(req,'__Host-vpn-login');
        if(!id || !/^[\w-]{43}$/.test(id)) throw Error('Missing login');
        const pending=unseal(await records.take(recordName('pending',id)));
        setCookie(res,'__Host-vpn-login','',0);
        if(pending.expires<Date.now() || typeof req.query.state!=='string' || pending.state!==req.query.state || typeof req.query.code!=='string') throw Error('Invalid callback');
        const result=await post('/genai/services/oauth/token',{code:req.query.code,redirect_uri:callback,code_verifier:pending.verifier});
        // This endpoint authenticates Google identities; never trust identity from browser input.
        const u=result.user;
        if(!u || typeof u.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) || u.email_verified===false || u.verified===false || (u.provider && u.provider!=='google')) throw Error('Invalid identity');
        const user={email:u.email.trim().toLowerCase(),name:typeof u.name==='string'?u.name:u.email};
        if(!role(user)) return res.status(403).send('Only xiangenhu@gmail.com may administer this VPN.');
        const sid=random();
        await records.put(recordName('sessions',sid),seal({user,expires:Date.now()+28800000}));
        setCookie(res,'__Host-vpn-session',sid,28800);
        res.redirect('/');
      }catch {res.status(401).send('Sign-in failed or expired. Return to the homepage and try again.');}
    });
    app.post('/api/auth/logout',async(req,res)=>{
      if(req.headers.origin!==origin) return res.sendStatus(403);
      const sid=cookie(req,'__Host-vpn-session');
      try {if(sid && /^[\w-]{43}$/.test(sid)) await records.take(recordName('sessions',sid));}catch{}
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
      req.authType=role(session.user); req.user=session.user;
      if(!req.authType) return res.status(403).json({error:'Access revoked'});
      if(!['GET','HEAD','OPTIONS'].includes(req.method) && (req.headers.origin!==origin || req.headers['x-vpn-request']!=='1')) return res.status(403).json({error:'Invalid request origin'});
      next();
    }catch {res.status(401).json({error:'Session unavailable; sign in again'});}
  }
  return {mount,auth};
}
module.exports={createOAuth};
