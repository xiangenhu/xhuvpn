'use strict';
async function withDeadline(operation, milliseconds, cleanup=()=>{}) {
  let timer;
  const timeout=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{
      try {cleanup();} catch {}
      reject(Object.assign(new Error('Operation timed out'),{code:'VPN_TIMEOUT'}));
    },milliseconds);
  });
  try {return await Promise.race([operation,timeout]);}
  finally {clearTimeout(timer);}
}
module.exports={withDeadline};
