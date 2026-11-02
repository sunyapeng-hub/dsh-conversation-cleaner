import struct,json,pathlib
p=pathlib.Path(r'D:/Software/AI Development Tools/DSH NEXT/resources/app.asar')
f=p.open('rb'); a,b,c,d=struct.unpack('<4I',f.read(16)); h=json.loads(f.read(d)); base=8+b
files=[]
def walk(t,p=''):
 for n,v in t['files'].items():
  q=p+'/'+n
  if 'files' in v: walk(v,q)
  else: files.append((q,v))
walk(h)
out=pathlib.Path(r'F:/Projects/PLUS Project/research/installed-next');out.mkdir(parents=True,exist_ok=True)
(out/'asar-files.txt').write_text('\n'.join(p for p,v in files),encoding='utf8')
for q,v in files:
 if (q=='/package.json' or q.startswith('/lib/') or q.startswith('/node_modules/')) and not v.get('unpacked') and 'offset' in v:
  target=out/q.lstrip('/');target.parent.mkdir(parents=True,exist_ok=True);f.seek(base+int(v['offset']));target.write_bytes(f.read(v['size']))
print('indexed',len(files),'files')
print('\n'.join(q for q,v in files if 'session-persistence' in q or 'workspace-registry' in q or 'dsh/bin' in q)[:3000])
