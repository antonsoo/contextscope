(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function e(e,t){let n=e.filter(e=>e.value>0).sort((e,t)=>t.value-e.value),r=n.reduce((e,t)=>e+t.value,0);if(r<=0||n.length===0)return[];let i=t.w*t.h,a=n.map(e=>({...e,value:e.value/r*i})),o=[],s={...t},c=[],l=a;function u(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=0;for(let i of e){let e=i.value/(n/t),a=Math.max(e/t,t/e);a>r&&(r=a)}return r}function d(e,t){let n=e.reduce((e,t)=>e+t.value,0),r=t.w>=t.h,i=r?t.h:t.w,a=i>0?n/i:0,s=0;for(let c of e){let e=n>0?c.value/n*i:0;r?o.push({rect:{x:t.x,y:t.y+s,w:a,h:e},item:c.item}):o.push({rect:{x:t.x+s,y:t.y,w:e,h:a},item:c.item}),s+=e}return r?{x:t.x+a,y:t.y,w:t.w-a,h:t.h}:{x:t.x,y:t.y+a,w:t.w,h:t.h-a}}for(;l.length>0;){let e=l[0],t=[...c,e];c.length===0||u(t,Math.min(s.w,s.h))<=u(c,Math.min(s.w,s.h))?(c=t,l=l.slice(1)):(s=d(c,s),c=[])}return c.length>0&&d(c,s),o}var t=31,n=139;function r(e){return e.length>=2&&e[0]===t&&e[1]===n}async function i(e){if(!r(e))return new TextDecoder().decode(e);let t=new Blob([e]).stream().pipeThrough(new DecompressionStream(`gzip`));return new Response(t).text()}async function a(e){return i(new Uint8Array(await e.arrayBuffer()))}var o=`modulepreload`,s=function(e){return`/contextscope/`+e},c={},l=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function l(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function u(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=l(t.map(t=>{if(t=s(t,n),t=u(t),t in c)return;c[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:o,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})};async function u(e){return(await e()).default}async function d(e){let t=`/contextscope/examples/${e}`,n=await fetch(t);if(!n.ok)throw Error(`Could not fetch example "${e}" (${n.status})`);return i(new Uint8Array(await n.arrayBuffer()))}var f=[{id:`cache-bust`,label:`Cache bust: timestamp in system prompt`,description:`Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.`,format:`anthropic`,model:`claude-sonnet-5`,approxSizeMb:.48,load:()=>d(`anthropic-agent-cache-bust.jsonl.gz`)},{id:`cache-fixed`,label:`Cache fixed: same session, timestamp removed`,description:`The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.`,format:`anthropic`,model:`claude-sonnet-5`,approxSizeMb:.48,load:()=>d(`anthropic-agent-cache-fixed.jsonl.gz`)},{id:`duplicate-tool-results`,label:`Duplicate content: same file read 3 times`,description:`Synthetic session where an agent re-reads an unchanged file three times in one conversation.`,format:`anthropic`,model:`claude-sonnet-5`,approxSizeMb:.13,load:()=>u(()=>l(()=>import(`./anthropic-duplicate-tool-results-BBuMw1DT.js`),[]))},{id:`openai-tools-reordered`,label:`OpenAI: tools reordered mid-session`,description:`Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.`,format:`openai`,model:`gpt-6-sol`,approxSizeMb:.13,load:()=>u(()=>l(()=>import(`./openai-agent-tools-reordered-nOt9OItE.js`),[]))}],p={system:`system`,tools:`tool definitions`,user:`user text`,assistant:`assistant text`,tool_call:`tool calls`,tool_result:`tool results`,image:`images`,thinking:`thinking`},m=[`system`,`tools`,`user`,`assistant`,`tool_call`,`tool_result`,`image`,`thinking`];function h(e){return`var(--cat-${e})`}function g(e){return e.toLocaleString(`en-US`)}function _(e){return e===void 0?`n/a`:`$${e.toFixed(e<1?4:2)}`}function ee(e){return`$${e.toLocaleString(`en-US`,{maximumFractionDigits:0})}`}function v(e,t=1){return e===void 0?`n/a`:`${(e*100).toFixed(t)}%`}function y(e,t){let n=e.replace(/\s+/g,` `).trim();return n.length>t?`${n.slice(0,t)}…`:n}function b(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function x(e,t=document){let n=t.querySelector(e);if(!n)throw Error(`contextscope: missing required element "${e}"`);return n}function S(e,t=document){return Array.from(t.querySelectorAll(e))}var C;function w(){return C??=l(()=>import(`./core-DAcdHg5h.js`),[]),C}var T={format:`auto`,model:void 0,analysis:void 0,selectedRequest:0,selectedPair:0,calibration:new Map};function te(e){e.innerHTML=E(),O(),D(),k()}function E(){return`
    <header class="topbar">
      <div class="wordmark"><span class="addr">0x00&nbsp;</span>contextscope<span class="dot">.</span></div>
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
        <h1>drop a request, or paste one</h1>
        <p class="lead">A single Anthropic Messages or OpenAI Chat Completions request, a JSON array, or JSONL - one API request per line, the shape an agent loop actually sends. A gzipped <code>.jsonl.gz</code> works too, decompressed right here.</p>
        <div class="intake-actions">
          <button class="btn primary" id="pick-file-btn" type="button">choose file…</button>
          <button class="btn" id="paste-btn" type="button">paste JSON…</button>
          <input type="file" id="file-input" accept=".json,.jsonl,.gz,application/json,application/gzip" class="visually-hidden" />
        </div>
        <textarea id="paste-area" placeholder="paste a request, a JSON array of requests, or JSONL here" spellcheck="false"></textarea>
        <div class="intake-actions" id="paste-run-row" hidden>
          <button class="btn primary" id="run-paste-btn" type="button">analyze</button>
        </div>
        <p class="hint">Nothing leaves your browser. Parsing and token counting run locally.</p>
        <div class="examples-row">
          <p>or load a built-in example (synthetic data, labelled below)</p>
          <div class="example-chip-row" id="example-chips"></div>
        </div>
      </div>
    </main>

    <div id="dashboard" class="dashboard">
      <nav class="request-tabs" id="request-tabs"></nav>
      <div class="content" id="content"></div>
      <footer class="app-footer">
        contextscope is local-first: analysis runs in your browser, nothing is uploaded. Claude token counts are estimates (≈) - see
        <a href="https://github.com/antonsoo/contextscope#accuracy-and-limitations" target="_blank" rel="noopener">accuracy and limitations</a>.
      </footer>
    </div>

    <div class="drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="drawer" id="drawer" aria-hidden="true">
      <div class="drawer-head">
        <h3 id="drawer-title">segment</h3>
        <button class="icon-btn" id="drawer-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" id="drawer-body"></div>
    </aside>
  `}function D(){let e=x(`#dropzone`),t=x(`#file-input`),n=x(`#paste-area`),r=x(`#paste-run-row`);x(`#pick-file-btn`).addEventListener(`click`,()=>t.click()),t.addEventListener(`change`,()=>{let e=t.files?.[0];e&&a(e).then(e=>j(e))}),x(`#paste-btn`).addEventListener(`click`,()=>{n.classList.add(`shown`),r.hidden=!1,n.focus()}),x(`#run-paste-btn`).addEventListener(`click`,()=>{n.value.trim().length>0&&j(n.value)}),e.addEventListener(`dragover`,t=>{t.preventDefault(),e.classList.add(`drag`)}),e.addEventListener(`dragleave`,()=>e.classList.remove(`drag`)),e.addEventListener(`drop`,t=>{t.preventDefault(),e.classList.remove(`drag`);let n=t.dataTransfer?.files?.[0];n&&a(n).then(e=>j(e))});let i=x(`#example-chips`);i.innerHTML=f.map(e=>`<button class="example-chip" type="button" data-example="${e.id}" title="${b(e.description)}">${b(e.label)}${e.approxSizeMb>=.2?` <span class="chip-size">(${e.approxSizeMb.toFixed(2)} MB gz)</span>`:``}</button>`).join(``),i.addEventListener(`click`,e=>{let t=e.target.closest(`[data-example]`);if(!t)return;let n=f.find(e=>e.id===t.dataset.example);n&&(T.format=n.format,T.model=n.model,t.textContent=`loading…`,n.load().then(e=>j(e)))})}function O(){x(`#new-analysis-btn`).addEventListener(`click`,()=>{T.analysis=void 0,x(`#dashboard`).classList.remove(`shown`),x(`#topbar-controls`).hidden=!0,x(`#intake`).style.display=`grid`});let e=x(`#format-select`);e.addEventListener(`change`,()=>{T.format=e.value,A!==void 0&&j(A)});let t=x(`#model-select`);t.addEventListener(`change`,()=>{T.model=t.value,A!==void 0&&j(A)}),x(`#theme-toggle`).addEventListener(`click`,()=>{let e=document.documentElement.getAttribute(`data-theme`)===`light`?`dark`:`light`;document.documentElement.setAttribute(`data-theme`,e);try{localStorage.setItem(`contextscope-theme`,e)}catch{}}),x(`#drawer-close`).addEventListener(`click`,Q),x(`#drawer-backdrop`).addEventListener(`click`,Q),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&Q()})}function k(){try{let e=localStorage.getItem(`contextscope-theme`);(e===`light`||e===`dark`)&&document.documentElement.setAttribute(`data-theme`,e)}catch{}}var A;function j(e){ne(e)}async function ne(e){A=e,T.calibration=new Map,M(!0);try{let t=await w(),n=t.analyze(e,{format:T.format===`auto`?void 0:T.format,model:T.model});T.analysis=n,T.selectedRequest=n.reports.length-1,T.selectedPair=Math.max(0,n.prefixMatches.length-1),T.model===void 0&&(T.model=n.cacheSimulation.model??N(n.parse.format)),P(t)}catch(e){alert(`Could not analyze this input: ${e.message}`)}finally{M(!1)}}function M(e){let t=[x(`#run-paste-btn`),x(`#pick-file-btn`)];for(let n of t)n.disabled=e;document.getElementById(`dropzone`)?.setAttribute(`aria-busy`,String(e))}function N(e){return e===`anthropic`?`claude-sonnet-5`:`gpt-6-sol`}function P(e){let t=T.analysis;if(!t)return;x(`#intake`).style.display=`none`,x(`#dashboard`).classList.add(`shown`),x(`#topbar-controls`).hidden=!1;let n=x(`#format-select`);n.value=T.format;let r=x(`#model-select`),i=t.parse.format===`anthropic`?e.ANTHROPIC_MODELS:e.OPENAI_MODELS;r.innerHTML=i.map(e=>`<option value="${e.id}">${b(e.displayName)}</option>`).join(``),r.value=T.model??i[0].id,I(),L()}var F=!1;function I(){let e=T.analysis,t=x(`#request-tabs`);t.innerHTML=e.reports.map((e,t)=>`<button class="request-tab ${t===T.selectedRequest?`active`:``}" data-req="${t}" type="button">req ${t+1}<span class="pct">${v(e.percentOfContextWindow,2)}</span></button>`).join(``),t.querySelector(`.request-tab.active`)?.scrollIntoView({block:`nearest`,inline:`nearest`}),F||(F=!0,t.addEventListener(`click`,e=>{let t=e.target.closest(`[data-req]`);t&&(T.selectedRequest=Number(t.dataset.req),I(),L())}))}function L(){let e=T.analysis,t=x(`#content`),n=e.reports[T.selectedRequest];t.innerHTML=`
    ${R(n,e)}
    ${z(n)}
    ${V(n)}
    ${e.parse.requests.length>1?U(e):``}
    ${K(e)}
    ${q(e)}
    ${e.duplicates.length>0?Y(e):``}
    ${X(e)}
  `,B(n),H(n),e.parse.requests.length>1&&W(e),J(e),re(e)}function R(e,t){let n=t.findings.filter(e=>e.severity===`error`).length,r=t.findings.filter(e=>e.severity===`warning`).length,i=t.cacheSimulation.totalActualCostUsd!==void 0&&t.cacheSimulation.totalOptimizedCostUsd!==void 0?t.cacheSimulation.totalActualCostUsd-t.cacheSimulation.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Request ${T.selectedRequest+1} of ${t.reports.length}</h2>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens</div><div class="value">${g(e.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${g(e.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${v(e.percentOfContextWindow,2)}</div></div>
        <div class="stat-tile"><div class="label">findings</div><div class="value">${n>0?n+` err`:r>0?r+` warn`:`0`}</div></div>
        ${i!==void 0&&i>1e-9?`<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${_(i)}</div></div>`:``}
      </div>
    </section>
  `}function z(e){return`
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ≈ Claude tokens</span></h2>
      <div class="treemap" id="treemap" role="img" aria-label="Treemap of token usage by segment"></div>
      <div class="legend">
        ${m.filter(t=>e.byCategory.some(e=>e.category===t)).map(e=>`<span class="legend-item"><span class="legend-swatch" style="background:${h(e)}"></span>${p[e]}</span>`).join(``)}
      </div>
    </section>
  `}function B(t){let n=x(`#treemap`),r=n.getBoundingClientRect(),i=r.width||800,a=r.height||340;n.innerHTML=e(t.segments.filter(e=>e.claudeTokensEstimate>0).map(e=>({value:e.claudeTokensEstimate,item:e})),{x:0,y:0,w:i,h:a}).map(({rect:e,item:t})=>{let n=e.w>46&&e.h>24;return`<div class="tm-block" tabindex="0" role="button" data-segment="${b(t.id)}" style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;background:${h(t.category)}" title="${b(t.label)} — ≈${t.claudeTokensEstimate} tokens">${n?`<div class="tm-label">${b(y(t.label,40))}<span class="tm-tok">≈${g(t.claudeTokensEstimate)} tok</span></div>`:``}</div>`}).join(``),n.addEventListener(`click`,e=>{let n=e.target.closest(`[data-segment]`);n&&Z(t.segments.find(e=>e.id===n.dataset.segment))}),n.addEventListener(`keydown`,e=>{if(e.key!==`Enter`&&e.key!==` `)return;let n=e.target.closest(`[data-segment]`);n&&(e.preventDefault(),Z(t.segments.find(e=>e.id===n.dataset.segment)))})}function V(e){return`
    <section class="panel">
      <h2>Segments <span class="count">${e.segments.length} total — click a row to inspect</span></h2>
      <div class="table-scroll">
        <table class="segments">
          <thead><tr><th>category</th><th>label</th><th>path</th><th>≈ Claude</th><th>OpenAI</th><th>cache</th></tr></thead>
          <tbody id="segments-tbody">
            ${e.segments.map(e=>`<tr data-segment="${b(e.id)}">
                  <td><span class="cat-chip" style="--dot:${h(e.category)}">${p[e.category]}</span></td>
                  <td>${b(y(e.label,60))}</td>
                  <td>${b(e.path)}</td>
                  <td class="num">${g(e.claudeTokensEstimate)}</td>
                  <td class="num">${g(e.openaiTokens)}</td>
                  <td>${e.cacheControl?`<span class="cache-flag">● ${e.cacheControl.ttl}</span>`:``}</td>
                </tr>`).join(``)}
          </tbody>
        </table>
      </div>
    </section>
  `}function H(e){x(`#segments-tbody`).addEventListener(`click`,t=>{let n=t.target.closest(`[data-segment]`);n&&Z(e.segments.find(e=>e.id===n.dataset.segment))})}function U(e){return`
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">longest common prefix between each consecutive pair</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${e.prefixMatches.map((t,n)=>{let r=e.parse.requests[t.toIndex].segments.length,i=r>0?t.matchedSegments/r:0;return`<div class="prefix-row ${n===T.selectedPair?`active`:``}" data-pair="${n}">
              <span class="arrow">req ${t.fromIndex+1} → req ${t.toIndex+1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(i*100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${t.matchedSegments}/${r} segs · ≈${g(t.matchedClaudeTokensEstimate)} tok</span>
            </div>`}).join(``)}
      </div>
      <div class="diff-view" id="diff-view"></div>
    </section>
  `}function W(e){let t=x(`#prefix-list`);G(e),t.addEventListener(`click`,n=>{let r=n.target.closest(`[data-pair]`);r&&(T.selectedPair=Number(r.dataset.pair),S(`.prefix-row`,t).forEach(e=>e.classList.remove(`active`)),r.classList.add(`active`),G(e))})}function G(e){let t=e.prefixMatches[T.selectedPair],n=x(`#diff-view`);if(!t){n.innerHTML=``;return}n.innerHTML=t.diff.map(e=>`<div class="diff-line ${e.type}">${e.type===`add`?`+ `:e.type===`remove`?`- `:`  `}${b(e.text)}</div>`).join(``)}function K(e){let t=e.cacheSimulation,n=t.totalActualCostUsd!==void 0&&t.totalOptimizedCostUsd!==void 0?t.totalActualCostUsd-t.totalOptimizedCostUsd:void 0;return`
    <section class="panel">
      <h2>Cache simulation <span class="count">${t.provider}${T.model?` · ${T.model}`:``}</span></h2>
      <div class="table-scroll">
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
      ${n!==void 0&&n>1e-9?`<div class="savings-banner">Fixing the findings below${t.provider===`anthropic`?`, plus an automatic breakpoint on every request's tail,`:``} would save ${_(n)} (${(n/t.totalActualCostUsd*100).toFixed(0)}%) on this sequence — ≈${ee(n*1e3)} per 1,000 sessions shaped like this one.</div>`:``}
    </section>
  `}function q(e){return e.findings.length===0?`<section class="panel"><h2>Findings</h2><p class="empty-state">✓ No findings — this sequence caches cleanly.</p></section>`:`
    <section class="panel">
      <h2>Findings <span class="count">${e.findings.length}</span></h2>
      <div class="finding-list">
        ${e.findings.map((e,t)=>`<div class="finding ${e.severity}" data-finding="${t}">
              <div class="fhead"><span class="fsev">${e.severity}</span> ${b(e.title)} <span class="freq">(request ${e.requestIndex+1})</span></div>
              <div class="fdetail">${b(e.detail)}</div>
            </div>`).join(``)}
      </div>
    </section>
  `}function J(e){S(`.finding`).forEach(t=>{t.addEventListener(`click`,()=>{let n=Number(t.dataset.finding),r=e.findings[n];if(!r)return;r.requestIndex!==T.selectedRequest&&(T.selectedRequest=r.requestIndex,I(),L());let i=r.segmentIds[0];if(i){let t=e.reports[r.requestIndex]?.segments.find(e=>e.id===i);t&&Z(t)}})})}function Y(e){return`
    <section class="panel">
      <h2>Duplicate content <span class="count">${e.duplicates.length} group${e.duplicates.length===1?``:`s`}</span></h2>
      <div class="dup-list">
        ${e.duplicates.map(e=>`<div class="dup-row"><span>${e.members.length}× "${b(y(e.members[0].label,50))}" <span style="color:var(--text-faint)">(similarity ${(e.similarity*100).toFixed(0)}%)</span></span><span class="waste">≈${g(e.estimatedWastedTokens)} wasted tok</span></div>`).join(``)}
      </div>
    </section>
  `}function X(e){return e.parse.format===`anthropic`?`
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional</span></h2>
      <p style="color:var(--text-muted); font-size:12px; margin:0 0 10px">
        Paste an Anthropic API key to replace the ≈ estimates for the selected request with exact counts from
        <code>count_tokens</code>. The key stays in this tab's memory only - never stored, never sent anywhere but api.anthropic.com.
      </p>
      <div class="calibrate-row">
        <input type="password" id="calibrate-key" placeholder="sk-ant-…" autocomplete="off" />
        <button class="btn primary" id="calibrate-btn" type="button">calibrate this request</button>
        <span class="calibrate-status" id="calibrate-status"></span>
      </div>
    </section>
  `:``}function re(e){let t=document.getElementById(`calibrate-btn`);t&&t.addEventListener(`click`,()=>{ie(e)})}async function ie(e){let t=x(`#calibrate-key`),n=x(`#calibrate-status`),r=t.value.trim();if(!r){n.textContent=`enter an API key first`;return}let i=e.reports[T.selectedRequest],a=T.model??`claude-sonnet-5`;n.textContent=`calibrating ${i.segments.length} segments…`;try{let e=await(await w()).calibrateSegments(r,a,i.segments.map(e=>({segmentKey:e.id,text:e.text})));for(let t of e)T.calibration.set(t.segmentKey,t.tokens);n.textContent=`done — ${e.length} segments calibrated`,L()}catch(e){n.textContent=`calibration failed: ${e.message}`}}function Z(e){x(`#drawer-title`).textContent=e.label;let t=T.calibration.get(e.id),n=typeof e.raw==`string`?e.raw:JSON.stringify(e.raw,null,2);x(`#drawer-body`).innerHTML=`
    <dl>
      <dt>category</dt><dd>${p[e.category]}</dd>
      <dt>path</dt><dd>${b(e.path)}</dd>
      <dt>chars</dt><dd>${g(e.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${g(e.claudeTokensEstimate)}${t===void 0?``:` <span style="color:var(--status-good)">→ ${g(t)} (calibrated)</span>`}</dd>
      <dt>OpenAI tokens</dt><dd>${g(e.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${e.cacheControl?`ephemeral, ${e.cacheControl.ttl}`:`none`}</dd>
    </dl>
    <pre>${b(n)}</pre>
  `,x(`#drawer`).classList.add(`open`),x(`#drawer`).setAttribute(`aria-hidden`,`false`),x(`#drawer-backdrop`).classList.add(`open`)}function Q(){x(`#drawer`).classList.remove(`open`),x(`#drawer`).setAttribute(`aria-hidden`,`true`),x(`#drawer-backdrop`).classList.remove(`open`)}var $=document.getElementById(`app`);if(!$)throw Error(`contextscope: #app root element not found`);te($);