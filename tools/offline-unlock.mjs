import * as fs from 'node:fs/promises';
import path from 'node:path';
// Use only after closing every host using the data root. This removes an abandoned lock,
// never a journal or quarantined file. A live owner always prevents unlocking.
const [root,ack]=process.argv.slice(2);
if(!root || ack!=='--all-hosts-stopped')throw new Error('Usage: node offline-unlock.mjs <DSH data root> --all-hosts-stopped');
const base=path.join(path.resolve(root),'.conversation-cleaner');
if((await fs.lstat(base)).isSymbolicLink())throw new Error('Refusing symlinked state directory');
const lock=path.join(base,'transaction.lock');
if((await fs.lstat(lock)).isSymbolicLink())throw new Error('Refusing symlinked lock');
const ownerPath=path.join(lock,'owner.json');
const owner=JSON.parse(await fs.readFile(ownerPath,'utf8'));
if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new Error('Invalid lock owner; inspect manually');
try{process.kill(owner.pid,0);throw new Error('Lock owner is still alive; refusing to unlock');}catch(e){if(e.code!=='ESRCH')throw e;}
await fs.unlink(ownerPath);await fs.rmdir(lock);
console.log('Removed abandoned transaction lock. Journals and quarantine were retained.');
