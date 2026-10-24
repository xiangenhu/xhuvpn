'use strict';
const {randomUUID}=require('node:crypto');
const {AccessError}=require('./access');
async function profileStep(stage,operation,log=console.error) {
  try {return await operation();}
  catch(error) {
    if(error instanceof AccessError)throw error;
    const reference=randomUUID();
    // Do not log exception messages, SSH output, keys or configuration contents.
    log('Profile setup failed',{stage,reference});
    throw new AccessError(503,`Profile creation stopped while ${stage}. No downloadable file was returned. Administrator: check the Cloud Run logs for reference ${reference}.`);
  }
}
module.exports={profileStep};
