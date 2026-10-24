'use strict';
const fs=require('node:fs'),path=require('node:path');
const {zipSync,strToU8}=require('fflate');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'public/downloads');fs.mkdirSync(output,{recursive:true});
for(const browser of ['chromium','firefox']) {
  const files={};
  for(const name of ['core.js','background.js','popup.html','popup.js','popup.css'])files[name]=fs.readFileSync(path.join(root,'extension',name));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension',`manifest.${browser}.json`),'utf8'));
  files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(output,`research-network-${browser}.zip`),zipSync(files));
  console.log(`Built research-network-${browser}.zip`);
}
