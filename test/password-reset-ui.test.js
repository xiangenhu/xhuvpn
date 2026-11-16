const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=script.slice(script.indexOf("  let resetEmail="),script.indexOf("  let registrationEmail="));
function fixture(request=async()=>({ok:true,message:'Done'})) {
  const elements={},calls=[],messages=[];
  for(const id of ['password-reset','email-registration','signin-email','signin-password','reset-request-form','reset-email','reset-account','reset-verify-form','reset-code','resend-reset-code','reset-password-form','reset-new-password','reset-confirm-password','restart-password-reset','reset-msg']) {
    const handlers={};elements[id]={value:'',hidden:false,disabled:false,handlers,focus(){this.focused=true;},addEventListener(name,fn){handlers[name]=fn;}};
  }
  elements['password-reset'].querySelectorAll=()=>Object.values(elements);
  vm.runInNewContext(source,{
    document:{getElementById:id=>elements[id]},TextEncoder,
    jsonRequest:async(path,body)=>{calls.push({path,body:structuredClone(body)});return request(path,body);},
    showMsg:(...args)=>messages.push(args)
  });
  async function event(id,name='submit'){return elements[id].handlers[name]({preventDefault(){},currentTarget:elements[id]});}
  async function send(){elements['reset-email'].value=' Friend@Example.com ';await event('reset-request-form');}
  async function verify(){elements['reset-code'].value='123456';await event('reset-verify-form');}
  return {elements,calls,messages,event,send,verify};
}

test('forgot-password UI advances through email, code, and new password, then focuses sign-in',async()=>{
  const f=fixture();f.elements['signin-email'].value='friend@example.com';
  f.elements['password-reset'].open=true;await f.event('password-reset','toggle');
  assert.equal(f.elements['reset-email'].value,'friend@example.com');assert.equal(f.elements['email-registration'].open,false);
  await f.send();
  assert.equal(f.calls[0].path,'/api/auth/email/forgot-password');assert.equal(f.calls[0].body.email,'friend@example.com');
  assert.equal(f.elements['reset-request-form'].hidden,true);assert.equal(f.elements['reset-verify-form'].hidden,false);
  assert.equal(f.elements['reset-code'].focused,true);assert.match(f.elements['reset-account'].textContent,/friend@example.com/);
  await f.verify();
  assert.equal(f.calls[1].path,'/api/auth/email/verify-reset-code');assert.equal(f.calls[1].body.code,'123456');
  assert.equal(f.elements['reset-code'].value,'');assert.equal(f.elements['reset-password-form'].hidden,false);
  assert.equal(f.elements['reset-new-password'].focused,true);
  f.elements['reset-new-password'].value=f.elements['reset-confirm-password'].value='my-new-password';
  await f.event('reset-password-form');
  assert.deepEqual(f.calls[2],{path:'/api/auth/email/reset-password',body:{email:'friend@example.com',newPassword:'my-new-password'}});
  assert.equal(f.elements['reset-new-password'].value,'');assert.equal(f.elements['reset-confirm-password'].value,'');
  assert.equal(f.elements['password-reset'].open,false);assert.equal(f.elements['signin-email'].value,'friend@example.com');
  assert.equal(f.elements['signin-password'].focused,true);assert.equal(f.messages.length,1);
});

test('password mismatch and byte limits do not submit a password',async()=>{
  const f=fixture();await f.send();await f.verify();
  f.elements['reset-new-password'].value='my-new-password';f.elements['reset-confirm-password'].value='different-password';
  await f.event('reset-password-form');assert.equal(f.calls.length,2);assert.match(f.elements['reset-msg'].textContent,/do not match/);
  f.elements['reset-new-password'].value=f.elements['reset-confirm-password'].value='汉'.repeat(25);
  await f.event('reset-password-form');assert.equal(f.calls.length,2);assert.match(f.elements['reset-msg'].textContent,/72 UTF-8 bytes/);
});

test('expired or uncertain resets return to code request and clear password fields',async()=>{
  const f=fixture(async path=>{
    if(path.endsWith('/reset-password'))throw Object.assign(Error('Request a new code.'),{restartReset:true});
    return {ok:true,message:'Done'};
  });
  await f.send();await f.verify();
  f.elements['reset-new-password'].value=f.elements['reset-confirm-password'].value='my-new-password';
  await f.event('reset-password-form');
  assert.equal(f.elements['reset-request-form'].hidden,false);assert.equal(f.elements['reset-password-form'].hidden,true);
  assert.equal(f.elements['reset-email'].focused,true);assert.equal(f.elements['reset-new-password'].value,'');
  assert.equal(f.elements['reset-msg'].textContent,'Request a new code.');assert.equal(f.messages.length,0);
});

test('reset UI prevents duplicate requests, shows progress, and permits recovery from failures',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));
  const first=f.send();assert.match(f.elements['reset-msg'].textContent,/Sending/);
  assert.equal(f.elements['reset-email'].disabled,true);await f.send();assert.equal(f.calls.length,1);
  finish({ok:true,message:'Check your email.'});await first;
  assert.equal(f.elements['reset-email'].disabled,false);assert.equal(f.elements['reset-msg'].textContent,'Check your email.');
  await f.event('restart-password-reset','click');assert.equal(f.elements['reset-request-form'].hidden,false);
  const failure=fixture(async()=>{throw Error('Temporarily unavailable.');});await failure.send();
  assert.equal(failure.elements['reset-request-form'].hidden,false);assert.equal(failure.elements['reset-email'].disabled,false);
  assert.equal(failure.elements['reset-msg'].textContent,'Temporarily unavailable.');
});

test('resending requests a reset code for the same email and stays in verification',async()=>{
  const f=fixture();await f.send();f.elements['reset-code'].value='old-code';
  await f.event('resend-reset-code','click');
  assert.equal(f.calls[1].path,'/api/auth/email/forgot-password');assert.equal(f.calls[1].body.email,'friend@example.com');
  assert.equal(f.elements['reset-code'].value,'');assert.equal(f.elements['reset-verify-form'].hidden,false);
});
