import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const { analyze } = await import(pathToFileURL(resolve(process.argv[2], 'core/index.js')));
const input = [{ role: 'developer', content: 'Inspect the evidence and preserve the current task. '.repeat(250) }];
const lines = [];
for(let i=0;i<300;i++) {
  input.push({ role: 'user', content: `Work item ${i}: ` + 'A stable useful reference paragraph. '.repeat(8) });
  lines.push(JSON.stringify({ model: 'gpt-6-sol', input }));
  input.push({ role: 'assistant', content: `Observed item ${i}.` });
}
const jsonl = lines.join('\n');
analyze(jsonl);
const times = [];
let result;
for(let i=0;i<3;i++) {const start=performance.now();result=analyze(jsonl);times.push(performance.now()-start);}
const summary={kind:'synthetic growing Responses history; no provider calls',node:process.version,requests:lines.length,inputBytes:Buffer.byteLength(jsonl),milliseconds:times,medianMilliseconds:[...times].sort((a,b)=>a-b)[1],cacheHits:result.cacheSimulation.actual.filter(s=>s.readTokens>0).length,totalCost:result.cacheSimulation.totalActualCostUsd};
writeFileSync(process.argv[3],JSON.stringify(summary,null,2)+'\n');
console.log(summary);
