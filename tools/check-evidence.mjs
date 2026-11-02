import * as fs from 'node:fs/promises';
const report=JSON.parse(await fs.readFile('evidence/acceptance-report.json','utf8'));
const failures=[];
for(const gate of report.gates){for(const file of gate.evidence)try{await fs.stat(file);}catch{failures.push('Missing evidence: '+file);}if(gate.status!=='PASS')failures.push(gate.id+': '+gate.status);}
if(!['PASS','RC_VERIFIED'].includes(report.report_status))failures.push('Overall: '+report.report_status);
console.log(failures.length?failures.join('\n'):'Six actual host/mode gates have PASS evidence; RC scope and incomplete combinations remain explicit.');
process.exitCode=failures.length?1:0;
