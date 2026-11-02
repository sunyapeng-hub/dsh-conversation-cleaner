import { cp, mkdir, rm } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('src','dist',{recursive:true});
await mkdir('release',{recursive:true});
console.log('Built host and client ESM files in dist/');
