(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e,t){let n=e.filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.reduce((e,t)=>e+t.value,0);if(r<=0||n.length===0)return[];let i=t.w*t.h,a=n.map(e=>({...e,value:e.value/r*i})),o=[],s={...t},c=[],l=a;function u(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=0;for(let i of e){let e=i.value/(n/t),a=Math.max(e/t,t/e);a>r&&(r=a)}return r}function d(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=t.w>=t.h,i=r?t.h:t.w,a=i>0?n/i:0,s=0;for(let c of e){let e=n>0?c.value/n*i:0;r?o.push({rect:{x:t.x,y:t.y+s,w:a,h:e},item:c.item}):o.push({rect:{x:t.x+s,y:t.y,w:e,h:a},item:c.item}),s+=e}return r?{x:t.x+a,y:t.y,w:t.w-a,h:t.h}:{x:t.x,y:t.y+a,w:t.w,h:t.h-a}}for(;l.length>0;){let e=l[0],t=[...c,e];c.length===0||u(t,Math.min(s.w,s.h))<=u(c,Math.min(s.w,s.h))?(c=t,l=l.slice(1)):(s=d(c,s),c=[])}return c.length>0&&d(c,s),o}function t(e){let t=(e[0]===255&&e[1]===254?`utf-16le`:e[0]===254&&e[1]===255?`utf-16be`:null)??`utf-8`;try{return new TextDecoder(t,{fatal:!0}).decode(e)}catch{throw Error(`Invalid ${t.toUpperCase()} encoding. Export or save the original log as valid UTF-8 (or UTF-16 with a byte-order mark) and import it again.`)}}var n=50*2**20;function r(e){let t=e.maxBytes??n;if(!Number.isSafeInteger(t)||t<1||t>n)throw Error(`Invalid input byte limit.`);return t}function i(e){return Error(`Input exceeds ${(e/2**20).toLocaleString(`en-US`)} MB before or after decompression. Split the log into smaller sessions.`)}async function a(e,t={}){let n=r(t),{signal:a}=t,o=e.getReader(),s=()=>{o.cancel(a?.reason).catch(()=>{})};a?.addEventListener(`abort`,s,{once:!0});let c=[],l=0;try{for(a?.throwIfAborted();;){let{done:e,value:t}=await o.read();if(a?.throwIfAborted(),e)break;if(l+=t.byteLength,l>n)throw i(n);c.push(t)}let e=new Uint8Array(l),t=0;for(let n of c)e.set(n,t),t+=n.byteLength;return e}finally{a?.removeEventListener(`abort`,s),await o.cancel().catch(()=>{}),o.releaseLock()}}function o(e){return e[0]===31&&e[1]===139}async function s(e,n={}){n.signal?.throwIfAborted();let s=r(n);if(e.byteLength>s)throw i(s);return o(e)?t(await a(new Blob([e]).stream().pipeThrough(new DecompressionStream(`gzip`)),n)):t(e)}async function c(e,t={}){let n=r(t);if(e.size>n)throw i(n);return s(await a(e.stream(),t),t)}function l(e){if(e.length>n||new TextEncoder().encode(e).byteLength>n)throw i(n)}async function u(e,t){let n=`/contextscope/examples/${e}`,r=await fetch(n,{signal:t});if(!r.ok)throw Error(`Could not fetch example "${e}" (${r.status})`);if(!r.body)throw Error(`The example response has no body.`);return s(await a(r.body,{signal:t}),{signal:t})}var d=[{id:`mixed-models`,label:`Model routing: same prompt, different cache minimums`,description:`Synthetic Sonnet 4.5 / Opus 4.5 log. The same short prefix caches on Sonnet and stays uncached on Opus. Each request uses its own model's rules and prices; no live measurements.`,approxSizeMb:.06,load:e=>u(`anthropic-mixed-models.jsonl.gz`,e)},{id:`reported-cache-usage`,label:`Reported usage: predicted hits, recorded zeroes`,description:`Synthetic six-request review of Contextscope's JSON reader. Authored response counters include zero reads, a hit, missing counts and an invalid count. No live API measurements.`,approxSizeMb:.1,load:e=>u(`reported-cache-usage.jsonl`,e)},{id:`cache-bust`,label:`Cache bust: timestamp in system prompt`,description:`Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.`,approxSizeMb:.48,load:e=>u(`anthropic-agent-cache-bust.jsonl.gz`,e)},{id:`cache-fixed`,label:`Cache fixed: same session, timestamp removed`,description:`The same synthetic session with the timestamp removed from the cached prefix - the simulation predicts cache hits from turn 2 onward.`,approxSizeMb:.48,load:e=>u(`anthropic-agent-cache-fixed.jsonl.gz`,e)},{id:`duplicate-tool-results`,label:`Duplicate content: same file read 3 times`,description:`Synthetic session where an agent re-reads an unchanged file three times in one conversation.`,approxSizeMb:.13,load:e=>u(`anthropic-duplicate-tool-results.jsonl`,e)},{id:`openai-tools-reordered`,label:`OpenAI: tools reordered mid-session`,description:`Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.`,approxSizeMb:.13,load:e=>u(`openai-agent-tools-reordered.jsonl`,e)}],f={system:`system`,tools:`tool definitions`,user:`user text`,assistant:`assistant text`,tool_call:`tool calls`,tool_result:`tool results`,image:`images`,thinking:`thinking`},ee=[`system`,`tools`,`user`,`assistant`,`tool_call`,`tool_result`,`image`,`thinking`];function p(e){return`var(--cat-${e})`}function m(e){return e.toLocaleString(`en-US`)}function h(e){return e===void 0?`n/a`:`$${e.toFixed(e<1?4:2)}`}function te(e){return`$${e.toLocaleString(`en-US`,{maximumFractionDigits:0})}`}function g(e,t=1){return e===void 0?`n/a`:`${(e*100).toFixed(t)}%`}function _(e,t){let n=e.replace(/\s+/g,` `).trim();return n.length>t?`${n.slice(0,t)}…`:n}function v(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function y(e,t=document){let n=t.querySelector(e);if(!n)throw Error(`contextscope: missing required element "${e}"`);return n}function b(e,t=document){return Array.from(t.querySelectorAll(e))}var ne=`/contextscope/assets/analysis-worker-BuoLaMsa.js`;function re(e){if(!e||typeof e.parse?.complete!=`boolean`||!Array.isArray(e.parse.requests))return!1;let t=e.parse.requests.length;return t>0&&Array.isArray(e.reports)&&e.reports.length===t&&typeof e.model?.id==`string`&&typeof e.model.displayName==`string`&&Array.isArray(e.prefixMatches)&&Array.isArray(e.findings)&&Array.isArray(e.duplicates)&&Array.isArray(e.conversations?.byRequest)&&e.conversations.byRequest.length===t&&Array.isArray(e.cacheSimulation?.actual)&&e.cacheSimulation.actual.length===t&&Array.isArray(e.cacheSimulation.optimized)&&e.cacheSimulation.optimized.length===t&&e.reports.every(e=>Array.isArray(e?.segments)&&Array.isArray(e.byCategory)&&typeof e.model?.id==`string`&&typeof e.model.displayName==`string`&&Number.isSafeInteger(e.totals?.openaiTokens)&&Number.isSafeInteger(e.totals.claudeTokensEstimate))}function ie(){let e=new URL(ne,location.href);if(e.origin!==location.origin)throw Error(`The analysis worker must be served from this site's origin.`);let t=URL.createObjectURL(new Blob([`import ${JSON.stringify(e.href)};`],{type:`text/javascript`}));try{let e=new Worker(t,{type:`module`}),n=e.terminate.bind(e);return e.terminate=()=>{n(),URL.revokeObjectURL(t)},e}catch(e){throw URL.revokeObjectURL(t),e}}function ae(e,t,n=ie){return new Promise((r,i)=>{let a,o=!1,s=(e,n)=>{o||(o=!0,t.removeEventListener(`abort`,c),a&&(a.onmessage=null,a.onerror=null,a.onmessageerror=null,a.terminate()),e?r(e):i(n))},c=()=>s(void 0,t.reason??new DOMException(`Analysis cancelled.`,`AbortError`));if(t.aborted){c();return}t.addEventListener(`abort`,c,{once:!0});try{if(a=n(),t.aborted||o){a.terminate();return}a.onmessage=e=>{let t=e.data;t?.type!==`started`&&(t?.type===`error`&&typeof t.message==`string`?s(void 0,Error(t.message)):t?.type===`success`&&re(t.result)?s(t):s(void 0,Error(`Analysis worker returned an unreadable result. Try importing the log again.`)))},a.onerror=e=>{e.preventDefault(),s(void 0,Error(`Analysis worker failed: ${e.message||`could not load or process this log`}. Try importing the log again.`))},a.onmessageerror=()=>s(void 0,Error(`Could not receive the analysis result. Try a smaller session.`)),a.postMessage(e)}catch(e){s(void 0,Error(`Could not start local analysis: ${e instanceof Error?e.message:String(e)}. Try importing the log again.`))}})}var x=2e4;function oe(e,t){let n=e.map(e=>({id:e.id,category:e.category,label:e.label,segment:e,count:1,value:t===`openai`?e.openaiTokens:e.claudeTokensEstimate})).filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.slice(0,128),i=new Map;for(let e of n.slice(128)){let t=i.get(e.category);t||(t={id:`other:${e.category}`,category:e.category,label:`other ${e.category} segments`,value:0,count:0},i.set(e.category,t)),t.value+=e.value,t.count++}return[...r,...i.values()]}var se={both_zero:`Both zero`,both_positive:`Reuse on both sides`,simulated_hit_reported_zero:`Simulated hit / reported zero`,reported_hit_simulated_zero:`Reported hit / simulated zero`,unavailable:`Read count unavailable`};function S(e){let t=e.source;return t?.line===void 0?`record ${(t?.recordIndex??e.index)+1}`:`line ${t.line}`}function C(e){return e===null?`n/a`:e.toLocaleString(`en-US`)}function w(e){return e===null?`n/a`:`${e>0?`+`:``}${e.toLocaleString(`en-US`)}`}var T=25;function E(e,t,n,r,i){let a=t.usageComparison,o=a.rows.filter(e=>r.filter===`all`||e.readOutcome===r.filter),s=Math.max(1,Math.ceil(o.length/T));r.page=Math.max(0,Math.min(r.page,s-1));let c=r.page*T,l=o.slice(c,c+T),u=[[`all`,`All requests`,a.rows.length],[`simulated_hit_reported_zero`,`Simulated hit / reported zero`,a.readOutcomes.simulated_hit_reported_zero],[`reported_hit_simulated_zero`,`Reported hit / simulated zero`,a.readOutcomes.reported_hit_simulated_zero],[`unavailable`,`Read unavailable`,a.readOutcomes.unavailable]];e.innerHTML=`
    <h2 id="usage-heading">Reported usage <span class="count">compared with the simulation</span></h2>
    <p class="usage-intro">What the response recorded, beside what this file predicts. Each total uses the same covered requests on both sides.</p>
    <div class="table-scroll usage-totals" tabindex="0" role="group" aria-label="Reported usage totals">
      <table class="usage-table"><thead><tr><th scope="col">Metric</th><th scope="col">Coverage</th><th scope="col">Reported</th><th scope="col">Estimated / simulated</th><th scope="col">Delta</th></tr></thead><tbody>
        ${[[`Input tokens`,a.input],[`Cache reads`,a.cacheRead]].map(([e,t])=>`<tr><th scope="row">${e}<span class="usage-mobile">${t.requestIndices.length}/${a.rows.length} requests</span></th><td>${t.requestIndices.length}/${a.rows.length}</td><td class="usage-reported">${C(t.reportedTokens)}</td><td>${C(t.simulatedTokens)}</td><td>${w(t.deltaTokens)}</td></tr>`).join(``)}
      </tbody></table>
    </div>
    <p class="muted usage-note">Delta = estimate/simulation minus reported. n/a means unavailable. ${a.invalidRequestIndices.length} invalid usage record(s) excluded. Costs below remain simulated.</p>
    ${a.uncomparedRequestIndices.length?`<p class="usage-issue">${a.uncomparedRequestIndices.length} request(s) have paired usage but no analyzable prompt; excluded from comparisons. Select their request tabs to inspect the original counters.</p>`:``}
    ${a.issues.map(e=>`<p class="usage-issue">${v(e)}</p>`).join(``)}
    <div class="usage-filters" role="group" aria-label="Filter usage comparisons">
      ${u.map(([e,t,n])=>`<button class="btn" type="button" data-usage-filter="${e}" aria-pressed="${r.filter===e}">${t} <span>${n}</span></button>`).join(``)}
    </div>
    <p id="usage-range" class="muted" role="status">${o.length?`${c+1}-${c+l.length} of ${o.length} matching requests`:`No requests match this filter`}. Totals and exports include the whole capture.</p>
    <p class="usage-mobile muted">The table shows cache reads. Select a request for input counts and original counters.</p>
    <div class="table-scroll usage-rows" tabindex="0" role="group" aria-label="Per-request usage comparison">
      <table class="usage-table"><thead><tr><th scope="col">Request / source</th><th scope="col">Reported input</th><th scope="col">Estimated input</th><th scope="col">Reported read</th><th scope="col">Simulated read</th><th scope="col">Read comparison</th></tr></thead><tbody>
        ${l.map(e=>`<tr class="${e.requestIndex===n?`usage-selected`:``}"><th scope="row"><button type="button" class="usage-inspect" data-usage-request="${e.requestIndex}" aria-label="Inspect usage for request ${e.requestIndex+1}" aria-pressed="${e.requestIndex===n}">req ${e.requestIndex+1}</button><span class="usage-source">${S(t.parse.requests[e.requestIndex])}</span></th><td class="usage-reported">${C(e.reportedInputTokens)}</td><td>${C(e.estimatedInputTokens)}</td><td class="usage-reported">${C(e.reportedReadTokens)}</td><td>${C(e.simulatedReadTokens)}</td><td class="usage-outcome ${le(e.readOutcome)?`usage-disagrees`:``}">${se[e.readOutcome]}</td></tr>`).join(``)}
      </tbody></table>
    </div>
    ${s>1?`<div class="usage-pagination"><button class="btn" id="usage-previous" type="button" ${r.page===0?`disabled`:``}>Previous requests</button><span>Page ${r.page+1} of ${s}</span><button class="btn" id="usage-next" type="button" ${r.page===s-1?`disabled`:``}>Next requests</button></div>`:``}
    <p class="muted usage-note">A discrepancy does not identify its cause: routing, eviction, timing and hidden context are not captured. Reuse on both sides does not mean the token counts agree.</p>
    ${ce(t.parse.requests[n],a.rows.find(e=>e.requestIndex===n))}
  `;let d=a=>{E(e,t,n,r,i),e.querySelector(a)?.focus({preventScroll:!0})};for(let t of b(`[data-usage-filter]`,e))t.addEventListener(`click`,()=>{r.filter=t.dataset.usageFilter,r.page=0,d(`[data-usage-filter="${r.filter}"]`)});for(let t of b(`[data-usage-request]`,e))t.addEventListener(`click`,()=>{let e=Number(t.dataset.usageRequest);i(e),document.querySelector(`[data-usage-request="${e}"]`)?.focus({preventScroll:!0})});e.querySelector(`#usage-previous`)?.addEventListener(`click`,()=>{r.page--,d(r.page===0?`#usage-next`:`#usage-previous`)}),e.querySelector(`#usage-next`)?.addEventListener(`click`,()=>{r.page++,d(r.page===s-1?`#usage-previous`:`#usage-next`)})}function ce(e,t){let n=e.reportedUsage;return`<section class="usage-evidence" aria-labelledby="usage-evidence-heading"><h3 id="usage-evidence-heading">Request ${e.index+1} <span class="muted">${S(e)} / original counters</span></h3>
    ${e.segments.length?``:`<p class="usage-issue">No analyzable prompt; excluded from comparisons.</p>`}
    ${n?`<p class="muted">${n.schema} · ${n.status} · ${v(n.sources.join(`, `))}</p>
    ${n.issues.map(e=>`<p class="usage-issue">${v(e)}</p>`).join(``)}
    ${n.notes.map(e=>`<p class="muted">${v(e)}</p>`).join(``)}
    <div class="usage-summary"><p>Input <strong>${C(n.inputTokens)}</strong> reported / <strong>${C(t?.estimatedInputTokens??null)}</strong> estimated</p><p>Cache read <strong>${C(n.cacheReadTokens)}</strong> reported / <strong>${C(t?.simulatedReadTokens??null)}</strong> simulated (delta ${w(t?.readDeltaTokens??null)})</p><p>Cache write <strong>${C(n.cacheWriteTokens)}</strong> · output <strong>${C(n.outputTokens)}</strong></p></div>
    <div class="table-scroll" tabindex="0" role="group" aria-label="Original usage counters"><table class="usage-table usage-counters"><thead><tr><th scope="col">Original counter path</th><th scope="col">Value / state</th></tr></thead><tbody>${n.counters.map(e=>`<tr><th scope="row"><code>${v(e.path)}</code></th><td>${e.status===`reported`?C(e.value):e.status}</td></tr>`).join(``)}</tbody></table></div>`:`<p class="muted">No paired response usage for this request. Keep the response beside its request to compare recorded counts.</p>`}
  </section>`}function le(e){return e===`simulated_hit_reported_zero`||e===`reported_hit_simulated_zero`}var ue={error:0,warning:1,info:2},de={tools_reordered:`Tools reordered between requests`,model_switch:`Model changed mid-conversation`};function fe(e){let t=new Map;for(let n of e){let e=`${n.kind}|${[...new Set(n.segmentIds)].sort().join(`,`)}`,r=t.get(e);r?(r.findings.push(n),r.requestIndices.includes(n.requestIndex)||r.requestIndices.push(n.requestIndex)):t.set(e,{kind:n.kind,severity:n.severity,title:n.title,detail:n.detail,requestIndices:[n.requestIndex],findings:[n]})}let n=[...t.values()];for(let e of n){e.requestIndices.sort((e,t)=>e-t);let t=de[e.kind];t&&e.requestIndices.length>1&&(e.title=t)}return n.sort((e,t)=>ue[e.severity]-ue[t.severity]||e.requestIndices[0]-t.requestIndices[0])}function D(e){let t=[...new Set(e)].sort((e,t)=>e-t);if(t.length===0)return``;if(t.length===1)return`request ${t[0]+1}`;let n=[],r=t[0],i=r;for(let e of[...t.slice(1),NaN]){if(e===i+1){i=e;continue}n.push(r===i?`${r+1}`:i===r+1?`${r+1}, ${i+1}`:`${r+1}–${i+1}`),r=e,i=e}return`requests ${n.join(`, `)}`}function O(e){let t=new Map;for(let n of e.reports){let e=n.model,r=JSON.stringify([e.id,e.source,e.unrecognized]),i=t.get(r);i?i.requestIndices.push(n.requestIndex):t.set(r,{model:e,requestIndices:[n.requestIndex]})}return[...t.values()]}function k(e){return`${e.displayName}${e.unrecognized?` (fallback for ${e.unrecognized})`:e.source==="default"?` (assumed)`:``}`}function pe(e){let t=O(e);return t.length===1?k(t[0].model):`models resolved per request`}function me(e){let t=[];for(let{model:n,requestIndices:r}of O(e)){let e=D(r);n.unrecognized?t.push(`${e}: "${n.unrecognized}" is not in the pricing table. Prices, cache thresholds and context window assume ${n.displayName}. Use a model override to change this assumption.`):n.source==="default"&&t.push(`${e}: no model named; prices, cache thresholds and context window assume ${n.displayName}. Unnamed requests share a separate cache, isolated from named models.`)}return e.reports.some(e=>e.model.source===`option`)&&t.push(`Model override applies prices, cache thresholds and context windows to every request. Cache identity still follows the model names captured in the log.`),t}function he(e){return{id:e.id,category:e.category,label:e.label,path:e.path,openaiTokens:e.openaiTokens,claudeTokensEstimate:e.claudeTokensEstimate,...e.cacheControl?{cacheControl:e.cacheControl}:{},charLength:e.charLength}}function ge(e){let t={...e,parse:{...e.parse,requests:e.parse.requests.map(e=>({provider:e.provider,index:e.index,model:e.model,source:e.source,reportedUsage:e.reportedUsage,segments:e.segments.map(he)}))},reports:e.reports.map(e=>({...e,segments:e.segments.map(he)})),prefixMatches:e.prefixMatches.map(e=>({...e,diff:void 0}))};return JSON.stringify(t,null,2)}var A=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`);function _e(e){let t=e.usageComparison;if(!t.capturedRequests)return`<p class="muted">No paired response usage. Cache reads and costs are simulations.</p>`;let n=[[`Input tokens`,t.input],[`Cache reads`,t.cacheRead]].map(([e,n])=>`<tr><th scope="row">${e}</th><td>${n.requestIndices.length}/${t.rows.length}</td><td>${C(n.reportedTokens)}</td><td>${C(n.simulatedTokens)}</td><td>${w(n.deltaTokens)}</td></tr>`).join(``),r=t.rows.map(t=>`<tr><th scope="row"><a href="#usage-${t.requestIndex}">req ${t.requestIndex+1}</a><br>${S(e.parse.requests[t.requestIndex])}</th><td>${C(t.reportedInputTokens)}</td><td>${C(t.estimatedInputTokens)}</td><td>${C(t.reportedReadTokens)}</td><td>${C(t.simulatedReadTokens)}</td><td>${se[t.readOutcome]}</td></tr>`).join(``),i=e.parse.requests.filter(e=>e.segments.length||e.reportedUsage).map(e=>{let t=e.index,n=e.reportedUsage;return`<details id="usage-${t}" class="usage-evidence"><summary>Request ${t+1} · ${S(e)} · ${n?.status??`not recorded`}</summary>
      ${e.segments.length?``:`<p>No analyzable prompt; excluded from comparisons. Paired usage is retained below.</p>`}
      ${n?`<p>${n.schema}; source: ${A(n.sources.join(`, `))}. Reported input: ${C(n.inputTokens)}; cache reads: ${C(n.cacheReadTokens)}; cache writes: ${C(n.cacheWriteTokens)}; output: ${C(n.outputTokens)}.</p>
      ${n.issues.length?`<ul>${n.issues.map(e=>`<li>${A(e)}</li>`).join(``)}</ul>`:``}
      ${n.notes.map(e=>`<p>${A(e)}</p>`).join(``)}
      <div class="table-scroll" tabindex="0" role="group" aria-label="Source counters for request ${t+1}"><table><thead><tr><th scope="col">Original counter path</th><th scope="col">Value / state</th></tr></thead><tbody>${n.counters.map(e=>`<tr><th scope="row"><code>${e.path}</code></th><td>${e.status===`reported`?C(e.value):e.status}</td></tr>`).join(``)}</tbody></table></div>`:`<p>No paired response usage for this request.</p>`}
    </details>`}).join(``);return`<section class="card"><h2>Reported usage vs simulation</h2>
    <p>Each total compares the same covered requests. Delta = estimate/simulation minus reported. Missing or invalid counts are n/a, never zero.</p>
    <div class="table-scroll" tabindex="0" role="group" aria-label="Usage totals"><table><thead><tr><th scope="col">Metric</th><th scope="col">Coverage</th><th scope="col">Reported</th><th scope="col">Estimated / simulated</th><th scope="col">Delta</th></tr></thead><tbody>${n}</tbody></table></div>
    <p>${t.readOutcomes.simulated_hit_reported_zero} simulated hit / reported zero; ${t.readOutcomes.reported_hit_simulated_zero} reported hit / simulated zero. ${t.readOutcomes.unavailable} read count unavailable. ${t.invalidRequestIndices.length} invalid usage record(s) excluded.</p>
    ${t.uncomparedRequestIndices.length?`<p>${t.uncomparedRequestIndices.length} request(s) have paired usage but no analyzable prompt; excluded from comparisons. Their original counters are retained below.</p>`:``}
    <p class="muted">Counts do not establish a cause: cache routing, eviction, timing and hidden context are not captured. Reuse on both sides does not mean the token counts agree. Reported writes are retained below; costs remain simulated.</p>
    ${t.issues.map(e=>`<p>${A(e)}</p>`).join(``)}
    <div class="table-scroll" tabindex="0" role="group" aria-label="Per-request usage comparison"><table><thead><tr><th scope="col">Request / source</th><th scope="col">Reported input</th><th scope="col">Estimated input</th><th scope="col">Reported read</th><th scope="col">Simulated read</th><th scope="col">Read comparison</th></tr></thead><tbody>${r}</tbody></table></div>
    <h3>Original counters</h3>${i}
  </section>`}function j(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}var ve={system:`#2a78d6`,tools:`#eb6834`,user:`#1baf7a`,assistant:`#eda100`,tool_call:`#e87ba4`,tool_result:`#008300`,image:`#4a3aa7`,thinking:`#e34948`},ye=`default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;function be(e){let{parse:t,reports:n,cacheSimulation:r,findings:i,duplicates:a}=e,o=O(e).length>1,s=n.map(e=>{let t=e.byCategory.map(e=>`<tr><td><span class="swatch" style="background:${ve[e.category]}"></span>${j(e.category)}</td><td>${e.segmentCount}</td><td>${e.claudeTokensEstimate.toLocaleString(`en-US`)}</td><td>${e.openaiTokens.toLocaleString(`en-US`)}</td></tr>`).join(``);return`<section class="card"><h3>Request ${e.requestIndex+1} · ${j(k(e.model))}</h3>
        <p class="muted">≈${e.totals.claudeTokensEstimate.toLocaleString(`en-US`)} Claude tokens · ${e.totals.openaiTokens.toLocaleString(`en-US`)} OpenAI tokens${e.percentOfContextWindow===void 0?``:` · ${(e.percentOfContextWindow*100).toFixed(1)}% of context window`}</p>
        <div class="table-scroll" tabindex="0" role="group" aria-label="Token categories for request ${e.requestIndex+1}"><table><thead><tr><th>category</th><th>segments</th><th>≈Claude tok</th><th>OpenAI tok</th></tr></thead><tbody>${t}</tbody></table></div>
      </section>`}).join(`
`),c=r.actual.map((e,t)=>`<tr><td>req ${t+1}</td>${o?`<td>${j(k(n[t].model))}</td>`:``}<td>${e.readTokens.toLocaleString(`en-US`)}</td><td>${e.writeTokens5m.toLocaleString(`en-US`)}</td><td>${e.writeTokens1h.toLocaleString(`en-US`)}</td><td>${e.uncachedTokens.toLocaleString(`en-US`)}</td><td>${e.costUsd===void 0?`n/a`:`$${e.costUsd.toFixed(4)}`}</td></tr>`).join(``),l=fe(i),u=l.map(e=>`<li class="finding ${j(e.severity)}"><span class="pill">${j(e.severity)}</span> <strong>${j(e.title)}</strong> <span class="muted">(${D(e.requestIndices)}${e.requestIndices.length>1?`, ${e.requestIndices.length}×`:``})</span><p>${j(e.detail)}</p></li>`).join(``),d=a.map(e=>`<li>${e.members.length}× "${j(e.members[0].label)}" — ≈${e.estimatedWastedTokens.toLocaleString(`en-US`)} wasted tokens (similarity ${(e.similarity*100).toFixed(0)}%)</li>`).join(``),f=r.totalActualCostUsd!==void 0&&r.totalOptimizedCostUsd!==void 0?r.totalActualCostUsd-r.totalOptimizedCostUsd:void 0;return`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ye}"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>contextscope report — ${j(t.format)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-monospace, "IBM Plex Mono", "SFMono-Regular", Menlo, monospace; background: #0d0f13; color: #dfe3ea; max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  @media (prefers-color-scheme: light) { body { background: #f5f4f0; color: #1b1f27; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 0; }
  h3 { font-size: 15px; margin: 0 0 8px; }
  .muted { color: #929aaa; font-size: 13px; }
  a { color: #7fb6fa; }
  @media (prefers-color-scheme: light) { .muted { color: #5c6270; } a { color: #1b5dad; } }
  .card { border: 1px solid rgba(127,127,127,.3); border-radius: 6px; padding: 16px; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(127,127,127,.2); }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  ul.findings { list-style: none; padding: 0; }
  li.finding { border-left: 3px solid #7c8494; padding: 8px 12px; margin: 8px 0; }
  li.finding.error { border-color: #e34948; }
  li.finding.warning { border-color: #eda100; }
  li.finding.info { border-color: #2a78d6; }
  .pill { text-transform: uppercase; font-size: 10px; letter-spacing: .05em; opacity: .7; }
  .savings { color: #1baf7a; font-weight: bold; }
  @media (prefers-color-scheme: light) { .savings { color: #08764f; } }
  .table-scroll { overflow-x: auto; margin: 12px 0; }
  .table-scroll:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .usage-evidence { border-top: 1px solid rgba(127,127,127,.3); padding: 12px 0; scroll-margin-top: 12px; }
  .usage-evidence code { overflow-wrap: anywhere; }
  .usage-evidence summary { cursor: pointer; }
  .card > h2 { margin-top: 0; }
</style></head>
<body><main>
  <h1>contextscope report</h1>
  <p class="muted">${j(t.format)} · ${t.requests.length} request(s)${t.autoDetected?` · format auto-detected`:``} · priced as ${j(pe(e))}${e.claudeTokenScale===1?``:` · Claude estimates calibrated ×${e.claudeTokenScale.toFixed(3)}`} · generated ${new Date().toISOString()}</p>
  ${!t.complete||t.warnings.length>0?`<section class="card"><h2>${t.complete?`Parse notes`:`Incomplete input`}</h2>${t.complete?``:`<p>${t.skippedRecords} of ${t.sourceRecords} source records skipped or not analyzable. Counts and simulations cover retained content only; review all warnings.</p>`}<ul>${t.warnings.map(e=>`<li>${j(e.message)}</li>`).join(``)}</ul></section>`:``}

  ${me(e).map(e=>`<p class="muted">${j(e)}</p>`).join(`
`)}
  ${_e(e)}

  <section class="card">
    <h2>Findings (${l.length} issue${l.length===1?``:`s`}${i.length>l.length?` from ${i.length} findings`:``})</h2>
    <ul class="findings">${u||`<li class="muted">No supported cache or duplicate-content issues detected in the retained requests. This does not verify live cache hits.</li>`}</ul>
  </section>

  <section class="card">
    <h2>Cache simulation (${j(r.provider)})</h2>
    <div class="table-scroll" tabindex="0" role="group" aria-label="Cache simulation"><table><thead><tr><th>request</th>${o?`<th>model</th>`:``}<th>read</th><th>write (5m)</th><th>write (1h)</th><th>uncached</th><th>cost</th></tr></thead><tbody>${c}</tbody></table></div>
    <p class="muted">total simulated: ${r.totalActualCostUsd===void 0?`n/a`:`$${r.totalActualCostUsd.toFixed(4)}`} · optimized simulated: ${r.totalOptimizedCostUsd===void 0?`n/a`:`$${r.totalOptimizedCostUsd.toFixed(4)}`}</p>
    ${f!==void 0&&f>=5e-5?`<p class="savings">Applying the fixes above${r.provider===`anthropic`?`, with a breakpoint on each request's last cacheable block (moving the last marker if all four slots are used),`:``} would save $${f.toFixed(4)} on this sequence — ≈$${Math.round(f*1e3).toLocaleString(`en-US`)} per 1,000 sessions shaped like this one.</p>`:``}
  </section>

  ${a.length>0?`<section class="card"><h2>Duplicate content</h2><ul>${d}</ul></section>`:``}


  <h2>Requests</h2>
  ${s}

  <p class="muted">Generated by <a href="https://github.com/antonsoo/contextscope">contextscope</a>. Claude token counts are heuristic estimates (≈), not exact.</p>
</main></body></html>`}function xe(e,t){e.innerHTML=`
    <h2 id="report-exports-heading">Save report</h2>
    <div class="report-downloads"><button class="btn" id="report-json" type="button">Download full JSON report</button><button class="btn" id="report-html" type="button">Download offline HTML report</button><span class="muted">All requests, findings and available counter paths; prompt and response text omitted.</span></div>
    <p class="usage-issue" id="report-export-error" role="alert" hidden></p>
  `;for(let n of[`json`,`html`])y(`#report-`+n,e).addEventListener(`click`,()=>{let r=y(`#report-export-error`,e);r.hidden=!0;try{let e=n===`json`?ge(t):be(t),r=URL.createObjectURL(new Blob([e],{type:n===`json`?`application/json`:`text/html`})),i=document.createElement(`a`);i.href=r,i.download=`contextscope-report.${n}`,document.body.append(i),i.click(),i.remove(),setTimeout(()=>URL.revokeObjectURL(r),1e3)}catch{r.textContent=`Could not build the report. Try a smaller capture, or export it with the CLI.`,r.hidden=!1}})}var Se=`modulepreload`,Ce=function(e){return`/contextscope/`+e},M={},we=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=Ce(t,n),t=s(t),t in M)return;M[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:Se,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},N={filter:`all`,page:0},P,F;function Te(){return P??=we(()=>import(`./presentation-D7r_ECKn.js`),[]).catch(e=>{throw P=void 0,e}),P}var I={format:`auto`,model:void 0,analysis:void 0,selectedRequest:0,selectedPair:0,calibration:void 0};function Ee(e){e.innerHTML=De(),Ae(),Oe(),je()}function De(){return`
    <header class="topbar">
      <h1 class="wordmark"><span class="addr" aria-hidden="true">0x00&nbsp;</span>contextscope<span class="dot" aria-hidden="true">.</span></h1>
      <span class="tagline">what's actually in your context window, and why your cache keeps missing</span>
      <div class="topbar-controls" id="topbar-controls" hidden>
        <label class="field">format
          <select id="format-select">
            <option value="auto">auto-detect</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label class="field">model
          <select id="model-select"></select>
        </label>
        <button class="btn" id="new-analysis-btn" type="button">new analysis</button>
      </div>
      <button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle light/dark theme" title="Toggle theme">◐</button>
    </header>

    <div class="load-status" id="load-status" hidden>
      <span role="status">Reading and analyzing locally…</span>
      <button class="btn" id="cancel-load-btn" type="button">cancel import</button>
    </div>
    <p class="intake-error" id="intake-error" role="alert" hidden></p>

    <main id="intake" class="intake">
      <div class="dropzone" id="dropzone">
        <h2>drop a request, or paste one</h2>
        <p class="lead">A single Anthropic Messages or OpenAI (Chat Completions or Responses) request, a JSON array, or JSONL - one API request per line, the shape an agent loop actually sends. Batch-API files and gateway logs are unwrapped. Keep <code>response.usage</code> beside each wrapped request to compare reported counts with the simulation. A gzipped <code>.jsonl.gz</code> works too, decompressed right here.</p>
        <div class="intake-actions">
          <button class="btn primary" id="pick-file-btn" type="button">choose file…</button>
          <button class="btn" id="paste-btn" type="button">paste JSON…</button>
          <input type="file" id="file-input" accept=".json,.jsonl,.gz,application/json,application/gzip" class="visually-hidden" aria-label="Request file" tabindex="-1" />
        </div>
        <textarea aria-label="Request JSON or JSONL" id="paste-area" placeholder="paste a request, a JSON array of requests, or JSONL here" spellcheck="false"></textarea>
        <div class="intake-actions" id="paste-run-row" hidden>
          <button class="btn primary" id="run-paste-btn" type="button">analyze</button>
        </div>
        <p class="hint">Nothing leaves your browser. Parsing and token counting run locally. Up to 50 MB before and after decompression.</p>
        <div class="examples-row">
          <p>or load a built-in example (synthetic data, labelled below)</p>
          <div class="example-chip-row" id="example-chips"></div>
        </div>
      </div>
    </main>

    <div id="dashboard" class="dashboard">
      <nav aria-label="Request navigation"><div class="request-tabs" id="request-tabs" role="tablist" aria-label="Requests"></div></nav>
      <main><div class="content" id="content" role="tabpanel" tabindex="0"></div></main>
      <footer class="app-footer">
        contextscope is local-first: analysis runs in your browser, nothing is uploaded. Claude token counts are estimates (≈) - see
        <a href="https://github.com/antonsoo/contextscope#accuracy-and-limitations" target="_blank" rel="noopener">accuracy and limitations</a>.
      </footer>
    </div>

    <dialog class="drawer" id="drawer" aria-labelledby="drawer-title">
      <div class="drawer-head">
        <h3 id="drawer-title">segment</h3>
        <button class="icon-btn" id="drawer-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" id="drawer-body" tabindex="0" role="region" aria-label="Segment details"></div>
    </dialog>
  `}function Oe(){let e=y(`#dropzone`),t=y(`#file-input`),n=y(`#paste-area`),r=y(`#paste-run-row`);y(`#pick-file-btn`).addEventListener(`click`,()=>t.click()),t.addEventListener(`change`,()=>{let e=t.files?.[0];t.value=``,e&&L(e)}),y(`#paste-btn`).addEventListener(`click`,()=>{n.classList.add(`shown`),r.hidden=!1,n.focus()}),y(`#run-paste-btn`).addEventListener(`click`,()=>{n.value.trim().length>0?ke(n.value):R(`Paste a request (or JSONL of requests) first.`)}),e.addEventListener(`dragover`,t=>{t.preventDefault(),e.classList.add(`drag`)}),e.addEventListener(`dragleave`,()=>e.classList.remove(`drag`)),e.addEventListener(`drop`,t=>{t.preventDefault(),e.classList.remove(`drag`);let n=t.dataTransfer?.files?.[0];n&&L(n)});let i=y(`#example-chips`);i.innerHTML=d.map(e=>`<button class="example-chip" type="button" data-example="${e.id}" title="${v(e.description)}">${v(e.label)}${e.approxSizeMb>=.2?` <span class="chip-size">(${e.approxSizeMb.toFixed(2)} MB gz)</span>`:``}</button>`).join(``),i.addEventListener(`click`,e=>{let t=e.target.closest(`[data-example]`);if(!t||t.disabled)return;let n=d.find(e=>e.id===t.dataset.example);n&&W(e=>n.load(e),!0)})}function L(e){W(t=>c(e,{signal:t}),!0)}function ke(e){W(async()=>e,!0)}function R(e){let t=y(`#intake-error`);t.textContent=e??``,t.hidden=e===void 0}function Ae(){y(`#new-analysis-btn`).addEventListener(`click`,Me),y(`#cancel-load-btn`).addEventListener(`click`,()=>{H(),R(`Import cancelled.`),y(I.analysis?`#new-analysis-btn`:`#pick-file-btn`).focus()});let e=y(`#format-select`);e.addEventListener(`change`,()=>{z!==void 0&&U(z,{format:e.value,model:void 0,calibration:void 0})});let t=y(`#model-select`);t.addEventListener(`change`,()=>{z!==void 0&&U(z,{...I,model:t.value||void 0,calibration:void 0})}),y(`#theme-toggle`).addEventListener(`click`,()=>{let e=document.documentElement.getAttribute(`data-theme`)===`light`?`dark`:`light`;document.documentElement.setAttribute(`data-theme`,e);try{localStorage.setItem(`contextscope-theme`,e)}catch{}}),y(`#drawer-close`).addEventListener(`click`,Q);let n=y(`#drawer`);n.addEventListener(`cancel`,e=>{e.preventDefault(),Q()}),n.addEventListener(`keydown`,e=>{if(e.key!==`Tab`)return;let t=b(`button, [tabindex="0"]`,n),r=t[0],i=t[t.length-1];e.shiftKey&&document.activeElement===r?(e.preventDefault(),i?.focus()):!e.shiftKey&&document.activeElement===i&&(e.preventDefault(),r?.focus())}),n.addEventListener(`click`,e=>{let t=n.getBoundingClientRect();e.target===n&&(e.clientX<t.left||e.clientX>t.right||e.clientY<t.top||e.clientY>t.bottom)&&Q()})}function je(){try{let e=localStorage.getItem(`contextscope-theme`);(e===`light`||e===`dark`)&&document.documentElement.setAttribute(`data-theme`,e)}catch{}}var z,B,V;function H(){B?.abort(),B=void 0,G(!1),Ne()}function Me(){H(),Q(),V?.disconnect(),V=void 0,I.analysis=void 0,I.calibration=void 0,I.format=`auto`,I.model=void 0,I.selectedRequest=0,I.selectedPair=-1,z=void 0,q=void 0,y(`#content`).replaceChildren(),y(`#request-tabs`).replaceChildren();let e=y(`#paste-area`);e.value=``,e.classList.remove(`shown`),y(`#paste-run-row`).hidden=!0,R(void 0),y(`#dashboard`).classList.remove(`shown`),y(`#topbar-controls`).hidden=!0,y(`#intake`).style.display=`grid`,y(`#pick-file-btn`).focus()}function U(e,t,n){W(async()=>e,!1,{format:t.format,model:t.model,calibration:t.calibration},n)}function W(e,t,n={format:`auto`,model:void 0,calibration:void 0},r){H();let i=new AbortController;B=i;let a=document.activeElement?.id,{signal:o}=i;R(void 0),G(!0),(async()=>{try{let i=await e(o);o.throwIfAborted(),l(i);let a=await Te();F=a,o.throwIfAborted();let s=await ae({input:i,options:{format:n.format===`auto`?void 0:n.format,model:n.model,claudeTokenScale:n.calibration?.scale},...r?{measurement:r}:{}},o);o.throwIfAborted();let c=s.result;Q(),I.format=n.format,I.model=n.model,I.calibration=s.calibration??n.calibration,I.analysis=c,t&&(N.filter=`all`,N.page=0),z=i,(t||I.selectedRequest>=c.reports.length)&&(I.selectedRequest=c.conversations.count>1?Ge(c):c.reports.length-1),I.selectedPair=c.prefixMatches.findIndex(e=>e.toIndex===I.selectedRequest),Pe(a),t&&y(`.request-tab.active`).focus()}catch(e){o.aborted||(R(`Could not analyze this input: ${e.message}`),Ne())}finally{B===i&&(B=void 0,G(!1),!t&&a&&(document.getElementById(a)??(a===`calibrate-reset`?document.getElementById(`calibrate-count`):null))?.focus({preventScroll:!0}))}})()}function Ne(){y(`#format-select`).value=I.format,I.analysis&&(y(`#model-select`).value=I.model??``)}function G(e){y(`#load-status`).hidden=!e;for(let t of b(`#format-select, #model-select, #calibrate-count, #calibrate-btn, #calibrate-reset`))t.disabled=e;y(`#dropzone`).setAttribute(`aria-busy`,String(e))}function Pe(e){let t=I.analysis;if(!t)return;F=e,y(`#intake`).style.display=`none`,y(`#dashboard`).classList.add(`shown`),y(`#topbar-controls`).hidden=!1;let n=y(`#format-select`);n.value=I.format;let r=y(`#model-select`);r.innerHTML=`<option value="">from each request</option>`+(t.parse.format===`anthropic`?e.ANTHROPIC_MODELS:e.OPENAI_MODELS).map(e=>`<option value="${e.id}">${v(e.displayName)}</option>`).join(``),r.value=I.model??``,Ie(),Le()}var Fe=!1;function Ie(){let e=I.analysis,t=y(`#request-tabs`);t.innerHTML=e.reports.map((e,t)=>`<button class="request-tab ${t===I.selectedRequest?`active`:``}" data-req="${t}" id="request-tab-${t}" role="tab" aria-selected="${t===I.selectedRequest}" aria-controls="content" tabindex="${t===I.selectedRequest?0:-1}" type="button">req ${t+1}<span class="pct">${g(e.percentOfContextWindow,2)}</span></button>`).join(``),y(`#content`).setAttribute(`aria-labelledby`,`request-tab-${I.selectedRequest}`),t.querySelector(`.request-tab.active`)?.scrollIntoView({block:`nearest`,inline:`nearest`}),Fe||(Fe=!0,new ResizeObserver(()=>{let e=t.querySelector(`.request-tab.active`);if(!e)return;let n=t.getBoundingClientRect(),r=e.getBoundingClientRect();r.left<n.left?t.scrollLeft+=r.left-n.left:r.right>n.right&&(t.scrollLeft+=r.right-n.right)}).observe(t),t.addEventListener(`click`,e=>{let t=e.target.closest(`[data-req]`);t&&K(Number(t.dataset.req))}),t.addEventListener(`keydown`,e=>{if(![`ArrowLeft`,`ArrowRight`,`Home`,`End`].includes(e.key))return;let t=e.target.closest(`[data-req]`);if(!t)return;e.preventDefault();let n=I.analysis.reports.length,r=Number(t.dataset.req);K(e.key===`Home`?0:e.key===`End`?n-1:(r+(e.key===`ArrowRight`?1:-1)+n)%n)}))}function K(e){I.selectedRequest=e,I.selectedPair=I.analysis.prefixMatches.findIndex(t=>t.toIndex===e),Ie(),Le(),y(`.request-tab.active`).focus({preventScroll:!0})}function Le(){V?.disconnect(),V=void 0;let e=I.analysis,t=y(`#content`),n=e.reports[I.selectedRequest];t.innerHTML=`
    ${ze(n,e)}
    ${Re(e)}
    ${e.usageComparison.capturedRequests?`<section class="panel usage-review" id="usage-review" aria-labelledby="usage-heading"></section>`:``}
    ${Xe(e)}
    ${Ve(n,e.parse.format)}
    ${Ue(n)}
    ${e.parse.requests.length>1?Ke(e):``}
    ${Ye(e)}
    ${e.duplicates.length>0?Qe(e):``}
    <section class="panel" id="report-exports" aria-labelledby="report-exports-heading"></section>
    ${$e(e)}
  `,He(n,e.parse.format),We(n),e.parse.requests.length>1&&qe(e),Ze(e),et(e),e.usageComparison.capturedRequests&&E(y(`#usage-review`),e,I.selectedRequest,N,K),xe(y(`#report-exports`),e)}function Re(e){let t=[],n=e.parse.requests[I.selectedRequest]?.source;n&&(n.line||n.envelope||!e.parse.complete)&&t.push(`Selected request: source record ${n.recordIndex+1}${n.line?`, line ${n.line}`:``}${n.envelope?`, <code>${v(n.envelope)}</code> field`:``}.`),e.parse.complete||t.push(`<strong>Incomplete input.</strong> ${e.parse.skippedRecords} of ${e.parse.sourceRecords} source records skipped or not analyzable. Counts and simulations cover retained content only; review the parse warnings.`),e.parse.envelope&&t.push(`Request bodies were read from each record's <code>${v(e.parse.envelope)}</code> field.`);for(let n of me(e))t.push(v(n));let r=e.parse.warnings;for(let e of r.slice(0,5))t.push(v(e.message));return r.length>5&&t.push(`…and ${r.length-5} more parse warnings.`),t.length===0?``:`<section class="panel notes-panel" role="note">${t.map(e=>`<p>${e}</p>`).join(``)}</section>`}function ze(e,t){let n=J(t),r=n.filter(e=>e.severity===`error`).length,i=n.filter(e=>e.severity===`warning`).length,a=t.cacheSimulation.totalActualCostUsd!==void 0&&t.cacheSimulation.totalOptimizedCostUsd!==void 0?t.cacheSimulation.totalActualCostUsd-t.cacheSimulation.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Request ${I.selectedRequest+1} of ${t.reports.length}${t.conversations.count>1?` <span class="count">conversation ${t.conversations.byRequest[I.selectedRequest]+1} of ${m(t.conversations.count)}</span>`:``}</h2>
      <p class="panel-note">${v(k(e.model))}${e.contextWindow===void 0?``:` · ${m(e.contextWindow)} token context window`}</p>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens${t.claudeTokenScale===1?``:` (calibrated)`}</div><div class="value">${m(e.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${m(e.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${g(e.percentOfContextWindow,2)}</div></div>
        <div class="stat-tile"><div class="label">issues</div><div class="value">${r>0?r+` err`:i>0?i+` warn`:n.length}</div></div>
        ${a!==void 0&&a>=5e-5?`<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${h(a)}</div></div>`:``}
      </div>
    </section>
  `}function Be(e,t){return t===`openai`?e.openaiTokens:e.claudeTokensEstimate}function Ve(e,t){return`
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ${t===`openai`?`OpenAI tokens (exact)`:`≈ Claude tokens`}</span></h2>
      <div class="treemap" id="treemap" role="group" aria-label="Treemap of token usage: segments open inspection; grouped categories filter the table"></div>
      ${e.segments.filter(e=>Be(e,t)>0).length>128?`<p class="muted">The 128 largest segments are shown individually; the rest are grouped by category. Grouped blocks filter the table below. All tokens remain included.</p>`:``}
      <div class="legend">
        ${ee.filter(t=>e.byCategory.some(e=>e.category===t)).map(e=>`<span class="legend-item"><span class="legend-swatch" style="background:${p(e)}"></span>${f[e]}</span>`).join(``)}
      </div>
    </section>
  `}function He(t,n){let r=y(`#treemap`),i=n===`openai`?``:`≈`,a=oe(t.segments,n),o=a.map(e=>({value:e.value,item:e}));r.innerHTML=a.map(e=>`<button type="button" class="tm-block" data-block="${v(e.id)}"${e.segment?` data-segment="${v(e.id)}"`:``}></button>`).join(``);let s=new Map(b(`[data-block]`,r).map(e=>[e.dataset.block,e])),c=()=>{let t=r.clientWidth,n=r.clientHeight;if(!(t<=0||n<=0))for(let{rect:r,item:a}of e(o,{x:0,y:0,w:t,h:n})){let e=s.get(a.id),t=r.w<=46?0:r.h>=34?2:+(r.h>=20),n=`${i}${m(a.value)} tok`;e.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${p(a.category)};color:var(--cat-${a.category}-ink)`,e.title=`${a.label} — ${n}${a.segment?``:`, ${a.count} segments; filter table`}`,e.setAttribute(`aria-label`,e.title),e.dataset.tokens=String(a.value),e.innerHTML=t===0?``:`<span class="tm-label"><span class="tm-name">${v(_(a.label,40))}</span>${t===2?`<span class="tm-tok">${n}</span>`:``}</span>`}};c(),V=new ResizeObserver(c),V.observe(r),r.addEventListener(`click`,e=>{let t=e.target.closest(`[data-block]`),n=a.find(e=>e.id===t?.dataset.block);if(n?.segment)X(n.segment);else if(n){let e=y(`#segment-category`);e.value=n.category,y(`#segment-search`).value=``,e.dispatchEvent(new Event(`change`)),e.focus(),e.scrollIntoView({block:`center`,behavior:`smooth`})}})}function Ue(e){return`
    <section class="panel">
      <h2>Segments <span class="count">${e.segments.length} total — click a row to inspect</span></h2>
      <div class="segment-controls">
        <label>category <select id="segment-category"><option value="">all categories</option>${e.byCategory.map(e=>`<option value="${e.category}">${f[e.category]}</option>`).join(``)}</select></label>
        <label>find label or path <input id="segment-search" type="search" placeholder="e.g. messages[12]" /></label>
      </div>
      <div class="segment-controls">
        <span id="segment-range" role="status"></span>
        <button class="btn" id="segments-first" type="button" aria-label="First segment page">first</button>
        <button class="btn" id="segments-prev" type="button" aria-label="Previous segment page">previous</button>
        <button class="btn" id="segments-next" type="button" aria-label="Next segment page">next</button>
        <button class="btn" id="segments-last" type="button" aria-label="Last segment page">last</button>
      </div>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="segments">
          <thead><tr><th>category</th><th>label</th><th>path</th><th>≈ Claude</th><th>OpenAI</th><th>cache</th></tr></thead>
          <tbody id="segments-tbody">
          </tbody>
        </table>
      </div>
    </section>
  `}function We(e){let t=0,n=e.segments,r=y(`#segment-search`),i=y(`#segment-category`),a=()=>{let e=Math.max(1,Math.ceil(n.length/100));t=Math.max(0,Math.min(t,e-1));let i=t*100,a=n.slice(i,i+100);y(`#segment-range`).textContent=n.length?`${i+1}–${i+a.length} of ${n.length} matching segments · page ${t+1} of ${e}`:`No matching segments. Clear the filter to see all segments.`,y(`#segments-tbody`).innerHTML=a.map(e=>`<tr data-segment="${v(e.id)}">
      <td><span class="cat-chip" style="--dot:${p(e.category)}">${f[e.category]}</span></td>
      <td><button class="segment-inspect" type="button" aria-label="Inspect ${v(e.label)}">${v(_(e.label,60))}</button></td>
      <td>${v(e.path)}</td><td class="num">${m(e.claudeTokensEstimate)}</td><td class="num">${m(e.openaiTokens)}</td>
      <td>${e.cacheControl?`<span class="cache-flag"${e.cacheControl.automatic?` title="automatic breakpoint: the request has a top-level cache_control"`:``}>● ${e.cacheControl.ttl}${e.cacheControl.automatic?` auto`:``}</span>`:``}</td></tr>`).join(``);for(let[n,i]of[[`segments-first`,t===0],[`segments-prev`,t===0],[`segments-next`,t===e-1],[`segments-last`,t===e-1]]){let e=document.getElementById(n);e.disabled=i,i&&document.activeElement===e&&r.focus()}},o=()=>{let o=r.value.trim().toLocaleLowerCase(`en-US`);n=e.segments.filter(e=>(!i.value||e.category===i.value)&&(!o||`${e.label} ${e.path}`.toLocaleLowerCase(`en-US`).includes(o))),t=0,a()};r.addEventListener(`input`,o),i.addEventListener(`change`,o);for(let[e,r]of[[`segments-first`,()=>0],[`segments-prev`,()=>t-1],[`segments-next`,()=>t+1],[`segments-last`,()=>Math.ceil(n.length/100)-1]])document.getElementById(e).addEventListener(`click`,()=>{t=r(),a()});a(),y(`#segments-tbody`).addEventListener(`click`,t=>{let n=t.target.closest(`[data-segment]`);n&&X(e.segments.find(e=>e.id===n.dataset.segment))})}function Ge(e){let t=0,n=t=>e.parse.format===`openai`?t.totals.openaiTokens:t.totals.claudeTokensEstimate;return e.reports.forEach((r,i)=>{n(r)>=n(e.reports[t])&&(t=i)}),t}function Ke(e){let t=e.prefixMatches;return`
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">${e.conversations.count>1?`${m(e.conversations.count)} conversations in this file · each request against the request it continues`:`longest common prefix between each consecutive pair`}</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${t.map((t,n)=>{let r=e.parse.requests[t.toIndex].segments.length,i=r>0?t.matchedSegments/r:0;return`<button type="button" aria-pressed="${n===I.selectedPair}" class="prefix-row ${n===I.selectedPair?`active`:``}" data-pair="${n}">
              <span class="arrow">req ${t.fromIndex+1} → req ${t.toIndex+1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(i*100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${t.matchedSegments}/${r} segs · ${e.parse.format===`openai`?m(t.matchedOpenaiTokens):`≈${m(t.matchedClaudeTokensEstimate)}`} tok${t.relation===`new_conversation`?` · new conversation`:t.relation===`rewrites`?` · history rewritten`:``}</span>
            </button>`}).join(``)}
      </div>
      <div class="diff-view" id="diff-view" tabindex="0" role="group" aria-label="Difference from the request this one continues"></div>
    </section>
  `}function qe(e){let t=y(`#prefix-list`);Je(e),t.addEventListener(`click`,t=>{let n=t.target.closest(`[data-pair]`);if(!n)return;let r=Number(n.dataset.pair);K(e.prefixMatches[r].toIndex),document.querySelector(`[data-pair="${r}"]`)?.focus({preventScroll:!0})})}function Je(e){let t=e.prefixMatches[I.selectedPair],n=y(`#diff-view`);if(!t){n.textContent=`This request has no earlier request to compare.`;return}n.innerHTML=t.diff.map(e=>`<div class="diff-line ${e.type}">${e.type===`add`?`+ `:e.type===`remove`?`- `:`  `}${v(e.text)}</div>`).join(``)}function Ye(e){let t=e.cacheSimulation,n=O(e).length>1,r=t.totalActualCostUsd!==void 0&&t.totalOptimizedCostUsd!==void 0?t.totalActualCostUsd-t.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Cache simulation <span class="count">${t.provider} · ${v(pe(e))}</span></h2>
      ${e.usageComparison.capturedRequests?``:`<p class="muted">No paired response usage. These cache reads and costs are simulated.</p>`}
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="cache">
          <thead><tr><th>request</th>${n?`<th class="cache-model">model</th>`:``}<th>read</th><th>write 5m</th><th>write 1h</th><th>uncached</th><th>cost</th></tr></thead>
          <tbody>
            ${t.actual.map((t,r)=>`<tr><td>req ${r+1}</td>${n?`<td class="cache-model">${v(k(e.reports[r].model))}</td>`:``}<td>${m(t.readTokens)}</td><td>${m(t.writeTokens5m)}</td><td>${m(t.writeTokens1h)}</td><td>${m(t.uncachedTokens)}</td><td>${h(t.costUsd)}</td></tr>`).join(``)}
          </tbody>
        </table>
      </div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat-tile"><div class="label">current simulated cost</div><div class="value">${h(t.totalActualCostUsd)}</div></div>
        <div class="stat-tile"><div class="label">optimized simulated cost</div><div class="value">${h(t.totalOptimizedCostUsd)}</div></div>
      </div>
      ${r!==void 0&&r>=5e-5?`<div class="savings-banner">Fixing these findings${t.provider===`anthropic`?`, with a breakpoint on each request's last cacheable block (moving the last marker if all four slots are used),`:``} would save ${h(r)} (${(r/t.totalActualCostUsd*100).toFixed(0)}%) on this sequence — ≈${te(r*1e3)} per 1,000 sessions shaped like this one.</div>`:``}
    </section>
  `}var q;function J(e){return q?.result!==e&&(q={result:e,groups:F.groupFindings(e.findings)}),q.groups}var Y=12;function Xe(e){let t=J(e);if(t.length===0)return`<section class="panel"><h2>Findings</h2><p class="empty-state">No supported cache or duplicate-content issues detected in the parsed requests. This does not verify live cache hits.</p></section>`;let n=e.findings.length>t.length?` from ${e.findings.length} findings`:``;return`
    <section class="panel">
      <h2>Findings <span class="count">${t.length} issue${t.length===1?``:`s`}${n}</span></h2>
      <div class="finding-list">
        ${t.map((e,t)=>{let n=F.describeRequestIndices(e.requestIndices),r=e.requestIndices.length>1?`<div class="foccur">${e.requestIndices.slice(0,Y).map(e=>`<button type="button" class="occ ${e===I.selectedRequest?`active`:``}" data-group="${t}" data-req="${e}">req ${e+1}</button>`).join(``)}${e.requestIndices.length>Y?`<span class="occ-more">+${e.requestIndices.length-Y} more</span>`:``}</div>`:``;return`<div class="finding ${e.severity}">
              <button type="button" class="fhead" data-group="${t}" data-req="${e.requestIndices[0]}"><span class="fsev">${e.severity}</span> ${v(e.title)} <span class="freq">(${n}${e.requestIndices.length>1?`, ${e.requestIndices.length}×`:``})</span></button>
              <div class="fdetail">${v(e.detail)}</div>
              ${r}
            </div>`}).join(``)}
      </div>
    </section>
  `}function Ze(e){let t=J(e);b(`[data-group]`).forEach(n=>{n.addEventListener(`click`,()=>{let r=t[Number(n.dataset.group)],i=Number(n.dataset.req);if(!r)return;let a=r.findings.find(e=>e.requestIndex===i)??r.findings[0];a.requestIndex!==I.selectedRequest&&(K(a.requestIndex),document.querySelector(`[data-group="${n.dataset.group}"][data-req="${i}"].${n.classList.contains(`occ`)?`occ`:`fhead`}`)?.focus({preventScroll:!0}));let o=a.segmentIds[a.segmentIds.length-1];if(o){let t=e.reports[a.requestIndex]?.segments.find(e=>e.id===o);t&&X(t)}})})}function Qe(e){return`
    <section class="panel">
      <h2>Duplicate content <span class="count">${e.duplicates.length} group${e.duplicates.length===1?``:`s`}</span></h2>
      <div class="dup-list">
        ${e.duplicates.map(e=>`<div class="dup-row"><span>${e.members.length}× "${v(_(e.members[0].label,50))}" <span style="color:var(--text-faint)">(similarity ${(e.similarity*100).toFixed(0)}%)</span></span><span class="waste">≈${m(e.estimatedWastedTokens)} wasted tok</span></div>`).join(``)}
      </div>
    </section>
  `}function $e(e){if(e.parse.format!==`anthropic`)return``;let t=I.calibration,n=t?`<p class="calibrate-result" role="status">Using your measured count of <strong>${m(t.exactTokens)}</strong> input tokens for request ${t.requestIndex+1} on ${v(t.model)}. The original estimate was ≈${m(t.estimatedTokens)}. Every Claude estimate is scaled ×${t.scale.toFixed(3)}. Other requests and individual segments remain estimates. <button class="btn link" id="calibrate-reset" type="button">undo calibration</button></p>`:``;return`
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional · local only</span></h2>
      <p class="panel-note" id="calibrate-help">
        Enter the whole-request <code>input_tokens</code> count you measured with <code>count_tokens</code>
        for request ${I.selectedRequest+1} on ${v(k(e.reports[I.selectedRequest].model))}. This rescales the session's estimates;
        it does not make each segment exact. Use the same request and model. No API key or request is sent from this page.
      </p>
      <form class="calibrate-row" id="calibrate-form" novalidate>
        <label for="calibrate-count">Measured input tokens</label>
        <input type="number" id="calibrate-count" min="1" max="9007199254740991" step="1" inputmode="numeric" placeholder="e.g. 18420" aria-describedby="calibrate-help calibrate-status" />
        <button class="btn primary" id="calibrate-btn" type="submit">apply to request ${I.selectedRequest+1}</button>
        <span class="calibrate-status" id="calibrate-status" role="alert"></span>
      </form>
      ${n}
    </section>
  `}function et(e){document.getElementById(`calibrate-form`)?.addEventListener(`submit`,t=>{if(t.preventDefault(),B)return;let n=y(`#calibrate-count`);try{F.calibrationScale(n.valueAsNumber,1),U(z,I,{requestIndex:I.selectedRequest,model:e.reports[I.selectedRequest].model.id,exactTokens:n.valueAsNumber})}catch(e){y(`#calibrate-status`).textContent=e.message,n.setAttribute(`aria-invalid`,`true`),n.focus()}}),document.getElementById(`calibrate-reset`)?.addEventListener(`click`,()=>{z!==void 0&&U(z,{...I,calibration:void 0})})}function X(e){y(`#drawer-title`).textContent=e.label;let t=e.charLength>x,n=t?e.text:typeof e.raw==`string`?e.raw:JSON.stringify(e.raw,null,2);y(`#drawer-body`).innerHTML=`
    <dl>
      <dt>category</dt><dd>${f[e.category]}</dd>
      <dt>path</dt><dd>${v(e.path)}</dd>
      <dt>chars</dt><dd>${m(e.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${m(e.claudeTokensEstimate)}${I.calibration?` <span class="muted">(scaled ×${I.calibration.scale.toFixed(3)})</span>`:``}</dd>
      <dt>OpenAI tokens</dt><dd>${m(e.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${e.cacheControl?`ephemeral, ${e.cacheControl.ttl}${e.cacheControl.automatic?` (automatic: the request's top-level cache_control lands on this block)`:``}`:`none`}</dd>
    </dl>
    ${t||n.length>2e4?`<p>Showing the first ${x.toLocaleString(`en-US`)} characters${t?` of the analyzed segment text`:` of raw content`}. Download the original raw JSON for complete evidence.</p>`:``}
    <button class="btn" id="download-segment" type="button">download original raw JSON</button>
    <pre>${v(n.slice(0,x))}</pre>
  `,y(`#download-segment`).addEventListener(`click`,()=>{let t=URL.createObjectURL(new Blob([JSON.stringify(e.raw,null,2)],{type:`application/json`})),n=document.createElement(`a`);n.href=t,n.download=`contextscope-segment.json`,n.click(),setTimeout(()=>URL.revokeObjectURL(t),1e3)});let r=y(`#drawer`);r.open||(Z=document.activeElement,r.showModal()),y(`#drawer-close`).focus()}var Z=null;function Q(){let e=y(`#drawer`);e.open&&e.close(),y(`#drawer-title`).textContent=`segment`,y(`#drawer-body`).replaceChildren(),Z instanceof HTMLElement&&Z.isConnected&&Z.focus(),Z=null}var $=document.getElementById(`app`);if(!$)throw Error(`contextscope: #app root element not found`);Ee($);export{fe as n,D as t};