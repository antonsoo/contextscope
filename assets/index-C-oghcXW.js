(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e,t){let n=e.filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.reduce((e,t)=>e+t.value,0);if(r<=0||n.length===0)return[];let i=t.w*t.h,a=n.map(e=>({...e,value:e.value/r*i})),o=[],s={...t},c=[],l=a;function u(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=0;for(let i of e){let e=i.value/(n/t),a=Math.max(e/t,t/e);a>r&&(r=a)}return r}function d(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=t.w>=t.h,i=r?t.h:t.w,a=i>0?n/i:0,s=0;for(let c of e){let e=n>0?c.value/n*i:0;r?o.push({rect:{x:t.x,y:t.y+s,w:a,h:e},item:c.item}):o.push({rect:{x:t.x+s,y:t.y,w:e,h:a},item:c.item}),s+=e}return r?{x:t.x+a,y:t.y,w:t.w-a,h:t.h}:{x:t.x,y:t.y+a,w:t.w,h:t.h-a}}for(;l.length>0;){let e=l[0],t=[...c,e];c.length===0||u(t,Math.min(s.w,s.h))<=u(c,Math.min(s.w,s.h))?(c=t,l=l.slice(1)):(s=d(c,s),c=[])}return c.length>0&&d(c,s),o}function t(e){let t=e[0]===255&&e[1]===254?`utf-16le`:e[0]===254&&e[1]===255?`utf-16be`:null;return new TextDecoder(t??`utf-8`).decode(e)}var n=50*2**20;function r(e){let t=e.maxBytes??n;if(!Number.isSafeInteger(t)||t<1||t>n)throw Error(`Invalid input byte limit.`);return t}function i(e){return Error(`Input exceeds ${(e/2**20).toLocaleString(`en-US`)} MB before or after decompression. Split the log into smaller sessions.`)}async function a(e,t={}){let n=r(t),{signal:a}=t,o=e.getReader(),s=()=>{o.cancel(a?.reason).catch(()=>{})};a?.addEventListener(`abort`,s,{once:!0});let c=[],l=0;try{for(a?.throwIfAborted();;){let{done:e,value:t}=await o.read();if(a?.throwIfAborted(),e)break;if(l+=t.byteLength,l>n)throw i(n);c.push(t)}let e=new Uint8Array(l),t=0;for(let n of c)e.set(n,t),t+=n.byteLength;return e}finally{a?.removeEventListener(`abort`,s),await o.cancel().catch(()=>{}),o.releaseLock()}}function o(e){return e[0]===31&&e[1]===139}async function s(e,n={}){n.signal?.throwIfAborted();let s=r(n);if(e.byteLength>s)throw i(s);return o(e)?t(await a(new Blob([e]).stream().pipeThrough(new DecompressionStream(`gzip`)),n)):t(e)}async function c(e,t={}){let n=r(t);if(e.size>n)throw i(n);return s(await a(e.stream(),t),t)}function l(e){if(e.length>n||new TextEncoder().encode(e).byteLength>n)throw i(n)}async function u(e,t){let n=`/contextscope/examples/${e}`,r=await fetch(n,{signal:t});if(!r.ok)throw Error(`Could not fetch example "${e}" (${r.status})`);if(!r.body)throw Error(`The example response has no body.`);return s(await a(r.body,{signal:t}),{signal:t})}var d=[{id:`cache-bust`,label:`Cache bust: timestamp in system prompt`,description:`Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.`,approxSizeMb:.48,load:e=>u(`anthropic-agent-cache-bust.jsonl.gz`,e)},{id:`cache-fixed`,label:`Cache fixed: same session, timestamp removed`,description:`The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.`,approxSizeMb:.48,load:e=>u(`anthropic-agent-cache-fixed.jsonl.gz`,e)},{id:`duplicate-tool-results`,label:`Duplicate content: same file read 3 times`,description:`Synthetic session where an agent re-reads an unchanged file three times in one conversation.`,approxSizeMb:.13,load:e=>u(`anthropic-duplicate-tool-results.jsonl`,e)},{id:`openai-tools-reordered`,label:`OpenAI: tools reordered mid-session`,description:`Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.`,approxSizeMb:.13,load:e=>u(`openai-agent-tools-reordered.jsonl`,e)}],f={system:`system`,tools:`tool definitions`,user:`user text`,assistant:`assistant text`,tool_call:`tool calls`,tool_result:`tool results`,image:`images`,thinking:`thinking`},p=[`system`,`tools`,`user`,`assistant`,`tool_call`,`tool_result`,`image`,`thinking`];function m(e){return`var(--cat-${e})`}function h(e){return e.toLocaleString(`en-US`)}function g(e){return e===void 0?`n/a`:`$${e.toFixed(e<1?4:2)}`}function _(e){return`$${e.toLocaleString(`en-US`,{maximumFractionDigits:0})}`}function v(e,t=1){return e===void 0?`n/a`:`${(e*100).toFixed(t)}%`}function y(e,t){let n=e.replace(/\s+/g,` `).trim();return n.length>t?`${n.slice(0,t)}…`:n}function b(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function x(e,t=document){let n=t.querySelector(e);if(!n)throw Error(`contextscope: missing required element "${e}"`);return n}function S(e,t=document){return Array.from(t.querySelectorAll(e))}var C=`modulepreload`,ee=function(e){return`/contextscope/`+e},w={},te=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=ee(t,n),t=s(t),t in w)return;w[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:C,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},T,E;function ne(){return T??=te(()=>import(`./core-DPCF0fdq.js`),[]).catch(e=>{throw T=void 0,e}),T}var D={format:`auto`,model:void 0,analysis:void 0,selectedRequest:0,selectedPair:0,calibration:void 0};function re(e){e.innerHTML=ie(),A(),ae(),j()}function ie(){return`
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
  `}function ae(){let e=x(`#dropzone`),t=x(`#file-input`),n=x(`#paste-area`),r=x(`#paste-run-row`);x(`#pick-file-btn`).addEventListener(`click`,()=>t.click()),t.addEventListener(`change`,()=>{let e=t.files?.[0];t.value=``,e&&O(e)}),x(`#paste-btn`).addEventListener(`click`,()=>{n.classList.add(`shown`),r.hidden=!1,n.focus()}),x(`#run-paste-btn`).addEventListener(`click`,()=>{n.value.trim().length>0?oe(n.value):k(`Paste a request (or JSONL of requests) first.`)}),e.addEventListener(`dragover`,t=>{t.preventDefault(),e.classList.add(`drag`)}),e.addEventListener(`dragleave`,()=>e.classList.remove(`drag`)),e.addEventListener(`drop`,t=>{t.preventDefault(),e.classList.remove(`drag`);let n=t.dataTransfer?.files?.[0];n&&O(n)});let i=x(`#example-chips`);i.innerHTML=d.map(e=>`<button class="example-chip" type="button" data-example="${e.id}" title="${b(e.description)}">${b(e.label)}${e.approxSizeMb>=.2?` <span class="chip-size">(${e.approxSizeMb.toFixed(2)} MB gz)</span>`:``}</button>`).join(``),i.addEventListener(`click`,e=>{let t=e.target.closest(`[data-example]`);if(!t||t.disabled)return;let n=d.find(e=>e.id===t.dataset.example);n&&L(e=>n.load(e),!0)})}function O(e){L(t=>c(e,{signal:t}),!0)}function oe(e){L(async()=>e,!0)}function k(e){let t=x(`#intake-error`);t.textContent=e??``,t.hidden=e===void 0}function A(){x(`#new-analysis-btn`).addEventListener(`click`,se),x(`#cancel-load-btn`).addEventListener(`click`,()=>{F(),k(`Import cancelled.`),x(D.analysis?`#new-analysis-btn`:`#pick-file-btn`).focus()});let e=x(`#format-select`);e.addEventListener(`change`,()=>{M!==void 0&&I(M,{format:e.value,model:void 0,calibration:void 0})});let t=x(`#model-select`);t.addEventListener(`change`,()=>{M!==void 0&&I(M,{...D,model:t.value,calibration:void 0})}),x(`#theme-toggle`).addEventListener(`click`,()=>{let e=document.documentElement.getAttribute(`data-theme`)===`light`?`dark`:`light`;document.documentElement.setAttribute(`data-theme`,e);try{localStorage.setItem(`contextscope-theme`,e)}catch{}}),x(`#drawer-close`).addEventListener(`click`,Q);let n=x(`#drawer`);n.addEventListener(`cancel`,e=>{e.preventDefault(),Q()}),n.addEventListener(`keydown`,e=>{if(e.key!==`Tab`)return;let t=S(`button, [tabindex="0"]`,n),r=t[0],i=t[t.length-1];e.shiftKey&&document.activeElement===r?(e.preventDefault(),i?.focus()):!e.shiftKey&&document.activeElement===i&&(e.preventDefault(),r?.focus())}),n.addEventListener(`click`,e=>{let t=n.getBoundingClientRect();e.target===n&&(e.clientX<t.left||e.clientX>t.right||e.clientY<t.top||e.clientY>t.bottom)&&Q()})}function j(){try{let e=localStorage.getItem(`contextscope-theme`);(e===`light`||e===`dark`)&&document.documentElement.setAttribute(`data-theme`,e)}catch{}}var M,N,P;function F(){N?.abort(),N=void 0,z(!1),R()}function se(){F(),Q(),P?.disconnect(),P=void 0,D.analysis=void 0,D.calibration=void 0,D.format=`auto`,D.model=void 0,D.selectedRequest=0,D.selectedPair=-1,M=void 0,K=void 0,E?.clearTokenCache(),x(`#content`).replaceChildren(),x(`#request-tabs`).replaceChildren();let e=x(`#paste-area`);e.value=``,e.classList.remove(`shown`),x(`#paste-run-row`).hidden=!0,k(void 0),x(`#dashboard`).classList.remove(`shown`),x(`#topbar-controls`).hidden=!0,x(`#intake`).style.display=`grid`,x(`#pick-file-btn`).focus()}function I(e,t){L(async()=>e,!1,{format:t.format,model:t.model,calibration:t.calibration})}function L(e,t,n={format:`auto`,model:void 0,calibration:void 0}){F();let r=new AbortController;N=r;let i=document.activeElement?.id,{signal:a}=r;k(void 0),z(!0),(async()=>{try{let r=await e(a);a.throwIfAborted(),l(r);let i=await ne();E=i,a.throwIfAborted(),await new Promise(e=>requestAnimationFrame(()=>e())),a.throwIfAborted();let o=i.analyze(r,{format:n.format===`auto`?void 0:n.format,model:n.model,claudeTokenScale:n.calibration?.scale});Q(),D.format=n.format,D.model=n.model,D.calibration=n.calibration,D.analysis=o,M=r,(t||D.selectedRequest>=o.reports.length)&&(D.selectedRequest=o.conversations.count>1?me(o):o.reports.length-1),D.selectedPair=o.prefixMatches.findIndex(e=>e.toIndex===D.selectedRequest),ce(i),t&&x(`.request-tab.active`).focus()}catch(e){a.aborted||(k(`Could not analyze this input: ${e.message}`),R())}finally{N===r&&(E?.clearTokenCache(),N=void 0,z(!1),!t&&i&&(document.getElementById(i)??(i===`calibrate-reset`?document.getElementById(`calibrate-count`):null))?.focus({preventScroll:!0}))}})()}function R(){x(`#format-select`).value=D.format,D.analysis&&(x(`#model-select`).value=D.analysis.model.id)}function z(e){x(`#load-status`).hidden=!e;for(let t of S(`#format-select, #model-select, #calibrate-count, #calibrate-btn, #calibrate-reset`))t.disabled=e;x(`#dropzone`).setAttribute(`aria-busy`,String(e))}function ce(e){let t=D.analysis;if(!t)return;E=e,x(`#intake`).style.display=`none`,x(`#dashboard`).classList.add(`shown`),x(`#topbar-controls`).hidden=!1;let n=x(`#format-select`);n.value=D.format;let r=x(`#model-select`);r.innerHTML=(t.parse.format===`anthropic`?e.ANTHROPIC_MODELS:e.OPENAI_MODELS).map(e=>`<option value="${e.id}">${b(e.displayName)}</option>`).join(``),r.value=t.model.id,V(),U()}var B=!1;function V(){let e=D.analysis,t=x(`#request-tabs`);t.innerHTML=e.reports.map((e,t)=>`<button class="request-tab ${t===D.selectedRequest?`active`:``}" data-req="${t}" id="request-tab-${t}" role="tab" aria-selected="${t===D.selectedRequest}" aria-controls="content" tabindex="${t===D.selectedRequest?0:-1}" type="button">req ${t+1}<span class="pct">${v(e.percentOfContextWindow,2)}</span></button>`).join(``),x(`#content`).setAttribute(`aria-labelledby`,`request-tab-${D.selectedRequest}`),t.querySelector(`.request-tab.active`)?.scrollIntoView({block:`nearest`,inline:`nearest`}),B||(B=!0,new ResizeObserver(()=>{let e=t.querySelector(`.request-tab.active`);if(!e)return;let n=t.getBoundingClientRect(),r=e.getBoundingClientRect();r.left<n.left?t.scrollLeft+=r.left-n.left:r.right>n.right&&(t.scrollLeft+=r.right-n.right)}).observe(t),t.addEventListener(`click`,e=>{let t=e.target.closest(`[data-req]`);t&&H(Number(t.dataset.req))}),t.addEventListener(`keydown`,e=>{if(![`ArrowLeft`,`ArrowRight`,`Home`,`End`].includes(e.key))return;let t=e.target.closest(`[data-req]`);if(!t)return;e.preventDefault();let n=D.analysis.reports.length,r=Number(t.dataset.req);H(e.key===`Home`?0:e.key===`End`?n-1:(r+(e.key===`ArrowRight`?1:-1)+n)%n)}))}function H(e){D.selectedRequest=e,D.selectedPair=D.analysis.prefixMatches.findIndex(t=>t.toIndex===e),V(),U(),x(`.request-tab.active`).focus({preventScroll:!0})}function U(){P?.disconnect(),P=void 0;let e=D.analysis,t=x(`#content`),n=e.reports[D.selectedRequest];t.innerHTML=`
    ${le(n,e)}
    ${W(e)}
    ${Y(e)}
    ${ue(n,e.parse.format)}
    ${fe(n)}
    ${e.parse.requests.length>1?he(e):``}
    ${ve(e)}
    ${e.duplicates.length>0?xe(e):``}
    ${Se(e)}
  `,de(n,e.parse.format),pe(n),e.parse.requests.length>1&&ge(e),be(e),Ce(e)}function W(e){let t=[];e.parse.envelope&&t.push(`Request bodies were read from each record's <code>${b(e.parse.envelope)}</code> field.`),e.model.unrecognized&&t.push(`The requests name <code>${b(e.model.unrecognized)}</code>, which isn't in the pricing table, so costs use ${b(e.model.displayName)}. Pick the right model above.`);let n=e.parse.warnings;for(let e of n.slice(0,5))t.push(b(e.message));return n.length>5&&t.push(`…and ${n.length-5} more parse warnings.`),t.length===0?``:`<section class="panel notes-panel" role="note">${t.map(e=>`<p>${e}</p>`).join(``)}</section>`}function le(e,t){let n=q(t),r=n.filter(e=>e.severity===`error`).length,i=n.filter(e=>e.severity===`warning`).length,a=t.cacheSimulation.totalActualCostUsd!==void 0&&t.cacheSimulation.totalOptimizedCostUsd!==void 0?t.cacheSimulation.totalActualCostUsd-t.cacheSimulation.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Request ${D.selectedRequest+1} of ${t.reports.length}${t.conversations.count>1?` <span class="count">conversation ${t.conversations.byRequest[D.selectedRequest]+1} of ${h(t.conversations.count)}</span>`:``}</h2>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens${t.claudeTokenScale===1?``:` (calibrated)`}</div><div class="value">${h(e.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${h(e.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${v(e.percentOfContextWindow,2)}</div></div>
        <div class="stat-tile"><div class="label">issues</div><div class="value">${r>0?r+` err`:i>0?i+` warn`:n.length}</div></div>
        ${a!==void 0&&a>=5e-5?`<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${g(a)}</div></div>`:``}
      </div>
    </section>
  `}function G(e,t){return t===`openai`?e.openaiTokens:e.claudeTokensEstimate}function ue(e,t){return`
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ${t===`openai`?`OpenAI tokens (exact)`:`≈ Claude tokens`}</span></h2>
      <div class="treemap" id="treemap" role="group" aria-label="Treemap of token usage by segment: each block opens its segment"></div>
      <div class="legend">
        ${p.filter(t=>e.byCategory.some(e=>e.category===t)).map(e=>`<span class="legend-item"><span class="legend-swatch" style="background:${m(e)}"></span>${f[e]}</span>`).join(``)}
      </div>
    </section>
  `}function de(t,n){let r=x(`#treemap`),i=n===`openai`?``:`≈`,a=t.segments.filter(e=>G(e,n)>0).map(e=>({value:G(e,n),item:e}));r.innerHTML=a.map(({item:e})=>`<button type="button" class="tm-block" data-segment="${b(e.id)}"></button>`).join(``);let o=new Map(S(`[data-segment]`,r).map(e=>[e.dataset.segment,e])),s=()=>{let t=r.clientWidth,s=r.clientHeight;if(!(t<=0||s<=0))for(let{rect:r,item:c}of e(a,{x:0,y:0,w:t,h:s})){let e=o.get(c.id),t=r.w<=46?0:r.h>=34?2:+(r.h>=20),a=`${i}${h(G(c,n))} tok`;e.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${m(c.category)};color:var(--cat-${c.category}-ink)`,e.title=`${c.label} — ${a}`,e.setAttribute(`aria-label`,`${c.label}, ${a}`),e.innerHTML=t===0?``:`<span class="tm-label"><span class="tm-name">${b(y(c.label,40))}</span>${t===2?`<span class="tm-tok">${a}</span>`:``}</span>`}};s(),P=new ResizeObserver(s),P.observe(r),r.addEventListener(`click`,e=>{let n=e.target.closest(`[data-segment]`);n&&X(t.segments.find(e=>e.id===n.dataset.segment))})}function fe(e){return`
    <section class="panel">
      <h2>Segments <span class="count">${e.segments.length} total — click a row to inspect</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="segments">
          <thead><tr><th>category</th><th>label</th><th>path</th><th>≈ Claude</th><th>OpenAI</th><th>cache</th></tr></thead>
          <tbody id="segments-tbody">
            ${e.segments.map(e=>`<tr data-segment="${b(e.id)}">
                  <td><span class="cat-chip" style="--dot:${m(e.category)}">${f[e.category]}</span></td>
                  <td><button class="segment-inspect" type="button" aria-label="Inspect ${b(e.label)}">${b(y(e.label,60))}</button></td>
                  <td>${b(e.path)}</td>
                  <td class="num">${h(e.claudeTokensEstimate)}</td>
                  <td class="num">${h(e.openaiTokens)}</td>
                  <td>${e.cacheControl?`<span class="cache-flag"${e.cacheControl.automatic?` title="automatic breakpoint: the request has a top-level cache_control"`:``}>● ${e.cacheControl.ttl}${e.cacheControl.automatic?` auto`:``}</span>`:``}</td>
                </tr>`).join(``)}
          </tbody>
        </table>
      </div>
    </section>
  `}function pe(e){x(`#segments-tbody`).addEventListener(`click`,t=>{let n=t.target.closest(`[data-segment]`);n&&X(e.segments.find(e=>e.id===n.dataset.segment))})}function me(e){let t=0,n=t=>e.parse.format===`openai`?t.totals.openaiTokens:t.totals.claudeTokensEstimate;return e.reports.forEach((r,i)=>{n(r)>=n(e.reports[t])&&(t=i)}),t}function he(e){let t=e.prefixMatches;return`
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">${e.conversations.count>1?`${h(e.conversations.count)} conversations in this file · each request against the request it continues`:`longest common prefix between each consecutive pair`}</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${t.map((t,n)=>{let r=e.parse.requests[t.toIndex].segments.length,i=r>0?t.matchedSegments/r:0;return`<button type="button" aria-pressed="${n===D.selectedPair}" class="prefix-row ${n===D.selectedPair?`active`:``}" data-pair="${n}">
              <span class="arrow">req ${t.fromIndex+1} → req ${t.toIndex+1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(i*100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${t.matchedSegments}/${r} segs · ${e.parse.format===`openai`?h(t.matchedOpenaiTokens):`≈${h(t.matchedClaudeTokensEstimate)}`} tok${t.relation===`new_conversation`?` · new conversation`:t.relation===`rewrites`?` · history rewritten`:``}</span>
            </button>`}).join(``)}
      </div>
      <div class="diff-view" id="diff-view" tabindex="0" role="group" aria-label="Difference from the request this one continues"></div>
    </section>
  `}function ge(e){let t=x(`#prefix-list`);_e(e),t.addEventListener(`click`,t=>{let n=t.target.closest(`[data-pair]`);if(!n)return;let r=Number(n.dataset.pair);H(e.prefixMatches[r].toIndex),document.querySelector(`[data-pair="${r}"]`)?.focus({preventScroll:!0})})}function _e(e){let t=e.prefixMatches[D.selectedPair],n=x(`#diff-view`);if(!t){n.textContent=`This request has no earlier request to compare.`;return}n.innerHTML=t.diff.map(e=>`<div class="diff-line ${e.type}">${e.type===`add`?`+ `:e.type===`remove`?`- `:`  `}${b(e.text)}</div>`).join(``)}function ve(e){let t=e.cacheSimulation,n=t.totalActualCostUsd!==void 0&&t.totalOptimizedCostUsd!==void 0?t.totalActualCostUsd-t.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Cache simulation <span class="count">${t.provider} · ${b(e.model.displayName)} · ${ye(e)}</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="cache">
          <thead><tr><th>request</th><th>read</th><th>write 5m</th><th>write 1h</th><th>uncached</th><th>cost</th></tr></thead>
          <tbody>
            ${t.actual.map((e,t)=>`<tr><td>req ${t+1}</td><td>${h(e.readTokens)}</td><td>${h(e.writeTokens5m)}</td><td>${h(e.writeTokens1h)}</td><td>${h(e.uncachedTokens)}</td><td>${g(e.costUsd)}</td></tr>`).join(``)}
          </tbody>
        </table>
      </div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat-tile"><div class="label">current simulated cost</div><div class="value">${g(t.totalActualCostUsd)}</div></div>
        <div class="stat-tile"><div class="label">optimized simulated cost</div><div class="value">${g(t.totalOptimizedCostUsd)}</div></div>
      </div>
      ${n!==void 0&&n>=5e-5?`<div class="savings-banner">Fixing these findings${t.provider===`anthropic`?`, plus an automatic breakpoint on every request's tail,`:``} would save ${g(n)} (${(n/t.totalActualCostUsd*100).toFixed(0)}%) on this sequence — ≈${_(n*1e3)} per 1,000 sessions shaped like this one.</div>`:``}
    </section>
  `}var K;function q(e){return K?.result!==e&&(K={result:e,groups:E.groupFindings(e.findings)}),K.groups}function ye(e){let{model:t}=e;return t.source===`option`?`chosen above`:t.source===`request`?`from the requests`:t.unrecognized?`"${b(t.unrecognized)}" isn't in the pricing table`:`default, no model in the requests`}var J=12;function Y(e){let t=q(e);if(t.length===0)return`<section class="panel"><h2>Findings</h2><p class="empty-state">No supported cache or duplicate-content issues detected in the parsed requests. This does not verify live cache hits.</p></section>`;let n=e.findings.length>t.length?` from ${e.findings.length} findings`:``;return`
    <section class="panel">
      <h2>Findings <span class="count">${t.length} issue${t.length===1?``:`s`}${n}</span></h2>
      <div class="finding-list">
        ${t.map((e,t)=>{let n=E.describeRequestIndices(e.requestIndices),r=e.requestIndices.length>1?`<div class="foccur">${e.requestIndices.slice(0,J).map(e=>`<button type="button" class="occ ${e===D.selectedRequest?`active`:``}" data-group="${t}" data-req="${e}">req ${e+1}</button>`).join(``)}${e.requestIndices.length>J?`<span class="occ-more">+${e.requestIndices.length-J} more</span>`:``}</div>`:``;return`<div class="finding ${e.severity}">
              <button type="button" class="fhead" data-group="${t}" data-req="${e.requestIndices[0]}"><span class="fsev">${e.severity}</span> ${b(e.title)} <span class="freq">(${n}${e.requestIndices.length>1?`, ${e.requestIndices.length}×`:``})</span></button>
              <div class="fdetail">${b(e.detail)}</div>
              ${r}
            </div>`}).join(``)}
      </div>
    </section>
  `}function be(e){let t=q(e);S(`[data-group]`).forEach(n=>{n.addEventListener(`click`,()=>{let r=t[Number(n.dataset.group)],i=Number(n.dataset.req);if(!r)return;let a=r.findings.find(e=>e.requestIndex===i)??r.findings[0];a.requestIndex!==D.selectedRequest&&(H(a.requestIndex),document.querySelector(`[data-group="${n.dataset.group}"][data-req="${i}"].${n.classList.contains(`occ`)?`occ`:`fhead`}`)?.focus({preventScroll:!0}));let o=a.segmentIds[a.segmentIds.length-1];if(o){let t=e.reports[a.requestIndex]?.segments.find(e=>e.id===o);t&&X(t)}})})}function xe(e){return`
    <section class="panel">
      <h2>Duplicate content <span class="count">${e.duplicates.length} group${e.duplicates.length===1?``:`s`}</span></h2>
      <div class="dup-list">
        ${e.duplicates.map(e=>`<div class="dup-row"><span>${e.members.length}× "${b(y(e.members[0].label,50))}" <span style="color:var(--text-faint)">(similarity ${(e.similarity*100).toFixed(0)}%)</span></span><span class="waste">≈${h(e.estimatedWastedTokens)} wasted tok</span></div>`).join(``)}
      </div>
    </section>
  `}function Se(e){if(e.parse.format!==`anthropic`)return``;let t=D.calibration,n=t?`<p class="calibrate-result" role="status">Using your measured count of <strong>${h(t.exactTokens)}</strong> input tokens for request ${t.requestIndex+1} on ${b(t.model)}. The original estimate was ≈${h(t.estimatedTokens)}. Every Claude estimate is scaled ×${t.scale.toFixed(3)}. Other requests and individual segments remain estimates. <button class="btn link" id="calibrate-reset" type="button">undo calibration</button></p>`:``;return`
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional · local only</span></h2>
      <p class="panel-note" id="calibrate-help">
        Enter the whole-request <code>input_tokens</code> count you measured with <code>count_tokens</code>
        for request ${D.selectedRequest+1} on ${b(e.model.displayName)}. This rescales the session's estimates;
        it does not make each segment exact. Use the same request and model. No API key or request is sent from this page.
      </p>
      <form class="calibrate-row" id="calibrate-form" novalidate>
        <label for="calibrate-count">Measured input tokens</label>
        <input type="number" id="calibrate-count" min="1" max="9007199254740991" step="1" inputmode="numeric" placeholder="e.g. 18420" aria-describedby="calibrate-help calibrate-status" />
        <button class="btn primary" id="calibrate-btn" type="submit">apply to request ${D.selectedRequest+1}</button>
        <span class="calibrate-status" id="calibrate-status" role="alert"></span>
      </form>
      ${n}
    </section>
  `}function Ce(e){document.getElementById(`calibrate-form`)?.addEventListener(`submit`,t=>{if(t.preventDefault(),N)return;let n=x(`#calibrate-count`);try{let t=E.parseInput(M,e.parse.format),r=E.calibrateRequest(t.requests[D.selectedRequest],e.model.id,n.valueAsNumber);I(M,{...D,calibration:r})}catch(e){x(`#calibrate-status`).textContent=e.message,n.setAttribute(`aria-invalid`,`true`),n.focus()}finally{E?.clearTokenCache()}}),document.getElementById(`calibrate-reset`)?.addEventListener(`click`,()=>{M!==void 0&&I(M,{...D,calibration:void 0})})}function X(e){x(`#drawer-title`).textContent=e.label;let t=typeof e.raw==`string`?e.raw:JSON.stringify(e.raw,null,2);x(`#drawer-body`).innerHTML=`
    <dl>
      <dt>category</dt><dd>${f[e.category]}</dd>
      <dt>path</dt><dd>${b(e.path)}</dd>
      <dt>chars</dt><dd>${h(e.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${h(e.claudeTokensEstimate)}${D.calibration?` <span class="muted">(scaled ×${D.calibration.scale.toFixed(3)})</span>`:``}</dd>
      <dt>OpenAI tokens</dt><dd>${h(e.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${e.cacheControl?`ephemeral, ${e.cacheControl.ttl}${e.cacheControl.automatic?` (automatic: the request's top-level cache_control lands on this block)`:``}`:`none`}</dd>
    </dl>
    <pre>${b(t)}</pre>
  `;let n=x(`#drawer`);n.open||(Z=document.activeElement,n.showModal()),x(`#drawer-close`).focus()}var Z=null;function Q(){let e=x(`#drawer`);e.open&&e.close(),x(`#drawer-title`).textContent=`segment`,x(`#drawer-body`).replaceChildren(),Z instanceof HTMLElement&&Z.isConnected&&Z.focus(),Z=null}var $=document.getElementById(`app`);if(!$)throw Error(`contextscope: #app root element not found`);re($);