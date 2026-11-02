import {chromium} from 'playwright';
const b=await chromium.connectOverCDP('http://127.0.0.1:39119');
try {
 const page=b.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='dsh-app://app/');
 if(!page)throw new Error('Isolated NEXT page is not available');
 const route=process.argv[2]??'/cleaner-e2e',body=JSON.parse(process.argv[3]??'{"action":"info"}');
 const response=await page.evaluate(async({route,body})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();try{return {status:r.status,data:JSON.parse(text)};}catch{return {status:r.status,text:text.slice(0,200)};}},{route,body});
 console.log(JSON.stringify(response));
}finally{await b.close();}
