(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e,t){let n=e.filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.reduce((e,t)=>e+t.value,0);if(r<=0||n.length===0)return[];let i=t.w*t.h,a=n.map(e=>({...e,value:e.value/r*i})),o=[],s={...t},c=[],l=a;function u(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=0;for(let i of e){let e=i.value/(n/t),a=Math.max(e/t,t/e);a>r&&(r=a)}return r}function d(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=t.w>=t.h,i=r?t.h:t.w,a=i>0?n/i:0,s=0;for(let c of e){let e=n>0?c.value/n*i:0;r?o.push({rect:{x:t.x,y:t.y+s,w:a,h:e},item:c.item}):o.push({rect:{x:t.x+s,y:t.y,w:e,h:a},item:c.item}),s+=e}return r?{x:t.x+a,y:t.y,w:t.w-a,h:t.h}:{x:t.x,y:t.y+a,w:t.w,h:t.h-a}}for(;l.length>0;){let e=l[0],t=[...c,e];c.length===0||u(t,Math.min(s.w,s.h))<=u(c,Math.min(s.w,s.h))?(c=t,l=l.slice(1)):(s=d(c,s),c=[])}return c.length>0&&d(c,s),o}function t(e){let t=(e[0]===255&&e[1]===254?`utf-16le`:e[0]===254&&e[1]===255?`utf-16be`:null)??`utf-8`;try{return new TextDecoder(t,{fatal:!0}).decode(e)}catch{throw Error(`Invalid ${t.toUpperCase()} encoding. Export or save the original log as valid UTF-8 (or UTF-16 with a byte-order mark) and import it again.`)}}var n=50*2**20;function r(e){let t=e.maxBytes??n;if(!Number.isSafeInteger(t)||t<1||t>n)throw Error(`Invalid input byte limit.`);return t}function i(e){return Error(`Input exceeds ${(e/2**20).toLocaleString(`en-US`)} MB before or after decompression. Split the log into smaller sessions.`)}async function a(e,t={}){let n=r(t),{signal:a}=t,o=e.getReader(),s=()=>{o.cancel(a?.reason).catch(()=>{})};a?.addEventListener(`abort`,s,{once:!0});let c=[],l=0;try{for(a?.throwIfAborted();;){let{done:e,value:t}=await o.read();if(a?.throwIfAborted(),e)break;if(l+=t.byteLength,l>n)throw i(n);c.push(t)}let e=new Uint8Array(l),t=0;for(let n of c)e.set(n,t),t+=n.byteLength;return e}finally{a?.removeEventListener(`abort`,s),await o.cancel().catch(()=>{}),o.releaseLock()}}function o(e){return e[0]===31&&e[1]===139}async function s(e,n={}){n.signal?.throwIfAborted();let s=r(n);if(e.byteLength>s)throw i(s);return o(e)?t(await a(new Blob([e]).stream().pipeThrough(new DecompressionStream(`gzip`)),n)):t(e)}async function c(e,t={}){let n=r(t);if(e.size>n)throw i(n);return s(await a(e.stream(),t),t)}function l(e){if(e.length>n||new TextEncoder().encode(e).byteLength>n)throw i(n)}async function u(e,t){let n=`/contextscope/examples/${e}`,r=await fetch(n,{signal:t});if(!r.ok)throw Error(`Could not fetch example "${e}" (${r.status})`);if(!r.body)throw Error(`The example response has no body.`);return s(await a(r.body,{signal:t}),{signal:t})}var d=[{id:`cache-bust`,label:`Cache bust: timestamp in system prompt`,description:`Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.`,approxSizeMb:.48,load:e=>u(`anthropic-agent-cache-bust.jsonl.gz`,e)},{id:`cache-fixed`,label:`Cache fixed: same session, timestamp removed`,description:`The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.`,approxSizeMb:.48,load:e=>u(`anthropic-agent-cache-fixed.jsonl.gz`,e)},{id:`duplicate-tool-results`,label:`Duplicate content: same file read 3 times`,description:`Synthetic session where an agent re-reads an unchanged file three times in one conversation.`,approxSizeMb:.13,load:e=>u(`anthropic-duplicate-tool-results.jsonl`,e)},{id:`openai-tools-reordered`,label:`OpenAI: tools reordered mid-session`,description:`Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.`,approxSizeMb:.13,load:e=>u(`openai-agent-tools-reordered.jsonl`,e)}],f={system:`system`,tools:`tool definitions`,user:`user text`,assistant:`assistant text`,tool_call:`tool calls`,tool_result:`tool results`,image:`images`,thinking:`thinking`},ee=[`system`,`tools`,`user`,`assistant`,`tool_call`,`tool_result`,`image`,`thinking`];function p(e){return`var(--cat-${e})`}function m(e){return e.toLocaleString(`en-US`)}function h(e){return e===void 0?`n/a`:`$${e.toFixed(e<1?4:2)}`}function te(e){return`$${e.toLocaleString(`en-US`,{maximumFractionDigits:0})}`}function g(e,t=1){return e===void 0?`n/a`:`${(e*100).toFixed(t)}%`}function _(e,t){let n=e.replace(/\s+/g,` `).trim();return n.length>t?`${n.slice(0,t)}…`:n}function v(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function y(e,t=document){let n=t.querySelector(e);if(!n)throw Error(`contextscope: missing required element "${e}"`);return n}function b(e,t=document){return Array.from(t.querySelectorAll(e))}var ne=`/contextscope/assets/analysis-worker-Dlj-TioO.js`;function re(e){if(!e||typeof e.parse?.complete!=`boolean`||!Array.isArray(e.parse.requests))return!1;let t=e.parse.requests.length;return t>0&&Array.isArray(e.reports)&&e.reports.length===t&&typeof e.model?.id==`string`&&typeof e.model.displayName==`string`&&Array.isArray(e.prefixMatches)&&Array.isArray(e.findings)&&Array.isArray(e.duplicates)&&Array.isArray(e.conversations?.byRequest)&&e.conversations.byRequest.length===t&&Array.isArray(e.cacheSimulation?.actual)&&e.cacheSimulation.actual.length===t&&Array.isArray(e.cacheSimulation.optimized)&&e.cacheSimulation.optimized.length===t&&e.reports.every(e=>Array.isArray(e?.segments)&&Array.isArray(e.byCategory)&&Number.isSafeInteger(e.totals?.openaiTokens)&&Number.isSafeInteger(e.totals.claudeTokensEstimate))}function x(){let e=new URL(ne,location.href);if(e.origin!==location.origin)throw Error(`The analysis worker must be served from this site's origin.`);let t=URL.createObjectURL(new Blob([`import ${JSON.stringify(e.href)};`],{type:`text/javascript`}));try{let e=new Worker(t,{type:`module`}),n=e.terminate.bind(e);return e.terminate=()=>{n(),URL.revokeObjectURL(t)},e}catch(e){throw URL.revokeObjectURL(t),e}}function ie(e,t,n=x){return new Promise((r,i)=>{let a,o=!1,s=(e,n)=>{o||(o=!0,t.removeEventListener(`abort`,c),a&&(a.onmessage=null,a.onerror=null,a.onmessageerror=null,a.terminate()),e?r(e):i(n))},c=()=>s(void 0,t.reason??new DOMException(`Analysis cancelled.`,`AbortError`));if(t.aborted){c();return}t.addEventListener(`abort`,c,{once:!0});try{if(a=n(),t.aborted||o){a.terminate();return}a.onmessage=e=>{let t=e.data;t?.type!==`started`&&(t?.type===`error`&&typeof t.message==`string`?s(void 0,Error(t.message)):t?.type===`success`&&re(t.result)?s(t):s(void 0,Error(`Analysis worker returned an unreadable result. Try importing the log again.`)))},a.onerror=e=>{e.preventDefault(),s(void 0,Error(`Analysis worker failed: ${e.message||`could not load or process this log`}. Try importing the log again.`))},a.onmessageerror=()=>s(void 0,Error(`Could not receive the analysis result. Try a smaller session.`)),a.postMessage(e)}catch(e){s(void 0,Error(`Could not start local analysis: ${e instanceof Error?e.message:String(e)}. Try importing the log again.`))}})}var S=2e4;function ae(e,t){let n=e.map(e=>({id:e.id,category:e.category,label:e.label,segment:e,count:1,value:t===`openai`?e.openaiTokens:e.claudeTokensEstimate})).filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.slice(0,128),i=new Map;for(let e of n.slice(128)){let t=i.get(e.category);t||(t={id:`other:${e.category}`,category:e.category,label:`other ${e.category} segments`,value:0,count:0},i.set(e.category,t)),t.value+=e.value,t.count++}return[...r,...i.values()]}var oe=`modulepreload`,C=function(e){return`/contextscope/`+e},w={},T=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=C(t,n),t=s(t),t in w)return;w[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:oe,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},E,D;function se(){return E??=T(()=>import(`./presentation-ydxuDuto.js`),[]).catch(e=>{throw E=void 0,e}),E}var O={format:`auto`,model:void 0,analysis:void 0,selectedRequest:0,selectedPair:0,calibration:void 0};function ce(e){e.innerHTML=le(),j(),ue(),fe()}function le(){return`
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
        <p class="lead">A single Anthropic Messages or OpenAI (Chat Completions or Responses) request, a JSON array, or JSONL - one API request per line, the shape an agent loop actually sends. Batch-API files and gateway logs are unwrapped, and a gzipped <code>.jsonl.gz</code> works too, decompressed right here.</p>
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
  `}function ue(){let e=y(`#dropzone`),t=y(`#file-input`),n=y(`#paste-area`),r=y(`#paste-run-row`);y(`#pick-file-btn`).addEventListener(`click`,()=>t.click()),t.addEventListener(`change`,()=>{let e=t.files?.[0];t.value=``,e&&k(e)}),y(`#paste-btn`).addEventListener(`click`,()=>{n.classList.add(`shown`),r.hidden=!1,n.focus()}),y(`#run-paste-btn`).addEventListener(`click`,()=>{n.value.trim().length>0?de(n.value):A(`Paste a request (or JSONL of requests) first.`)}),e.addEventListener(`dragover`,t=>{t.preventDefault(),e.classList.add(`drag`)}),e.addEventListener(`dragleave`,()=>e.classList.remove(`drag`)),e.addEventListener(`drop`,t=>{t.preventDefault(),e.classList.remove(`drag`);let n=t.dataTransfer?.files?.[0];n&&k(n)});let i=y(`#example-chips`);i.innerHTML=d.map(e=>`<button class="example-chip" type="button" data-example="${e.id}" title="${v(e.description)}">${v(e.label)}${e.approxSizeMb>=.2?` <span class="chip-size">(${e.approxSizeMb.toFixed(2)} MB gz)</span>`:``}</button>`).join(``),i.addEventListener(`click`,e=>{let t=e.target.closest(`[data-example]`);if(!t||t.disabled)return;let n=d.find(e=>e.id===t.dataset.example);n&&R(e=>n.load(e),!0)})}function k(e){R(t=>c(e,{signal:t}),!0)}function de(e){R(async()=>e,!0)}function A(e){let t=y(`#intake-error`);t.textContent=e??``,t.hidden=e===void 0}function j(){y(`#new-analysis-btn`).addEventListener(`click`,I),y(`#cancel-load-btn`).addEventListener(`click`,()=>{F(),A(`Import cancelled.`),y(O.analysis?`#new-analysis-btn`:`#pick-file-btn`).focus()});let e=y(`#format-select`);e.addEventListener(`change`,()=>{M!==void 0&&L(M,{format:e.value,model:void 0,calibration:void 0})});let t=y(`#model-select`);t.addEventListener(`change`,()=>{M!==void 0&&L(M,{...O,model:t.value,calibration:void 0})}),y(`#theme-toggle`).addEventListener(`click`,()=>{let e=document.documentElement.getAttribute(`data-theme`)===`light`?`dark`:`light`;document.documentElement.setAttribute(`data-theme`,e);try{localStorage.setItem(`contextscope-theme`,e)}catch{}}),y(`#drawer-close`).addEventListener(`click`,Q);let n=y(`#drawer`);n.addEventListener(`cancel`,e=>{e.preventDefault(),Q()}),n.addEventListener(`keydown`,e=>{if(e.key!==`Tab`)return;let t=b(`button, [tabindex="0"]`,n),r=t[0],i=t[t.length-1];e.shiftKey&&document.activeElement===r?(e.preventDefault(),i?.focus()):!e.shiftKey&&document.activeElement===i&&(e.preventDefault(),r?.focus())}),n.addEventListener(`click`,e=>{let t=n.getBoundingClientRect();e.target===n&&(e.clientX<t.left||e.clientX>t.right||e.clientY<t.top||e.clientY>t.bottom)&&Q()})}function fe(){try{let e=localStorage.getItem(`contextscope-theme`);(e===`light`||e===`dark`)&&document.documentElement.setAttribute(`data-theme`,e)}catch{}}var M,N,P;function F(){N?.abort(),N=void 0,B(!1),z()}function I(){F(),Q(),P?.disconnect(),P=void 0,O.analysis=void 0,O.calibration=void 0,O.format=`auto`,O.model=void 0,O.selectedRequest=0,O.selectedPair=-1,M=void 0,q=void 0,y(`#content`).replaceChildren(),y(`#request-tabs`).replaceChildren();let e=y(`#paste-area`);e.value=``,e.classList.remove(`shown`),y(`#paste-run-row`).hidden=!0,A(void 0),y(`#dashboard`).classList.remove(`shown`),y(`#topbar-controls`).hidden=!0,y(`#intake`).style.display=`grid`,y(`#pick-file-btn`).focus()}function L(e,t,n){R(async()=>e,!1,{format:t.format,model:t.model,calibration:t.calibration},n)}function R(e,t,n={format:`auto`,model:void 0,calibration:void 0},r){F();let i=new AbortController;N=i;let a=document.activeElement?.id,{signal:o}=i;A(void 0),B(!0),(async()=>{try{let i=await e(o);o.throwIfAborted(),l(i);let a=await se();D=a,o.throwIfAborted();let s=await ie({input:i,options:{format:n.format===`auto`?void 0:n.format,model:n.model,claudeTokenScale:n.calibration?.scale},...r?{measurement:r}:{}},o);o.throwIfAborted();let c=s.result;Q(),O.format=n.format,O.model=n.model,O.calibration=s.calibration??n.calibration,O.analysis=c,M=i,(t||O.selectedRequest>=c.reports.length)&&(O.selectedRequest=c.conversations.count>1?ye(c):c.reports.length-1),O.selectedPair=c.prefixMatches.findIndex(e=>e.toIndex===O.selectedRequest),V(a),t&&y(`.request-tab.active`).focus()}catch(e){o.aborted||(A(`Could not analyze this input: ${e.message}`),z())}finally{N===i&&(N=void 0,B(!1),!t&&a&&(document.getElementById(a)??(a===`calibrate-reset`?document.getElementById(`calibrate-count`):null))?.focus({preventScroll:!0}))}})()}function z(){y(`#format-select`).value=O.format,O.analysis&&(y(`#model-select`).value=O.analysis.model.id)}function B(e){y(`#load-status`).hidden=!e;for(let t of b(`#format-select, #model-select, #calibrate-count, #calibrate-btn, #calibrate-reset`))t.disabled=e;y(`#dropzone`).setAttribute(`aria-busy`,String(e))}function V(e){let t=O.analysis;if(!t)return;D=e,y(`#intake`).style.display=`none`,y(`#dashboard`).classList.add(`shown`),y(`#topbar-controls`).hidden=!1;let n=y(`#format-select`);n.value=O.format;let r=y(`#model-select`);r.innerHTML=(t.parse.format===`anthropic`?e.ANTHROPIC_MODELS:e.OPENAI_MODELS).map(e=>`<option value="${e.id}">${v(e.displayName)}</option>`).join(``),r.value=t.model.id,U(),G()}var H=!1;function U(){let e=O.analysis,t=y(`#request-tabs`);t.innerHTML=e.reports.map((e,t)=>`<button class="request-tab ${t===O.selectedRequest?`active`:``}" data-req="${t}" id="request-tab-${t}" role="tab" aria-selected="${t===O.selectedRequest}" aria-controls="content" tabindex="${t===O.selectedRequest?0:-1}" type="button">req ${t+1}<span class="pct">${g(e.percentOfContextWindow,2)}</span></button>`).join(``),y(`#content`).setAttribute(`aria-labelledby`,`request-tab-${O.selectedRequest}`),t.querySelector(`.request-tab.active`)?.scrollIntoView({block:`nearest`,inline:`nearest`}),H||(H=!0,new ResizeObserver(()=>{let e=t.querySelector(`.request-tab.active`);if(!e)return;let n=t.getBoundingClientRect(),r=e.getBoundingClientRect();r.left<n.left?t.scrollLeft+=r.left-n.left:r.right>n.right&&(t.scrollLeft+=r.right-n.right)}).observe(t),t.addEventListener(`click`,e=>{let t=e.target.closest(`[data-req]`);t&&W(Number(t.dataset.req))}),t.addEventListener(`keydown`,e=>{if(![`ArrowLeft`,`ArrowRight`,`Home`,`End`].includes(e.key))return;let t=e.target.closest(`[data-req]`);if(!t)return;e.preventDefault();let n=O.analysis.reports.length,r=Number(t.dataset.req);W(e.key===`Home`?0:e.key===`End`?n-1:(r+(e.key===`ArrowRight`?1:-1)+n)%n)}))}function W(e){O.selectedRequest=e,O.selectedPair=O.analysis.prefixMatches.findIndex(t=>t.toIndex===e),U(),G(),y(`.request-tab.active`).focus({preventScroll:!0})}function G(){P?.disconnect(),P=void 0;let e=O.analysis,t=y(`#content`),n=e.reports[O.selectedRequest];t.innerHTML=`
    ${K(n,e)}
    ${pe(e)}
    ${Te(e)}
    ${he(n,e.parse.format)}
    ${_e(n)}
    ${e.parse.requests.length>1?be(e):``}
    ${Ce(e)}
    ${e.duplicates.length>0?De(e):``}
    ${Oe(e)}
  `,ge(n,e.parse.format),ve(n),e.parse.requests.length>1&&xe(e),Ee(e),ke(e)}function pe(e){let t=[],n=e.parse.requests[O.selectedRequest]?.source;n&&(n.line||n.envelope||!e.parse.complete)&&t.push(`Selected request: source record ${n.recordIndex+1}${n.line?`, line ${n.line}`:``}${n.envelope?`, <code>${v(n.envelope)}</code> field`:``}.`),e.parse.complete||t.push(`<strong>Incomplete input.</strong> ${e.parse.skippedRecords} of ${e.parse.sourceRecords} source records skipped or not analyzable. Counts and simulations cover retained content only; review the parse warnings.`),e.parse.envelope&&t.push(`Request bodies were read from each record's <code>${v(e.parse.envelope)}</code> field.`),e.model.unrecognized&&t.push(`The requests name <code>${v(e.model.unrecognized)}</code>, which isn't in the pricing table, so costs use ${v(e.model.displayName)}. Pick the right model above.`);let r=e.parse.warnings;for(let e of r.slice(0,5))t.push(v(e.message));return r.length>5&&t.push(`…and ${r.length-5} more parse warnings.`),t.length===0?``:`<section class="panel notes-panel" role="note">${t.map(e=>`<p>${e}</p>`).join(``)}</section>`}function K(e,t){let n=J(t),r=n.filter(e=>e.severity===`error`).length,i=n.filter(e=>e.severity===`warning`).length,a=t.cacheSimulation.totalActualCostUsd!==void 0&&t.cacheSimulation.totalOptimizedCostUsd!==void 0?t.cacheSimulation.totalActualCostUsd-t.cacheSimulation.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Request ${O.selectedRequest+1} of ${t.reports.length}${t.conversations.count>1?` <span class="count">conversation ${t.conversations.byRequest[O.selectedRequest]+1} of ${m(t.conversations.count)}</span>`:``}</h2>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens${t.claudeTokenScale===1?``:` (calibrated)`}</div><div class="value">${m(e.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${m(e.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${g(e.percentOfContextWindow,2)}</div></div>
        <div class="stat-tile"><div class="label">issues</div><div class="value">${r>0?r+` err`:i>0?i+` warn`:n.length}</div></div>
        ${a!==void 0&&a>=5e-5?`<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${h(a)}</div></div>`:``}
      </div>
    </section>
  `}function me(e,t){return t===`openai`?e.openaiTokens:e.claudeTokensEstimate}function he(e,t){return`
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ${t===`openai`?`OpenAI tokens (exact)`:`≈ Claude tokens`}</span></h2>
      <div class="treemap" id="treemap" role="group" aria-label="Treemap of token usage: segments open inspection; grouped categories filter the table"></div>
      ${e.segments.filter(e=>me(e,t)>0).length>128?`<p class="muted">The 128 largest segments are shown individually; the rest are grouped by category. Grouped blocks filter the table below. All tokens remain included.</p>`:``}
      <div class="legend">
        ${ee.filter(t=>e.byCategory.some(e=>e.category===t)).map(e=>`<span class="legend-item"><span class="legend-swatch" style="background:${p(e)}"></span>${f[e]}</span>`).join(``)}
      </div>
    </section>
  `}function ge(t,n){let r=y(`#treemap`),i=n===`openai`?``:`≈`,a=ae(t.segments,n),o=a.map(e=>({value:e.value,item:e}));r.innerHTML=a.map(e=>`<button type="button" class="tm-block" data-block="${v(e.id)}"${e.segment?` data-segment="${v(e.id)}"`:``}></button>`).join(``);let s=new Map(b(`[data-block]`,r).map(e=>[e.dataset.block,e])),c=()=>{let t=r.clientWidth,n=r.clientHeight;if(!(t<=0||n<=0))for(let{rect:r,item:a}of e(o,{x:0,y:0,w:t,h:n})){let e=s.get(a.id),t=r.w<=46?0:r.h>=34?2:+(r.h>=20),n=`${i}${m(a.value)} tok`;e.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${p(a.category)};color:var(--cat-${a.category}-ink)`,e.title=`${a.label} — ${n}${a.segment?``:`, ${a.count} segments; filter table`}`,e.setAttribute(`aria-label`,e.title),e.dataset.tokens=String(a.value),e.innerHTML=t===0?``:`<span class="tm-label"><span class="tm-name">${v(_(a.label,40))}</span>${t===2?`<span class="tm-tok">${n}</span>`:``}</span>`}};c(),P=new ResizeObserver(c),P.observe(r),r.addEventListener(`click`,e=>{let t=e.target.closest(`[data-block]`),n=a.find(e=>e.id===t?.dataset.block);if(n?.segment)X(n.segment);else if(n){let e=y(`#segment-category`);e.value=n.category,y(`#segment-search`).value=``,e.dispatchEvent(new Event(`change`)),e.focus(),e.scrollIntoView({block:`center`,behavior:`smooth`})}})}function _e(e){return`
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
  `}function ve(e){let t=0,n=e.segments,r=y(`#segment-search`),i=y(`#segment-category`),a=()=>{let e=Math.max(1,Math.ceil(n.length/100));t=Math.max(0,Math.min(t,e-1));let i=t*100,a=n.slice(i,i+100);y(`#segment-range`).textContent=n.length?`${i+1}–${i+a.length} of ${n.length} matching segments · page ${t+1} of ${e}`:`No matching segments. Clear the filter to see all segments.`,y(`#segments-tbody`).innerHTML=a.map(e=>`<tr data-segment="${v(e.id)}">
      <td><span class="cat-chip" style="--dot:${p(e.category)}">${f[e.category]}</span></td>
      <td><button class="segment-inspect" type="button" aria-label="Inspect ${v(e.label)}">${v(_(e.label,60))}</button></td>
      <td>${v(e.path)}</td><td class="num">${m(e.claudeTokensEstimate)}</td><td class="num">${m(e.openaiTokens)}</td>
      <td>${e.cacheControl?`<span class="cache-flag"${e.cacheControl.automatic?` title="automatic breakpoint: the request has a top-level cache_control"`:``}>● ${e.cacheControl.ttl}${e.cacheControl.automatic?` auto`:``}</span>`:``}</td></tr>`).join(``);for(let[n,i]of[[`segments-first`,t===0],[`segments-prev`,t===0],[`segments-next`,t===e-1],[`segments-last`,t===e-1]]){let e=document.getElementById(n);e.disabled=i,i&&document.activeElement===e&&r.focus()}},o=()=>{let o=r.value.trim().toLocaleLowerCase(`en-US`);n=e.segments.filter(e=>(!i.value||e.category===i.value)&&(!o||`${e.label} ${e.path}`.toLocaleLowerCase(`en-US`).includes(o))),t=0,a()};r.addEventListener(`input`,o),i.addEventListener(`change`,o);for(let[e,r]of[[`segments-first`,()=>0],[`segments-prev`,()=>t-1],[`segments-next`,()=>t+1],[`segments-last`,()=>Math.ceil(n.length/100)-1]])document.getElementById(e).addEventListener(`click`,()=>{t=r(),a()});a(),y(`#segments-tbody`).addEventListener(`click`,t=>{let n=t.target.closest(`[data-segment]`);n&&X(e.segments.find(e=>e.id===n.dataset.segment))})}function ye(e){let t=0,n=t=>e.parse.format===`openai`?t.totals.openaiTokens:t.totals.claudeTokensEstimate;return e.reports.forEach((r,i)=>{n(r)>=n(e.reports[t])&&(t=i)}),t}function be(e){let t=e.prefixMatches;return`
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">${e.conversations.count>1?`${m(e.conversations.count)} conversations in this file · each request against the request it continues`:`longest common prefix between each consecutive pair`}</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${t.map((t,n)=>{let r=e.parse.requests[t.toIndex].segments.length,i=r>0?t.matchedSegments/r:0;return`<button type="button" aria-pressed="${n===O.selectedPair}" class="prefix-row ${n===O.selectedPair?`active`:``}" data-pair="${n}">
              <span class="arrow">req ${t.fromIndex+1} → req ${t.toIndex+1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(i*100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${t.matchedSegments}/${r} segs · ${e.parse.format===`openai`?m(t.matchedOpenaiTokens):`≈${m(t.matchedClaudeTokensEstimate)}`} tok${t.relation===`new_conversation`?` · new conversation`:t.relation===`rewrites`?` · history rewritten`:``}</span>
            </button>`}).join(``)}
      </div>
      <div class="diff-view" id="diff-view" tabindex="0" role="group" aria-label="Difference from the request this one continues"></div>
    </section>
  `}function xe(e){let t=y(`#prefix-list`);Se(e),t.addEventListener(`click`,t=>{let n=t.target.closest(`[data-pair]`);if(!n)return;let r=Number(n.dataset.pair);W(e.prefixMatches[r].toIndex),document.querySelector(`[data-pair="${r}"]`)?.focus({preventScroll:!0})})}function Se(e){let t=e.prefixMatches[O.selectedPair],n=y(`#diff-view`);if(!t){n.textContent=`This request has no earlier request to compare.`;return}n.innerHTML=t.diff.map(e=>`<div class="diff-line ${e.type}">${e.type===`add`?`+ `:e.type===`remove`?`- `:`  `}${v(e.text)}</div>`).join(``)}function Ce(e){let t=e.cacheSimulation,n=t.totalActualCostUsd!==void 0&&t.totalOptimizedCostUsd!==void 0?t.totalActualCostUsd-t.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Cache simulation <span class="count">${t.provider} · ${v(e.model.displayName)} · ${we(e)}</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="cache">
          <thead><tr><th>request</th><th>read</th><th>write 5m</th><th>write 1h</th><th>uncached</th><th>cost</th></tr></thead>
          <tbody>
            ${t.actual.map((e,t)=>`<tr><td>req ${t+1}</td><td>${m(e.readTokens)}</td><td>${m(e.writeTokens5m)}</td><td>${m(e.writeTokens1h)}</td><td>${m(e.uncachedTokens)}</td><td>${h(e.costUsd)}</td></tr>`).join(``)}
          </tbody>
        </table>
      </div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat-tile"><div class="label">current simulated cost</div><div class="value">${h(t.totalActualCostUsd)}</div></div>
        <div class="stat-tile"><div class="label">optimized simulated cost</div><div class="value">${h(t.totalOptimizedCostUsd)}</div></div>
      </div>
      ${n!==void 0&&n>=5e-5?`<div class="savings-banner">Fixing these findings${t.provider===`anthropic`?`, plus an automatic breakpoint on every request's tail,`:``} would save ${h(n)} (${(n/t.totalActualCostUsd*100).toFixed(0)}%) on this sequence — ≈${te(n*1e3)} per 1,000 sessions shaped like this one.</div>`:``}
    </section>
  `}var q;function J(e){return q?.result!==e&&(q={result:e,groups:D.groupFindings(e.findings)}),q.groups}function we(e){let{model:t}=e;return t.source===`option`?`chosen above`:t.source===`request`?`from the requests`:t.unrecognized?`"${v(t.unrecognized)}" isn't in the pricing table`:`default, no model in the requests`}var Y=12;function Te(e){let t=J(e);if(t.length===0)return`<section class="panel"><h2>Findings</h2><p class="empty-state">No supported cache or duplicate-content issues detected in the parsed requests. This does not verify live cache hits.</p></section>`;let n=e.findings.length>t.length?` from ${e.findings.length} findings`:``;return`
    <section class="panel">
      <h2>Findings <span class="count">${t.length} issue${t.length===1?``:`s`}${n}</span></h2>
      <div class="finding-list">
        ${t.map((e,t)=>{let n=D.describeRequestIndices(e.requestIndices),r=e.requestIndices.length>1?`<div class="foccur">${e.requestIndices.slice(0,Y).map(e=>`<button type="button" class="occ ${e===O.selectedRequest?`active`:``}" data-group="${t}" data-req="${e}">req ${e+1}</button>`).join(``)}${e.requestIndices.length>Y?`<span class="occ-more">+${e.requestIndices.length-Y} more</span>`:``}</div>`:``;return`<div class="finding ${e.severity}">
              <button type="button" class="fhead" data-group="${t}" data-req="${e.requestIndices[0]}"><span class="fsev">${e.severity}</span> ${v(e.title)} <span class="freq">(${n}${e.requestIndices.length>1?`, ${e.requestIndices.length}×`:``})</span></button>
              <div class="fdetail">${v(e.detail)}</div>
              ${r}
            </div>`}).join(``)}
      </div>
    </section>
  `}function Ee(e){let t=J(e);b(`[data-group]`).forEach(n=>{n.addEventListener(`click`,()=>{let r=t[Number(n.dataset.group)],i=Number(n.dataset.req);if(!r)return;let a=r.findings.find(e=>e.requestIndex===i)??r.findings[0];a.requestIndex!==O.selectedRequest&&(W(a.requestIndex),document.querySelector(`[data-group="${n.dataset.group}"][data-req="${i}"].${n.classList.contains(`occ`)?`occ`:`fhead`}`)?.focus({preventScroll:!0}));let o=a.segmentIds[a.segmentIds.length-1];if(o){let t=e.reports[a.requestIndex]?.segments.find(e=>e.id===o);t&&X(t)}})})}function De(e){return`
    <section class="panel">
      <h2>Duplicate content <span class="count">${e.duplicates.length} group${e.duplicates.length===1?``:`s`}</span></h2>
      <div class="dup-list">
        ${e.duplicates.map(e=>`<div class="dup-row"><span>${e.members.length}× "${v(_(e.members[0].label,50))}" <span style="color:var(--text-faint)">(similarity ${(e.similarity*100).toFixed(0)}%)</span></span><span class="waste">≈${m(e.estimatedWastedTokens)} wasted tok</span></div>`).join(``)}
      </div>
    </section>
  `}function Oe(e){if(e.parse.format!==`anthropic`)return``;let t=O.calibration,n=t?`<p class="calibrate-result" role="status">Using your measured count of <strong>${m(t.exactTokens)}</strong> input tokens for request ${t.requestIndex+1} on ${v(t.model)}. The original estimate was ≈${m(t.estimatedTokens)}. Every Claude estimate is scaled ×${t.scale.toFixed(3)}. Other requests and individual segments remain estimates. <button class="btn link" id="calibrate-reset" type="button">undo calibration</button></p>`:``;return`
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional · local only</span></h2>
      <p class="panel-note" id="calibrate-help">
        Enter the whole-request <code>input_tokens</code> count you measured with <code>count_tokens</code>
        for request ${O.selectedRequest+1} on ${v(e.model.displayName)}. This rescales the session's estimates;
        it does not make each segment exact. Use the same request and model. No API key or request is sent from this page.
      </p>
      <form class="calibrate-row" id="calibrate-form" novalidate>
        <label for="calibrate-count">Measured input tokens</label>
        <input type="number" id="calibrate-count" min="1" max="9007199254740991" step="1" inputmode="numeric" placeholder="e.g. 18420" aria-describedby="calibrate-help calibrate-status" />
        <button class="btn primary" id="calibrate-btn" type="submit">apply to request ${O.selectedRequest+1}</button>
        <span class="calibrate-status" id="calibrate-status" role="alert"></span>
      </form>
      ${n}
    </section>
  `}function ke(e){document.getElementById(`calibrate-form`)?.addEventListener(`submit`,t=>{if(t.preventDefault(),N)return;let n=y(`#calibrate-count`);try{D.calibrationScale(n.valueAsNumber,1),L(M,O,{requestIndex:O.selectedRequest,model:e.model.id,exactTokens:n.valueAsNumber})}catch(e){y(`#calibrate-status`).textContent=e.message,n.setAttribute(`aria-invalid`,`true`),n.focus()}}),document.getElementById(`calibrate-reset`)?.addEventListener(`click`,()=>{M!==void 0&&L(M,{...O,calibration:void 0})})}function X(e){y(`#drawer-title`).textContent=e.label;let t=e.charLength>S,n=t?e.text:typeof e.raw==`string`?e.raw:JSON.stringify(e.raw,null,2);y(`#drawer-body`).innerHTML=`
    <dl>
      <dt>category</dt><dd>${f[e.category]}</dd>
      <dt>path</dt><dd>${v(e.path)}</dd>
      <dt>chars</dt><dd>${m(e.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${m(e.claudeTokensEstimate)}${O.calibration?` <span class="muted">(scaled ×${O.calibration.scale.toFixed(3)})</span>`:``}</dd>
      <dt>OpenAI tokens</dt><dd>${m(e.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${e.cacheControl?`ephemeral, ${e.cacheControl.ttl}${e.cacheControl.automatic?` (automatic: the request's top-level cache_control lands on this block)`:``}`:`none`}</dd>
    </dl>
    ${t||n.length>2e4?`<p>Showing the first ${S.toLocaleString(`en-US`)} characters${t?` of the analyzed segment text`:` of raw content`}. Download the original raw JSON for complete evidence.</p>`:``}
    <button class="btn" id="download-segment" type="button">download original raw JSON</button>
    <pre>${v(n.slice(0,S))}</pre>
  `,y(`#download-segment`).addEventListener(`click`,()=>{let t=URL.createObjectURL(new Blob([JSON.stringify(e.raw,null,2)],{type:`application/json`})),n=document.createElement(`a`);n.href=t,n.download=`contextscope-segment.json`,n.click(),setTimeout(()=>URL.revokeObjectURL(t),1e3)});let r=y(`#drawer`);r.open||(Z=document.activeElement,r.showModal()),y(`#drawer-close`).focus()}var Z=null;function Q(){let e=y(`#drawer`);e.open&&e.close(),y(`#drawer-title`).textContent=`segment`,y(`#drawer-body`).replaceChildren(),Z instanceof HTMLElement&&Z.isConnected&&Z.focus(),Z=null}var $=document.getElementById(`app`);if(!$)throw Error(`contextscope: #app root element not found`);ce($);