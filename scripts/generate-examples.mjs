#!/usr/bin/env node
// Regenerates examples/*.jsonl. Run with: node scripts/generate-examples.mjs
//
// The flagship pair (anthropic-agent-cache-bust / -fixed) models a realistic-scale coding-agent
// session - long system prompt, a real-sized tool surface, growing tool-result content - so the
// treemap and the dollar figures in the README aren't toy-sized. Everything here is synthetic
// (labelled as such wherever it's shown) but internally consistent: the same fictional
// "ledger-core" repository and BillingClient rate-limiting task throughout.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSystemPrompt } from "./lib/system-prompt.mjs";
import { TOOLS, toOpenAiTools } from "./lib/tools.mjs";
import * as repo from "./lib/repo-content.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "examples");
const MODEL = "claude-sonnet-5";

const STATIC_SYSTEM_PROMPT = buildSystemPrompt();

function systemBlock(text) {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

// A big, real-looking OpenAPI fragment the agent reads mid-session while checking whether a
// neighboring service already has rate-limiting logic worth copying - this is what pushes a
// realistic session past 60K tokens: one large reference file, not many small ones.
// Three services share one combined reference doc in this fictional monorepo (a real enough
// pattern - a platform team publishing one merged OpenAPI file across its owned services), which
// is why the agent would plausibly read the whole thing while checking a cross-service pattern.
const OPENAPI_MODULES = [
  { title: "Billing Service API", prefix: "" },
  { title: "Invoicing Service API", prefix: "invoicing-" },
  { title: "Reconciliation Service API", prefix: "reconciliation-" },
];

function buildOpenApiExcerpt() {
  const methods = ["get", "post", "put", "patch", "delete"];
  const resources = [
    "invoices", "charges", "refunds", "customers", "payment-methods", "credit-notes",
    "disputes", "payouts", "webhooks", "tax-calculations", "subscriptions", "usage-records",
    "statement-lines", "reconciliation-runs", "ledger-entries", "adjustments",
    "invoice-line-items", "customer-balances", "payment-intents", "checkout-sessions",
    "dunning-schedules", "credit-memos", "tax-exemptions", "billing-contacts",
  ];
  const lines = [];
  for (const mod of OPENAPI_MODULES) {
  lines.push(
    "openapi: 3.0.3",
    "info:",
    `  title: ${mod.title}`,
    "  version: 4.2.0",
    "  description: >",
    "    Internal REST API for invoice, charge, and payment-method management.",
    "    Consumed by services/billing/src/client.py and the admin dashboard.",
    "paths:",
  );
  for (const resource of resources) {
    lines.push(`  /${mod.prefix}${resource}:`);
    for (const method of methods.slice(0, resource === "invoices" || resource === "charges" ? 5 : 3)) {
      lines.push(`    ${method}:`);
      lines.push(`      operationId: ${method}${resource.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`);
      lines.push(`      summary: ${method === "get" ? "List" : method === "post" ? "Create" : method === "put" ? "Update" : "Cancel"} ${resource.replace(/-/g, " ")}`);
      lines.push(`      tags: [${resource}]`);
      lines.push(`      parameters:`);
      lines.push(`        - name: limit`);
      lines.push(`          in: query`);
      lines.push(`          schema: { type: integer, default: 50, maximum: 200 }`);
      lines.push(`        - name: cursor`);
      lines.push(`          in: query`);
      lines.push(`          schema: { type: string }`);
      lines.push(`      responses:`);
      lines.push(`        "200":`);
      lines.push(`          description: Successful response`);
      lines.push(`          content:`);
      lines.push(`            application/json:`);
      lines.push(`              schema:`);
      lines.push(`                type: object`);
      lines.push(`                properties:`);
      lines.push(`                  ${resource.replace(/-/g, "_")}:`);
      lines.push(`                    type: array`);
      lines.push(`                    items: { $ref: "#/components/schemas/${toPascal(resource)}" }`);
      lines.push(`                  next_cursor: { type: string, nullable: true }`);
      lines.push(`        "429":`);
      lines.push(`          description: Rate limit exceeded`);
      lines.push(`          content:`);
      lines.push(`            application/json:`);
      lines.push(`              schema: { $ref: "#/components/schemas/RateLimitError" }`);
    }
  }
  lines.push("components:", "  schemas:");
  for (const resource of resources) {
    lines.push(`    ${toPascal(resource)}:`);
    lines.push(`      type: object`);
    lines.push(`      properties:`);
    lines.push(`        id: { type: string }`);
    lines.push(`        customer_id: { type: string }`);
    lines.push(`        amount_cents: { type: integer }`);
    lines.push(`        currency: { type: string, minLength: 3, maxLength: 3 }`);
    lines.push(`        status: { type: string }`);
    lines.push(`        created_at: { type: string, format: date-time }`);
    lines.push(`        idempotency_key: { type: string, nullable: true }`);
  }
  lines.push(
    "    RateLimitError:",
    "      type: object",
    "      properties:",
    "        error: { type: string }",
    "        retry_after_seconds: { type: number }",
  );
  lines.push("---");
  }
  lines.pop(); // drop the trailing "---" document separator
  return lines.join("\n");
}
function toPascal(s) {
  return s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
}
const OPENAPI_EXCERPT = buildOpenApiExcerpt();

// A larger, monorepo-wide grep result - the kind of noisy-but-realistic output that pads a real
// session's token count the way a handful of small tool calls never do.
function buildGrepResults() {
  const services = ["billing", "invoicing", "reconciliation", "webhook-relay", "admin-dashboard"];
  const handlerNames = [
    "create", "update", "list", "get", "delete", "void", "retry", "sync", "validate", "notify",
    "archive", "export", "reconcile", "settle", "dispatch", "ingest", "publish", "subscribe",
    "cancel", "resume", "pause", "finalize", "approve", "reject",
  ];
  const lines = [];
  for (const service of services) {
    for (let i = 0; i < handlerNames.length; i++) {
      lines.push(
        `services/${service}/src/handlers/${handlerNames[i]}_handler.py:${12 + i * 7}: logger.info("request received", extra={"service": "${service}", "handler": "${handlerNames[i]}_handler"})`,
      );
    }
  }
  lines.push(`libs/observability/src/logger.py:44: def redact(payload: dict) -> dict:`);
  lines.push(`libs/observability/src/logger.py:58:     logger.debug("redacted %d fields", count)`);
  return lines.join("\n");
}
const GREP_RESULTS_LOGGER = buildGrepResults();

// A second large reference read: the Money type's own test suite, which the agent checks while
// confirming rate-limiting doesn't interact with the currency-rounding logic those incidents (see
// the system prompt's incident history) made everyone cautious about. Real per-currency
// parametrized test tables get long fast, which is exactly why this is a plausible large file.
function buildMoneyTestSuite() {
  const currencies = ["usd", "eur", "gbp", "jpy", "cad", "aud", "chf", "sek", "nok", "dkk", "nzd", "sgd", "hkd", "mxn", "brl", "inr", "zar", "pln", "try", "ils"];
  const lines = [
    '"""Exhaustive per-currency tests for libs/money.Money - see INC-1142 in the platform handbook."""',
    "import pytest",
    "",
    "from libs.money import Money, InvalidCurrencyError",
    "",
    "",
    "@pytest.mark.parametrize(",
    '    "currency,cents,expected_display",',
    "    [",
  ];
  for (const c of currencies) {
    const cents = 100 + c.length * 137;
    const display = `${(cents / 100).toFixed(2)} ${c.toUpperCase()}`;
    lines.push(`        ("${c}", ${cents}, "${display}"),`);
  }
  lines.push("    ],", ")", "def test_money_display_format(currency, cents, expected_display):");
  lines.push('    assert Money(cents=cents, currency=currency).display() == expected_display', "", "");

  lines.push("@pytest.mark.parametrize(", '    "currency,a_cents,b_cents,expected_cents",', "    [");
  for (const c of currencies) {
    const a = 100 + c.length * 41;
    const b = 250 + c.length * 19;
    lines.push(`        ("${c}", ${a}, ${b}, ${a + b}),`);
  }
  lines.push("    ],", ")", "def test_money_addition_is_exact(currency, a_cents, b_cents, expected_cents):");
  lines.push(
    "    result = Money(cents=a_cents, currency=currency) + Money(cents=b_cents, currency=currency)",
    "    assert result.cents == expected_cents",
    "",
    "",
  );

  lines.push("@pytest.mark.parametrize(", '    "currency,cents,percent,expected_cents",', "    [");
  for (const c of currencies) {
    for (const percent of [5, 10, 15, 25, 33]) {
      const cents = 1000 + c.length * 7;
      const expected = Math.round((cents * percent) / 100);
      lines.push(`        ("${c}", ${cents}, ${percent}, ${expected}),  # rounds half-to-even, not half-up - see INC-1142`);
    }
  }
  lines.push("    ],", ")", "def test_percentage_fee_rounding_matches_finance_rule(currency, cents, percent, expected_cents):");
  lines.push(
    "    fee = Money(cents=cents, currency=currency).percentage(percent)",
    "    assert fee.cents == expected_cents",
    "",
    "",
  );

  lines.push("def test_addition_across_currencies_raises():");
  lines.push("    with pytest.raises(InvalidCurrencyError):");
  lines.push('        Money(cents=100, currency="usd") + Money(cents=100, currency="eur")');
  lines.push("");
  lines.push("");
  lines.push('@pytest.mark.parametrize("currency", ' + JSON.stringify(currencies) + ")");
  lines.push("def test_money_is_frozen(currency):");
  lines.push("    money = Money(cents=100, currency=currency)");
  lines.push("    with pytest.raises(AttributeError):");
  lines.push("        money.cents = 200");
  return lines.join("\n");
}
const MONEY_TEST_SUITE = buildMoneyTestSuite();

function buildTranscript(systemFor) {
  const messages = [];
  const requests = [];
  let turnIndex = 0;

  const push = (msg) => messages.push(msg);
  const snapshot = () => {
    requests.push({
      model: MODEL,
      system: systemFor(turnIndex),
      tools: TOOLS,
      messages: JSON.parse(JSON.stringify(messages)),
    });
    turnIndex++;
  };
  let callId = 0;
  const call = (name, input) => ({ type: "tool_use", id: `call_${++callId}`, name, input });
  const result = (content) => [{ type: "tool_result", tool_use_id: `call_${callId}`, content }];

  // Turn 1: the user's opening request.
  push({
    role: "user",
    content:
      "We need to add client-side rate limiting to BillingClient (services/billing/src/client.py) - the billing API team just told us they're about to start enforcing their documented request quota and we're regularly bursting past it during month-end close. Add a configurable rate limiter, default it to something conservative, and make sure the full test suite (including the existing tests) still passes. Also run lint and typecheck when you're done.",
  });
  snapshot();

  // Explore.
  push({ role: "assistant", content: [{ type: "text", text: "I'll start by looking at the billing service's layout, then read the client and its tests before changing anything." }, call("list_directory", { path: "services/billing" })] });
  push({ role: "user", content: result(repo.DIRECTORY_LISTING) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Reading the current client implementation." }, call("read_file", { path: "services/billing/src/client.py" })] });
  push({ role: "user", content: result(repo.CLIENT_PY_V1) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "And its existing tests, so I don't break coverage or diverge from the test style already in use." }, call("read_file", { path: "services/billing/tests/test_client.py" })] });
  push({ role: "user", content: result(repo.TEST_CLIENT_PY_V1) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Checking the service's config module in case rate-limit settings should be loaded from there rather than hardcoded." }, call("read_file", { path: "services/billing/src/config.py" })] });
  push({ role: "user", content: result(repo.CONFIG_PY) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Before writing a new rate limiter, let me confirm one doesn't already exist somewhere in the monorepo I should reuse instead." }, call("search_symbol", { symbol: "RateLimiter" })] });
  push({ role: "user", content: result(repo.SYMBOL_NOT_FOUND) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Also checking the combined platform OpenAPI reference for a documented rate-limit response shape (429 body) across billing, invoicing, and reconciliation, so the client's behavior lines up with what the APIs actually return and I can see whether any sibling service already handles this." }, call("read_file", { path: "docs/api/combined-openapi.yaml" })] });
  push({ role: "user", content: result(OPENAPI_EXCERPT) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "The APIs do return 429s with a retry_after_seconds field, but a client-side token-bucket limiter is still the right first line of defense so we don't hit the quota at all during bursts. Given ground rule 10 and the incident history around currency rounding, let me also skim the Money type's own test suite before touching anything near billing arithmetic, even though a rate limiter itself doesn't do arithmetic - just to be sure nothing in this change path touches it." }, call("read_file", { path: "libs/money/tests/test_money.py" })] });
  push({ role: "user", content: result(MONEY_TEST_SUITE) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Confirmed - the rate limiter sits entirely outside the Money/arithmetic path, so none of those tests are affected. Writing the limiter now as its own module, matching the dataclass style used elsewhere in this service." }, call("write_file", { path: "services/billing/src/rate_limiter.py", content: repo.RATE_LIMITER_PY })] });
  push({ role: "user", content: result("Wrote 1104 bytes to services/billing/src/rate_limiter.py") });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Wiring the limiter into BillingClient: constructor takes a max_requests_per_second (defaulting to 5.0, well under the quota the billing team mentioned), and every outgoing request waits on it first." }, call("apply_patch", { path: "services/billing/src/client.py", diff: repo.CLIENT_PATCH })] });
  push({ role: "user", content: result(repo.APPLY_PATCH_RESULT_1) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Adding tests for the new behavior: that the limiter attribute exists, that it actually delays a burst, that it's shared across methods (not one bucket per call), and that the rate is configurable." }, call("apply_patch", { path: "services/billing/tests/test_client.py", diff: repo.TEST_CLIENT_PATCH })] });
  push({ role: "user", content: result(repo.APPLY_PATCH_RESULT_2) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Running the billing test suite." }, call("run_tests", { path: "services/billing" })] });
  push({
    role: "user",
    content: result(
      repo.testLog({
        total: 10,
        failing: ["test_rate_limiter_present"],
        failureDetail: `    def test_rate_limiter_present(client):
        assert hasattr(client, "_rate_limiter")
>       assert isinstance(client._rate_limiter, RateLimiter)
E       NameError: name 'RateLimiter' is not defined

services/billing/tests/test_client.py:47: NameError`,
      }),
    ),
  });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "The test file needs its own import of RateLimiter (the patch added the test but not the import) - fixing that." }, call("apply_patch", { path: "services/billing/tests/test_client.py", diff: `--- a/services/billing/tests/test_client.py\n+++ b/services/billing/tests/test_client.py\n@@ -1,5 +1,6 @@\n import pytest\n \n from services.billing.src.client import BillingClient\n from libs.money import Money\n+from services.billing.src.rate_limiter import RateLimiter\n` })] });
  push({ role: "user", content: result("Applied patch to services/billing/tests/test_client.py: 1 hunk, +1 -0 lines.") });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Re-running the suite." }, call("run_tests", { path: "services/billing" })] });
  push({ role: "user", content: result(repo.testLog({ total: 10, failing: [] })) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Tests pass. Running the linter before moving on." }, call("run_lint", { path: "services/billing" })] });
  push({ role: "user", content: result(repo.LINT_ISSUES) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Two small issues - a missing blank line and an unused-looking import that's actually load-bearing for the dataclass default_factory. Fixing the blank-line issue and adding a noqa comment explaining the import." }, call("apply_patch", { path: "services/billing/src/rate_limiter.py", diff: repo.RATE_LIMITER_PATCH })] });
  push({ role: "user", content: result(repo.APPLY_PATCH_RESULT_3) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Re-running lint." }, call("run_lint", { path: "services/billing" })] });
  push({ role: "user", content: result(repo.LINT_FIXED) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Lint clean. Running the typechecker." }, call("run_typecheck", { path: "services/billing" })] });
  push({ role: "user", content: result(repo.TYPECHECK_CLEAN) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Typecheck clean too. While I'm confident in the change, let me grep for any other place in the monorepo that logs per-request info the same way, in case there's a second BillingClient-like call site that should get the same treatment in a follow-up." }, call("grep_search", { pattern: "logger.info\\(\"request received\"" })] });
  push({ role: "user", content: result(GREP_RESULTS_LOGGER) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Those are unrelated per-request log lines, not other billing clients - no follow-up needed there. Checking git status before committing." }, call("git_status", {})] });
  push({ role: "user", content: result(repo.GIT_STATUS) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Reviewing the full diff one more time before committing." }, call("git_diff", {})] });
  push({ role: "user", content: result(repo.GIT_DIFF_SUMMARY) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Diff looks like exactly the intended change, nothing stray. Committing." }, call("git_commit", { message: "Add rate limiting to BillingClient\n\nThe billing API team is about to start enforcing their documented\nrequest quota, and we regularly burst past it during month-end close.\nAdds a token-bucket RateLimiter (default 5 req/s) shared across all\nBillingClient methods." })] });
  push({ role: "user", content: result(repo.GIT_COMMIT_RESULT) });
  snapshot();

  push({ role: "assistant", content: [{ type: "text", text: "Committed locally. Since this repo's CI matters for merge here, checking the last run's status for context before handing back to you (this commit hasn't been pushed, so this reflects the branch's prior state, not this exact commit)." }, call("fetch_ci_status", {})] });
  push({ role: "user", content: result(repo.CI_STATUS_PASS) });
  snapshot();

  push({
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Added a token-bucket RateLimiter (services/billing/src/rate_limiter.py, default 5 requests/second) and wired it into BillingClient so every outgoing call waits on it first. Updated services/billing/tests/test_client.py with four new tests covering presence, actual delay behavior, sharing across methods, and configurability. All 10 tests pass, lint is clean, and typecheck is clean. Committed locally as 4f2a9c1; not pushed.",
      },
    ],
  });
  push({
    role: "user",
    content:
      "Nice. One more thing while it's fresh - can you check whether list_invoices needs the same idempotency-key handling create_charge has, or is that only relevant for the write path?",
  });
  snapshot();

  return requests;
}

// --- Flagship example 1: cache busted by a timestamp in the system prompt ---
const bustBase = Date.UTC(2026, 8, 24, 14, 2, 0);
const bustOffsetsSeconds = [0, 47, 112, 165, 231, 289, 340, 401, 458, 523, 570, 634, 691, 748, 812, 869, 930, 994, 1052, 1118, 1179, 1240];
function bustTimestamp(turnIndex) {
  return new Date(bustBase + (bustOffsetsSeconds[turnIndex] ?? turnIndex * 60) * 1000).toISOString();
}
const bustRequests = buildTranscript((turnIndex) => systemBlock(`Current time: ${bustTimestamp(turnIndex)}\n\n${STATIC_SYSTEM_PROMPT}`));
writeFileSync(join(OUT_DIR, "anthropic-agent-cache-bust.jsonl"), bustRequests.map((r) => JSON.stringify(r)).join("\n") + "\n");

// --- Flagship example 2: same session, timestamp removed - the fix ---
const fixedRequests = buildTranscript(() => systemBlock(STATIC_SYSTEM_PROMPT));
writeFileSync(join(OUT_DIR, "anthropic-agent-cache-fixed.jsonl"), fixedRequests.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`Flagship pair: ${bustRequests.length} requests each.`);

// --- Example 3: the same file re-read three times in one conversation (duplicate content) ---
function buildDuplicateReadExample() {
  const messages = [];
  const requests = [];
  const push = (msg) => messages.push(msg);
  const snapshot = () =>
    requests.push({ model: MODEL, system: systemBlock(STATIC_SYSTEM_PROMPT), tools: TOOLS, messages: JSON.parse(JSON.stringify(messages)) });
  let callId = 0;
  const call = (name, input) => ({ type: "tool_use", id: `d${++callId}`, name, input });
  const result = (content) => [{ type: "tool_result", tool_use_id: `d${callId}`, content }];

  push({ role: "user", content: "What does services/billing/src/client.py currently do? I might have changed it since you last looked, so re-check before you touch anything." });
  snapshot();
  push({ role: "assistant", content: [{ type: "text", text: "Reading it now." }, call("read_file", { path: "services/billing/src/client.py" })] });
  push({ role: "user", content: result(repo.CLIENT_PY_V1) });
  push({ role: "assistant", content: [{ type: "text", text: "It's a thin requests-based wrapper around the billing API with get_invoice, list_invoices, and create_charge, plus idempotency-key handling on the write path." }] });
  push({ role: "user", content: "I didn't change anything, but please double-check by reading it again before you touch it." });
  snapshot();
  push({ role: "assistant", content: [{ type: "text", text: "Re-reading to confirm." }, call("read_file", { path: "services/billing/src/client.py" })] });
  push({ role: "user", content: result(repo.CLIENT_PY_V1) });
  push({ role: "assistant", content: [{ type: "text", text: "Confirmed unchanged." }] });
  push({ role: "user", content: "One more time please - I want to be certain before we start the rate-limiting change." });
  snapshot();
  push({ role: "assistant", content: [{ type: "text", text: "Reading it a third time." }, call("read_file", { path: "services/billing/src/client.py" })] });
  push({ role: "user", content: result(repo.CLIENT_PY_V1) });
  snapshot();
  return requests;
}
const duplicateRequests = buildDuplicateReadExample();
writeFileSync(join(OUT_DIR, "anthropic-duplicate-tool-results.jsonl"), duplicateRequests.map((r) => JSON.stringify(r)).join("\n") + "\n");

// --- Example 4: OpenAI Chat Completions, tools reordered mid-session ---
function buildOpenAiToolsReorderedExample() {
  const oaiToolsA = toOpenAiTools(TOOLS);
  // Same tools, two adjacent entries swapped - the kind of drift a `Object.values(toolMap)` call
  // produces when the map's insertion order isn't pinned.
  const oaiToolsB = [...oaiToolsA];
  [oaiToolsB[1], oaiToolsB[2]] = [oaiToolsB[2], oaiToolsB[1]];

  const messages = [{ role: "system", content: STATIC_SYSTEM_PROMPT }, { role: "user", content: "Add a rate limiter to BillingClient in services/billing/src/client.py and make sure the tests pass." }];
  const requests = [];
  requests.push({ model: "gpt-6-sol", tools: oaiToolsA, messages: JSON.parse(JSON.stringify(messages)) });

  messages.push({ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "services/billing/src/client.py" }) } }] });
  messages.push({ role: "tool", tool_call_id: "c1", content: repo.CLIENT_PY_V1 });
  requests.push({ model: "gpt-6-sol", tools: oaiToolsA, messages: JSON.parse(JSON.stringify(messages)) });

  messages.push({ role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "services/billing/src/rate_limiter.py", content: repo.RATE_LIMITER_PY }) } }] });
  messages.push({ role: "tool", tool_call_id: "c2", content: "Wrote 1104 bytes to services/billing/src/rate_limiter.py" });
  // Bug: this request was built by a code path that re-derives the tool list from an unordered map.
  requests.push({ model: "gpt-6-sol", tools: oaiToolsB, messages: JSON.parse(JSON.stringify(messages)) });

  messages.push({ role: "assistant", content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "run_tests", arguments: "{}" } }] });
  messages.push({ role: "tool", tool_call_id: "c3", content: repo.testLog({ total: 10, failing: [] }) });
  requests.push({ model: "gpt-6-sol", tools: oaiToolsB, messages: JSON.parse(JSON.stringify(messages)) });

  return requests;
}
const openAiRequests = buildOpenAiToolsReorderedExample();
writeFileSync(join(OUT_DIR, "openai-agent-tools-reordered.jsonl"), openAiRequests.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`Duplicate-read example: ${duplicateRequests.length} requests. OpenAI reordered-tools example: ${openAiRequests.length} requests.`);
console.log(`Wrote examples to ${OUT_DIR}`);
