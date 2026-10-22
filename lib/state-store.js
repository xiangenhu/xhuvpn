'use strict';
// One generation-guarded document keeps access revocation and peer changes atomic.
function createStateStore(bucket) {
  const file=bucket.file('vpn-state.json');
  async function read() {
    try {
      const [meta]=await file.getMetadata();
      const [bytes]=await bucket.file(file.name,{generation:meta.generation}).download();
      return {value:JSON.parse(bytes.toString()),generation:meta.generation};
    }catch(error) {
      if(error.code!==404) throw error;
      let peers=[];
      try { const [bytes]=await bucket.file('peers.json').download(); peers=JSON.parse(bytes.toString()); }catch(e){if(e.code!==404)throw e;}
      const value={users:{},invites:{},peers};
      try {await file.save(JSON.stringify(value),{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{cacheControl:'no-store'}});}catch(e){if(e.code!==412)throw e;}
      return read();
    }
  }
  async function update(change) {
    for(let attempt=0;attempt<12;attempt++) {
      const {value,generation}=await read();
      const result=change(value);
      try {await file.save(JSON.stringify(value),{resumable:false,preconditionOpts:{ifGenerationMatch:generation},metadata:{cacheControl:'no-store'}});return result;}catch(e){if(e.code!==412)throw e;}
    }
    throw Error('Concurrent update conflict; retry');
  }
  return {read,update};
}
module.exports={createStateStore};
