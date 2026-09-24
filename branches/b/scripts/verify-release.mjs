// One reviewable canonical run. Logs stay outside the release by default so
// generating a manifest never hashes a log that is still being written.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2] ?? resolve(root,'../b-branch-verification'));
mkdirSync(output,{recursive:true});
const commands=['install','run typecheck','run build','run test:legacy','run test:repair','test','run verify:critical','run verify:integration','run verify:remaining','run lint:policy','run manifest','run verify:manifest'];
const results=[];
for(const command of commands){
  const start=new Date().toISOString();
  const r=spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',command.split(' '),{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:32*1024*1024});
  const name=command.replaceAll(' ','-').replaceAll(':','-');
  writeFileSync(resolve(output,`${name}.log`),(r.stdout??'')+(r.stderr??'')+(r.error?`\nRUNNER_ERROR: ${r.error.message}\n`:''));
  results.push({command:`npm ${command}`,started_at:start,exit:r.status,signal:r.signal,error:r.error?.message??null,log:`${name}.log`,status:r.status===0?'PASS':'FAIL'});
  console.log(`${results.at(-1).command}: ${results.at(-1).status}`);
}
writeFileSync(resolve(output,'results.json'),JSON.stringify({node:process.version,package:JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version,results},null,2)+'\n');
process.exitCode=results.some(r=>r.status!=='PASS')?1:0;
