(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e,t){let n=e.filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.reduce((e,t)=>e+t.value,0);if(r<=0||n.length===0)return[];let i=t.w*t.h,a=n.map(e=>({...e,value:e.value/r*i})),o=[],s={...t},c=[],l=a;function u(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=0;for(let i of e){let e=i.value/(n/t),a=Math.max(e/t,t/e);a>r&&(r=a)}return r}function d(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=t.w>=t.h,i=r?t.h:t.w,a=i>0?n/i:0,s=0;for(let c of e){let e=n>0?c.value/n*i:0;r?o.push({rect:{x:t.x,y:t.y+s,w:a,h:e},item:c.item}):o.push({rect:{x:t.x+s,y:t.y,w:e,h:a},item:c.item}),s+=e}return r?{x:t.x+a,y:t.y,w:t.w-a,h:t.h}:{x:t.x,y:t.y+a,w:t.w,h:t.h-a}}for(;l.length>0;){let e=l[0],t=[...c,e];c.length===0||u(t,Math.min(s.w,s.h))<=u(c,Math.min(s.w,s.h))?(c=t,l=l.slice(1)):(s=d(c,s),c=[])}return c.length>0&&d(c,s),o}function t(e){let t=e[0]===255&&e[1]===254?`utf-16le`:e[0]===254&&e[1]===255?`utf-16be`:null;return new TextDecoder(t??`utf-8`).decode(e)}var n=31,r=139;function i(e){return e.length>=2&&e[0]===n&&e[1]===r}async function a(e){if(!i(e))return t(e);let n=new Blob([e]).stream().pipeThrough(new DecompressionStream(`gzip`));return t(new Uint8Array(await new Response(n).arrayBuffer()))}async function o(e){return a(new Uint8Array(await e.arrayBuffer()))}var s=`modulepreload`,c=function(e){return`/contextscope/`+e},l={},u=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function u(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=c(t,n),t=u(t),t in l)return;l[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:s,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})};async function d(e){return(await e()).default}async function f(e){let t=`/contextscope/examples/${e}`,n=await fetch(t);if(!n.ok)throw Error(`Could not fetch example "${e}" (${n.status})`);return a(new Uint8Array(await n.arrayBuffer()))}var p=[{id:`cache-bust`,label:`Cache bust: timestamp in system prompt`,description:`Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.`,approxSizeMb:.48,load:()=>f(`anthropic-agent-cache-bust.jsonl.gz`)},{id:`cache-fixed`,label:`Cache fixed: same session, timestamp removed`,description:`The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.`,approxSizeMb:.48,load:()=>f(`anthropic-agent-cache-fixed.jsonl.gz`)},{id:`duplicate-tool-results`,label:`Duplicate content: same file read 3 times`,description:`Synthetic session where an agent re-reads an unchanged file three times in one conversation.`,approxSizeMb:.13,load:()=>d(()=>u(()=>import(`./anthropic-duplicate-tool-results-BBuMw1DT.js`),[]))},{id:`openai-tools-reordered`,label:`OpenAI: tools reordered mid-session`,description:`Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.`,approxSizeMb:.13,load:()=>d(()=>u(()=>import(`./openai-agent-tools-reordered-nOt9OItE.js`),[]))}],m={system:`system`,tools:`tool definitions`,user:`user text`,assistant:`assistant text`,tool_call:`tool calls`,tool_result:`tool results`,image:`images`,thinking:`thinking`},ee=[`system`,`tools`,`user`,`assistant`,`tool_call`,`tool_result`,`image`,`thinking`];function h(e){return`var(--cat-${e})`}function g(e){return e.toLocaleString(`en-US`)}function _(e){return e===void 0?`n/a`:`$${e.toFixed(e<1?4:2)}`}function te(e){return`$${e.toLocaleString(`en-US`,{maximumFractionDigits:0})}`}function v(e,t=1){return e===void 0?`n/a`:`${(e*100).toFixed(t)}%`}function y(e,t){let n=e.replace(/\s+/g,` `).trim();return n.length>t?`${n.slice(0,t)}…`:n}function b(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function x(e,t=document){let n=t.querySelector(e);if(!n)throw Error(`contextscope: missing required element "${e}"`);return n}function S(e,t=document){return Array.from(t.querySelectorAll(e))}var C,w;function T(){return C??=u(()=>import(`./core-DINpO5Od.js`),[]),C}var E={format:`auto`,model:void 0,analysis:void 0,selectedRequest:0,selectedPair:0,calibration:void 0};function ne(e){e.innerHTML=re(),A(),ie(),j()}function re(){return`
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

    <main id="intake" class="intake">
      <div class="dropzone" id="dropzone">
        <h2>drop a request, or paste one</h2>
        <p class="lead">A single Anthropic Messages or OpenAI (Chat Completions or Responses) request, a JSON array, or JSONL - one API request per line, the shape an agent loop actually sends. Batch-API files and gateway logs are unwrapped, and a gzipped <code>.jsonl.gz</code> works too, decompressed right here.</p>
        <div class="intake-actions">
          <button class="btn primary" id="pick-file-btn" type="button">choose file…</button>
          <button class="btn" id="paste-btn" type="button">paste JSON…</button>
          <input type="file" id="file-input" accept=".json,.jsonl,.gz,application/json,application/gzip" class="visually-hidden" aria-label="Request file" tabindex="-1" />
        </div>
        <textarea id="paste-area" placeholder="paste a request, a JSON array of requests, or JSONL here" spellcheck="false"></textarea>
        <div class="intake-actions" id="paste-run-row" hidden>
          <button class="btn primary" id="run-paste-btn" type="button">analyze</button>
        </div>
        <p class="intake-error" id="intake-error" role="alert" hidden></p>
        <p class="hint">Nothing leaves your browser. Parsing and token counting run locally.</p>
        <div class="examples-row">
          <p>or load a built-in example (synthetic data, labelled below)</p>
          <div class="example-chip-row" id="example-chips"></div>
        </div>
      </div>
    </main>

    <div id="dashboard" class="dashboard">
      <nav class="request-tabs" id="request-tabs"></nav>
      <main class="content" id="content"></main>
      <footer class="app-footer">
        contextscope is local-first: analysis runs in your browser, nothing is uploaded. Claude token counts are estimates (≈) - see
        <a href="https://github.com/antonsoo/contextscope#accuracy-and-limitations" target="_blank" rel="noopener">accuracy and limitations</a>.
      </footer>
    </div>

    <div class="drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="drawer" id="drawer" aria-hidden="true" inert>
      <div class="drawer-head">
        <h3 id="drawer-title">segment</h3>
        <button class="icon-btn" id="drawer-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" id="drawer-body"></div>
    </aside>
  `}function ie(){let e=x(`#dropzone`),t=x(`#file-input`),n=x(`#paste-area`),r=x(`#paste-run-row`);x(`#pick-file-btn`).addEventListener(`click`,()=>t.click()),t.addEventListener(`change`,()=>{let e=t.files?.[0];t.value=``,e&&D(e)}),x(`#paste-btn`).addEventListener(`click`,()=>{n.classList.add(`shown`),r.hidden=!1,n.focus()}),x(`#run-paste-btn`).addEventListener(`click`,()=>{n.value.trim().length>0?O(n.value):k(`Paste a request (or JSONL of requests) first.`)}),e.addEventListener(`dragover`,t=>{t.preventDefault(),e.classList.add(`drag`)}),e.addEventListener(`dragleave`,()=>e.classList.remove(`drag`)),e.addEventListener(`drop`,t=>{t.preventDefault(),e.classList.remove(`drag`);let n=t.dataTransfer?.files?.[0];n&&D(n)});let i=x(`#example-chips`);i.innerHTML=p.map(e=>`<button class="example-chip" type="button" data-example="${e.id}" title="${b(e.description)}">${b(e.label)}${e.approxSizeMb>=.2?` <span class="chip-size">(${e.approxSizeMb.toFixed(2)} MB gz)</span>`:``}</button>`).join(``),i.addEventListener(`click`,e=>{let t=e.target.closest(`[data-example]`);if(!t||t.disabled)return;let n=p.find(e=>e.id===t.dataset.example);if(!n)return;let r=t.innerHTML;t.disabled=!0,t.textContent=`loading…`,n.load().then(e=>O(e)).catch(e=>k(`Could not load the example: ${e.message}`)).finally(()=>{t.disabled=!1,t.innerHTML=r})})}async function D(e){try{O(await o(e))}catch(t){k(`Could not read ${e.name}: ${t.message}`)}}function O(e){E.format=`auto`,E.model=void 0,E.calibration=void 0,N(e,!0)}function k(e){let t=x(`#intake-error`);t.textContent=e??``,t.hidden=e===void 0}function A(){x(`#new-analysis-btn`).addEventListener(`click`,()=>{E.analysis=void 0,E.calibration=void 0,k(void 0),x(`#dashboard`).classList.remove(`shown`),x(`#topbar-controls`).hidden=!0,x(`#intake`).style.display=`grid`});let e=x(`#format-select`);e.addEventListener(`change`,()=>{E.format=e.value,E.model=void 0,E.calibration=void 0,M!==void 0&&N(M,!1)});let t=x(`#model-select`);t.addEventListener(`change`,()=>{E.model=t.value,E.calibration=void 0,M!==void 0&&N(M,!1)}),x(`#theme-toggle`).addEventListener(`click`,()=>{let e=document.documentElement.getAttribute(`data-theme`)===`light`?`dark`:`light`;document.documentElement.setAttribute(`data-theme`,e);try{localStorage.setItem(`contextscope-theme`,e)}catch{}}),x(`#drawer-close`).addEventListener(`click`,Q),x(`#drawer-backdrop`).addEventListener(`click`,Q),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&Q()})}function j(){try{let e=localStorage.getItem(`contextscope-theme`);(e===`light`||e===`dark`)&&document.documentElement.setAttribute(`data-theme`,e)}catch{}}var M;function N(e,t){ae(e,t)}async function ae(e,t){M=e,P(!0);try{let n=await T(),r=n.analyze(e,{format:E.format===`auto`?void 0:E.format,model:E.model,claudeTokenScale:E.calibration?.scale});if(E.analysis=r,k(void 0),(t||E.selectedRequest>=r.reports.length)&&(E.selectedRequest=r.conversations.count>1?W(r):r.reports.length-1),t||E.selectedPair>=r.prefixMatches.length){let e=r.prefixMatches.findIndex(e=>e.toIndex===E.selectedRequest);E.selectedPair=e>=0?e:Math.max(0,r.prefixMatches.length-1)}F(n)}catch(e){let t=`Could not analyze this input: ${e.message}`;E.analysis?window.alert(t):k(t)}finally{P(!1)}}function P(e){let t=[x(`#run-paste-btn`),x(`#pick-file-btn`)];for(let n of t)n.disabled=e;document.getElementById(`dropzone`)?.setAttribute(`aria-busy`,String(e))}function F(e){let t=E.analysis;if(!t)return;w=e,x(`#intake`).style.display=`none`,x(`#dashboard`).classList.add(`shown`),x(`#topbar-controls`).hidden=!1;let n=x(`#format-select`);n.value=E.format;let r=x(`#model-select`);r.innerHTML=(t.parse.format===`anthropic`?e.ANTHROPIC_MODELS:e.OPENAI_MODELS).map(e=>`<option value="${e.id}">${b(e.displayName)}</option>`).join(``),r.value=t.model.id,L(),R()}var I=!1;function L(){let e=E.analysis,t=x(`#request-tabs`);t.innerHTML=e.reports.map((e,t)=>`<button class="request-tab ${t===E.selectedRequest?`active`:``}" data-req="${t}" type="button">req ${t+1}<span class="pct">${v(e.percentOfContextWindow,2)}</span></button>`).join(``),t.querySelector(`.request-tab.active`)?.scrollIntoView({block:`nearest`,inline:`nearest`}),I||(I=!0,t.addEventListener(`click`,e=>{let t=e.target.closest(`[data-req]`);t&&(E.selectedRequest=Number(t.dataset.req),L(),R())}))}function R(){let e=E.analysis,t=x(`#content`),n=e.reports[E.selectedRequest];t.innerHTML=`
    ${se(n,e)}
    ${oe(e)}
    ${de(e)}
    ${B(n,e.parse.format)}
    ${H(n)}
    ${e.parse.requests.length>1?G(e):``}
    ${le(e)}
    ${e.duplicates.length>0?pe(e):``}
    ${me(e)}
  `,V(n,e.parse.format),U(n),e.parse.requests.length>1&&ce(e),fe(e),ge(e)}function oe(e){let t=[];e.parse.envelope&&t.push(`Request bodies were read from each record's <code>${b(e.parse.envelope)}</code> field.`),e.model.unrecognized&&t.push(`The requests name <code>${b(e.model.unrecognized)}</code>, which isn't in the pricing table, so costs use ${b(e.model.displayName)}. Pick the right model above.`);let n=e.parse.warnings;for(let e of n.slice(0,5))t.push(b(e.message));return n.length>5&&t.push(`…and ${n.length-5} more parse warnings.`),t.length===0?``:`<section class="panel notes-panel" role="note">${t.map(e=>`<p>${e}</p>`).join(``)}</section>`}function se(e,t){let n=J(t),r=n.filter(e=>e.severity===`error`).length,i=n.filter(e=>e.severity===`warning`).length,a=t.cacheSimulation.totalActualCostUsd!==void 0&&t.cacheSimulation.totalOptimizedCostUsd!==void 0?t.cacheSimulation.totalActualCostUsd-t.cacheSimulation.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Request ${E.selectedRequest+1} of ${t.reports.length}${t.conversations.count>1?` <span class="count">conversation ${t.conversations.byRequest[E.selectedRequest]+1} of ${g(t.conversations.count)}</span>`:``}</h2>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens${t.claudeTokenScale===1?``:` (calibrated)`}</div><div class="value">${g(e.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${g(e.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${v(e.percentOfContextWindow,2)}</div></div>
        <div class="stat-tile"><div class="label">issues</div><div class="value">${r>0?r+` err`:i>0?i+` warn`:n.length}</div></div>
        ${a!==void 0&&a>=5e-5?`<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${_(a)}</div></div>`:``}
      </div>
    </section>
  `}function z(e,t){return t===`openai`?e.openaiTokens:e.claudeTokensEstimate}function B(e,t){return`
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ${t===`openai`?`OpenAI tokens (exact)`:`≈ Claude tokens`}</span></h2>
      <div class="treemap" id="treemap" role="group" aria-label="Treemap of token usage by segment: each block opens its segment"></div>
      <div class="legend">
        ${ee.filter(t=>e.byCategory.some(e=>e.category===t)).map(e=>`<span class="legend-item"><span class="legend-swatch" style="background:${h(e)}"></span>${m[e]}</span>`).join(``)}
      </div>
    </section>
  `}function V(t,n){let r=x(`#treemap`),i=r.getBoundingClientRect(),a=i.width||800,o=i.height||340,s=n===`openai`?``:`≈`;r.innerHTML=e(t.segments.filter(e=>z(e,n)>0).map(e=>({value:z(e,n),item:e})),{x:0,y:0,w:a,h:o}).map(({rect:e,item:t})=>{let r=e.w<=46?0:e.h>=34?2:+(e.h>=20),i=`${s}${g(z(t,n))} tok`,a=r===0?``:`<div class="tm-label"><span class="tm-name">${b(y(t.label,40))}</span>${r===2?`<span class="tm-tok">${i}</span>`:``}</div>`;return`<div class="tm-block" tabindex="0" role="button" data-segment="${b(t.id)}" style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;background:${h(t.category)};color:var(--cat-${t.category}-ink)" title="${b(t.label)} — ${i}" aria-label="${b(t.label)}, ${i}">${a}</div>`}).join(``),r.addEventListener(`click`,e=>{let n=e.target.closest(`[data-segment]`);n&&X(t.segments.find(e=>e.id===n.dataset.segment))}),r.addEventListener(`keydown`,e=>{if(e.key!==`Enter`&&e.key!==` `)return;let n=e.target.closest(`[data-segment]`);n&&(e.preventDefault(),X(t.segments.find(e=>e.id===n.dataset.segment)))})}function H(e){return`
    <section class="panel">
      <h2>Segments <span class="count">${e.segments.length} total — click a row to inspect</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="segments">
          <thead><tr><th>category</th><th>label</th><th>path</th><th>≈ Claude</th><th>OpenAI</th><th>cache</th></tr></thead>
          <tbody id="segments-tbody">
            ${e.segments.map(e=>`<tr data-segment="${b(e.id)}">
                  <td><span class="cat-chip" style="--dot:${h(e.category)}">${m[e.category]}</span></td>
                  <td>${b(y(e.label,60))}</td>
                  <td>${b(e.path)}</td>
                  <td class="num">${g(e.claudeTokensEstimate)}</td>
                  <td class="num">${g(e.openaiTokens)}</td>
                  <td>${e.cacheControl?`<span class="cache-flag"${e.cacheControl.automatic?` title="automatic breakpoint: the request has a top-level cache_control"`:``}>● ${e.cacheControl.ttl}${e.cacheControl.automatic?` auto`:``}</span>`:``}</td>
                </tr>`).join(``)}
          </tbody>
        </table>
      </div>
    </section>
  `}function U(e){x(`#segments-tbody`).addEventListener(`click`,t=>{let n=t.target.closest(`[data-segment]`);n&&X(e.segments.find(e=>e.id===n.dataset.segment))})}function W(e){let t=0;return e.reports.forEach((n,r)=>{n.totals.claudeTokensEstimate>=e.reports[t].totals.claudeTokensEstimate&&(t=r)}),t}function G(e){let t=e.prefixMatches;return`
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">${e.conversations.count>1?`${g(e.conversations.count)} conversations in this file · each request against the request it continues`:`longest common prefix between each consecutive pair`}</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${t.map((t,n)=>{let r=e.parse.requests[t.toIndex].segments.length,i=r>0?t.matchedSegments/r:0;return`<div class="prefix-row ${n===E.selectedPair?`active`:``}" data-pair="${n}">
              <span class="arrow">req ${t.fromIndex+1} → req ${t.toIndex+1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(i*100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${t.matchedSegments}/${r} segs · ≈${g(t.matchedClaudeTokensEstimate)} tok${t.relation===`new_conversation`?` · new conversation`:t.relation===`rewrites`?` · history rewritten`:``}</span>
            </div>`}).join(``)}
      </div>
      <div class="diff-view" id="diff-view" tabindex="0" role="group" aria-label="Difference from the request this one continues"></div>
    </section>
  `}function ce(e){let t=x(`#prefix-list`);K(e),t.addEventListener(`click`,n=>{let r=n.target.closest(`[data-pair]`);r&&(E.selectedPair=Number(r.dataset.pair),S(`.prefix-row`,t).forEach(e=>e.classList.remove(`active`)),r.classList.add(`active`),K(e))})}function K(e){let t=e.prefixMatches[E.selectedPair],n=x(`#diff-view`);if(!t){n.innerHTML=``;return}n.innerHTML=t.diff.map(e=>`<div class="diff-line ${e.type}">${e.type===`add`?`+ `:e.type===`remove`?`- `:`  `}${b(e.text)}</div>`).join(``)}function le(e){let t=e.cacheSimulation,n=t.totalActualCostUsd!==void 0&&t.totalOptimizedCostUsd!==void 0?t.totalActualCostUsd-t.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Cache simulation <span class="count">${t.provider} · ${b(e.model.displayName)} · ${ue(e)}</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="cache">
          <thead><tr><th>request</th><th>read</th><th>write 5m</th><th>write 1h</th><th>uncached</th><th>cost</th></tr></thead>
          <tbody>
            ${t.actual.map((e,t)=>`<tr><td>req ${t+1}</td><td>${g(e.readTokens)}</td><td>${g(e.writeTokens5m)}</td><td>${g(e.writeTokens1h)}</td><td>${g(e.uncachedTokens)}</td><td>${_(e.costUsd)}</td></tr>`).join(``)}
          </tbody>
        </table>
      </div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat-tile"><div class="label">total actual cost</div><div class="value">${_(t.totalActualCostUsd)}</div></div>
        <div class="stat-tile"><div class="label">total optimized cost</div><div class="value">${_(t.totalOptimizedCostUsd)}</div></div>
      </div>
      ${n!==void 0&&n>=5e-5?`<div class="savings-banner">Fixing the findings below${t.provider===`anthropic`?`, plus an automatic breakpoint on every request's tail,`:``} would save ${_(n)} (${(n/t.totalActualCostUsd*100).toFixed(0)}%) on this sequence — ≈${te(n*1e3)} per 1,000 sessions shaped like this one.</div>`:``}
    </section>
  `}var q;function J(e){return q?.result!==e&&(q={result:e,groups:w.groupFindings(e.findings)}),q.groups}function ue(e){let{model:t}=e;return t.source===`option`?`chosen above`:t.source===`request`?`from the requests`:t.unrecognized?`"${b(t.unrecognized)}" isn't in the pricing table`:`default, no model in the requests`}var Y=12;function de(e){let t=J(e);if(t.length===0)return`<section class="panel"><h2>Findings</h2><p class="empty-state">✓ No findings — this sequence caches cleanly.</p></section>`;let n=e.findings.length>t.length?` from ${e.findings.length} findings`:``;return`
    <section class="panel">
      <h2>Findings <span class="count">${t.length} issue${t.length===1?``:`s`}${n}</span></h2>
      <div class="finding-list">
        ${t.map((e,t)=>{let n=w.describeRequestIndices(e.requestIndices),r=e.requestIndices.length>1?`<div class="foccur">${e.requestIndices.slice(0,Y).map(e=>`<button type="button" class="occ ${e===E.selectedRequest?`active`:``}" data-group="${t}" data-req="${e}">req ${e+1}</button>`).join(``)}${e.requestIndices.length>Y?`<span class="occ-more">+${e.requestIndices.length-Y} more</span>`:``}</div>`:``;return`<div class="finding ${e.severity}">
              <button type="button" class="fhead" data-group="${t}" data-req="${e.requestIndices[0]}"><span class="fsev">${e.severity}</span> ${b(e.title)} <span class="freq">(${n}${e.requestIndices.length>1?`, ${e.requestIndices.length}×`:``})</span></button>
              <div class="fdetail">${b(e.detail)}</div>
              ${r}
            </div>`}).join(``)}
      </div>
    </section>
  `}function fe(e){let t=J(e);S(`[data-group]`).forEach(n=>{n.addEventListener(`click`,()=>{let r=t[Number(n.dataset.group)],i=Number(n.dataset.req);if(!r)return;let a=r.findings.find(e=>e.requestIndex===i)??r.findings[0];a.requestIndex!==E.selectedRequest&&(E.selectedRequest=a.requestIndex,L(),R());let o=a.segmentIds[a.segmentIds.length-1];if(o){let t=e.reports[a.requestIndex]?.segments.find(e=>e.id===o);t&&X(t)}})})}function pe(e){return`
    <section class="panel">
      <h2>Duplicate content <span class="count">${e.duplicates.length} group${e.duplicates.length===1?``:`s`}</span></h2>
      <div class="dup-list">
        ${e.duplicates.map(e=>`<div class="dup-row"><span>${e.members.length}× "${b(y(e.members[0].label,50))}" <span style="color:var(--text-faint)">(similarity ${(e.similarity*100).toFixed(0)}%)</span></span><span class="waste">≈${g(e.estimatedWastedTokens)} wasted tok</span></div>`).join(``)}
      </div>
    </section>
  `}function me(e){if(e.parse.format!==`anthropic`)return``;let t=E.calibration,n=t?`<p class="calibrate-result">Request ${t.requestIndex+1} is <strong>${g(t.exactTokens)}</strong> tokens by <code>count_tokens</code> on ${b(t.model)}; the heuristic said ≈${g(t.estimatedTokens)} (${he((t.estimatedTokens-t.exactTokens)/t.exactTokens)}). Every ≈ figure on this page is now scaled ×${t.scale.toFixed(3)}. <button class="btn link" id="calibrate-reset" type="button">undo</button></p>`:``;return`
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional</span></h2>
      <p class="panel-note">
        Claude's tokenizer isn't public, so ≈ counts are a heuristic. Paste an Anthropic API key to count request
        ${E.selectedRequest+1} exactly with the free <code>count_tokens</code> endpoint and rescale every estimate to match.
        One call; the key stays in this tab's memory and is sent only to api.anthropic.com.
      </p>
      <div class="calibrate-row">
        <input type="password" id="calibrate-key" placeholder="sk-ant-…" autocomplete="off" aria-label="Anthropic API key" />
        <button class="btn primary" id="calibrate-btn" type="button">count request ${E.selectedRequest+1}</button>
        <span class="calibrate-status" id="calibrate-status" role="status"></span>
      </div>
      ${n}
    </section>
  `}function he(e){return`${e>=0?`+`:`−`}${Math.abs(e*100).toFixed(1)}%`}function ge(e){document.getElementById(`calibrate-btn`)?.addEventListener(`click`,()=>{_e(e)}),document.getElementById(`calibrate-reset`)?.addEventListener(`click`,()=>{E.calibration=void 0,M!==void 0&&N(M,!1)})}async function _e(e){let t=x(`#calibrate-key`),n=x(`#calibrate-status`),r=t.value.trim();if(!r){n.textContent=`enter an API key first`;return}let i=x(`#calibrate-btn`);i.disabled=!0,n.textContent=`counting…`;try{let n=await T(),i=n.parseInput(M,e.parse.format).requests[E.selectedRequest];E.calibration=await n.countRequestTokens(r,e.model.id,i),t.value=``,N(M,!1)}catch(e){n.textContent=`calibration failed: ${e.message}`}finally{i.disabled=!1}}function X(e){x(`#drawer-title`).textContent=e.label;let t=typeof e.raw==`string`?e.raw:JSON.stringify(e.raw,null,2);x(`#drawer-body`).innerHTML=`
    <dl>
      <dt>category</dt><dd>${m[e.category]}</dd>
      <dt>path</dt><dd>${b(e.path)}</dd>
      <dt>chars</dt><dd>${g(e.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${g(e.claudeTokensEstimate)}${E.calibration?` <span class="muted">(scaled ×${E.calibration.scale.toFixed(3)})</span>`:``}</dd>
      <dt>OpenAI tokens</dt><dd>${g(e.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${e.cacheControl?`ephemeral, ${e.cacheControl.ttl}${e.cacheControl.automatic?` (automatic: the request's top-level cache_control lands on this block)`:``}`:`none`}</dd>
    </dl>
    <pre>${b(t)}</pre>
  `,x(`#drawer`).classList.contains(`open`)||(Z=document.activeElement),x(`#drawer`).classList.add(`open`),x(`#drawer`).setAttribute(`aria-hidden`,`false`),x(`#drawer`).removeAttribute(`inert`),x(`#drawer-backdrop`).classList.add(`open`),x(`#drawer-close`).focus()}var Z=null;function Q(){x(`#drawer`).classList.contains(`open`)&&(x(`#drawer`).classList.remove(`open`),x(`#drawer`).setAttribute(`aria-hidden`,`true`),x(`#drawer`).setAttribute(`inert`,``),x(`#drawer-backdrop`).classList.remove(`open`),Z instanceof HTMLElement&&Z.isConnected&&Z.focus(),Z=null)}var $=document.getElementById(`app`);if(!$)throw Error(`contextscope: #app root element not found`);ne($);