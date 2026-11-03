import fs from 'node:fs/promises';import assert from 'node:assert/strict';
await import('./final-evidence.mjs');
const pkg=JSON.parse(await fs.readFile('package.json','utf8')),focused={};
for(const tag of ['next','web']){const file='evidence/'+tag+'-zero-output-check.json',record=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(record.status,'PASS');assert.equal(record.version,pkg.version);focused[tag]={version:record.version,status:record.status,checks:record.checks,evidence:[file,'evidence/screenshots/'+tag+'-zero-output-preview.png']};}
const file='evidence/acceptance-report.json',report=JSON.parse(await fs.readFile(file,'utf8'));
report.baseline_acceptance_version='1.0.0-rc.7';report.focused_regression=focused;
for(const gate of report.gates)gate.evidence_plugin_version='1.0.0-rc.7';
for(const host of Object.values(report.hosts))host.baseline_acceptance_plugin_version='1.0.0-rc.7';
report.note='Six real-host full-mode gates are the rc.7 baseline. rc.8 has fresh actual NEXT and Web zero-output regressions plus the automatic suite; baseline evidence is not described as a new full rc.8 run.';
await fs.writeFile(file,JSON.stringify(report,null,2));
await fs.appendFile('evidence/compatibility.md','\nrc.8 scope: both profiles installed rc.8. Fresh focused actual NEXT/Web zero-output B deletion and restoration passed with an unrelated live unknown-proof session retained. Actual-output B and full remain blocked. The six full-mode restart/restore gates above are explicitly rc.7 baseline evidence.\n');
await fs.appendFile('evidence/review.md','\nrc.8 read-only review found no important issue in the narrow proof/lease change: the flag is server-owned, fresh metadata is compared, actual-output/full barriers stay strict, and old plans default to strict leasing. Both actual hosts passed the focused zero-output regression.\n');
