import {chromium} from 'playwright';
const b=await chromium.connectOverCDP('http://127.0.0.1:39119');
const c=await b.newBrowserCDPSession();
const gone=new Promise(resolve=>b.once('disconnected',resolve));
const timer=setTimeout(()=>{console.error('Timed out waiting for isolated NEXT to close.');process.exitCode=1;},15000);
c.send('Browser.close').catch(()=>{});
await gone;clearTimeout(timer);
console.log('Requested graceful close of isolated NEXT.');
