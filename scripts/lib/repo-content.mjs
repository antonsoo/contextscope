// Realistic-looking (but entirely synthetic) file contents, diffs, and tool output for the
// flagship example's "ledger-core" billing service. Nothing here is real code from any real
// project - it's written to be internally consistent and plausible, not copied from anywhere.

export const DIRECTORY_LISTING = `services/billing/
  src/
    __init__.py
    client.py
    config.py
    exceptions.py
  tests/
    conftest.py
    test_client.py
    test_config.py
  pyproject.toml
  CHANGELOG.md
libs/
  money/
  idempotency/
  observability/
db/
  migrations/
README.md`;

export const CLIENT_PY_V1 = `"""HTTP client for the internal billing API."""
from __future__ import annotations

import requests

from libs.idempotency import IdempotencyStore
from libs.money import Money
from libs.observability import get_logger, traced

logger = get_logger(__name__)


class BillingClient:
    """Thin wrapper around the billing service's REST API."""

    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {api_key}"})
        self._idempotency = IdempotencyStore(namespace="billing.client")

    @traced
    def get_invoice(self, invoice_id: str) -> dict:
        """Fetch a single invoice by id.

        Args:
            invoice_id: The invoice's opaque id.

        Returns:
            The invoice as a dict, as returned by the billing API.
        """
        response = self._session.get(f"{self.base_url}/invoices/{invoice_id}", timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    @traced
    def list_invoices(self, customer_id: str, limit: int = 50) -> list[dict]:
        """List invoices for a customer, most recent first."""
        response = self._session.get(
            f"{self.base_url}/customers/{customer_id}/invoices",
            params={"limit": limit},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()["invoices"]

    @traced
    def create_charge(self, customer_id: str, amount: Money, idempotency_key: str) -> dict:
        """Create a new charge for a customer.

        Args:
            customer_id: The customer to charge.
            amount: The amount to charge, as a Money value.
            idempotency_key: A caller-supplied key; a retry with the same key
                returns the original charge instead of creating a duplicate.
        """
        if self._idempotency.seen(idempotency_key):
            logger.info("charge idempotency hit", extra={"idempotency_key": idempotency_key})
            return self._idempotency.get(idempotency_key)

        response = self._session.post(
            f"{self.base_url}/customers/{customer_id}/charges",
            json={"amount_cents": amount.cents, "currency": amount.currency},
            timeout=self.timeout,
        )
        response.raise_for_status()
        result = response.json()
        self._idempotency.record(idempotency_key, result)
        logger.info("charge created", extra={"customer_id": customer_id, "amount_cents": amount.cents})
        return result
`;

export const RATE_LIMITER_PY = `"""A token-bucket rate limiter shared across all requests from one client."""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class RateLimiter:
    """A simple token-bucket rate limiter.

    Args:
        max_per_second: The maximum sustained request rate to allow.
        burst: The maximum number of requests allowed in a burst before
            the limiter starts spacing calls out. Defaults to 1 (no burst).
    """

    max_per_second: float
    burst: int = 1
    _tokens: float = field(default=0.0, init=False)
    _last_refill: float = field(default_factory=time.monotonic, init=False)

    def __post_init__(self) -> None:
        self._tokens = float(self.burst)

    def wait(self) -> None:
        """Block until a token is available, then consume one."""
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self.burst, self._tokens + elapsed * self.max_per_second)
        self._last_refill = now

        if self._tokens < 1:
            deficit = 1 - self._tokens
            time.sleep(deficit / self.max_per_second)
            self._tokens = 0
            self._last_refill = time.monotonic()
        else:
            self._tokens -= 1
`;

export const TEST_CLIENT_PY_V1 = `import pytest

from services.billing.src.client import BillingClient
from libs.money import Money


@pytest.fixture
def client():
    return BillingClient("https://billing.internal", "test-key")


def test_get_invoice(client, requests_mock):
    requests_mock.get("https://billing.internal/invoices/inv_1", json={"id": "inv_1"})
    assert client.get_invoice("inv_1") == {"id": "inv_1"}


def test_list_invoices(client, requests_mock):
    requests_mock.get(
        "https://billing.internal/customers/cus_1/invoices",
        json={"invoices": [{"id": "inv_1"}, {"id": "inv_2"}]},
    )
    assert len(client.list_invoices("cus_1")) == 2


def test_create_charge(client, requests_mock):
    requests_mock.post(
        "https://billing.internal/customers/cus_1/charges",
        json={"id": "ch_1", "amount_cents": 500},
    )
    result = client.create_charge("cus_1", Money(cents=500, currency="usd"), idempotency_key="key-1")
    assert result["id"] == "ch_1"


def test_create_charge_idempotent(client, requests_mock, fake_idempotency_store):
    fake_idempotency_store.record("key-1", {"id": "ch_1", "amount_cents": 500})
    result = client.create_charge("cus_1", Money(cents=500, currency="usd"), idempotency_key="key-1")
    assert result["id"] == "ch_1"


def test_get_invoice_raises_on_404(client, requests_mock):
    requests_mock.get("https://billing.internal/invoices/missing", status_code=404)
    with pytest.raises(Exception):
        client.get_invoice("missing")


def test_timeout_propagates(requests_mock):
    client = BillingClient("https://billing.internal", "test-key", timeout=0.001)
    requests_mock.get("https://billing.internal/invoices/inv_1", exc=TimeoutError)
    with pytest.raises(TimeoutError):
        client.get_invoice("inv_1")
`;

export const CONFIG_PY = `"""Typed configuration for the billing service, loaded from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class BillingConfig:
    base_url: str
    api_key: str
    max_requests_per_second: float = 5.0
    request_timeout_seconds: float = 10.0

    @classmethod
    def from_env(cls) -> "BillingConfig":
        return cls(
            base_url=os.environ["BILLING_API_BASE_URL"],
            api_key=os.environ["BILLING_API_KEY"],
            max_requests_per_second=float(os.environ.get("BILLING_MAX_RPS", "5.0")),
            request_timeout_seconds=float(os.environ.get("BILLING_TIMEOUT_SECONDS", "10.0")),
        )
`;

export function testLog({ total, failing = [], failureDetail }) {
  const passing = total - failing.length;
  const names = [
    "test_get_invoice",
    "test_list_invoices",
    "test_create_charge",
    "test_create_charge_idempotent",
    "test_get_invoice_raises_on_404",
    "test_timeout_propagates",
    "test_rate_limiter_present",
    "test_rate_limiter_delays_calls_past_the_configured_rate",
    "test_rate_limiter_shared_across_methods",
    "test_max_requests_per_second_is_configurable",
  ].slice(0, total);
  const lines = names.map((n, i) => {
    const pct = Math.round(((i + 1) / total) * 100);
    const status = failing.includes(n) ? "FAILED" : "PASSED";
    return `services/billing/tests/test_client.py::${n} ${status}${" ".repeat(Math.max(1, 50 - n.length - status.length))}[${String(pct).padStart(3)}%]`;
  });
  let out = `============================= test session starts ==============================\ncollected ${total} items\n\n${lines.join("\n")}\n`;
  if (failing.length > 0) {
    out += `\n=================================== FAILURES ===================================\n`;
    for (const name of failing) {
      out += `______________________ ${name} __________________________\n\n${failureDetail ?? "AssertionError: see traceback"}\n\n`;
    }
    out += `=========================== ${failing.length} failed, ${passing} passed in ${(total * 0.07).toFixed(2)}s ==========================`;
  } else {
    out += `\n============================== ${total} passed in ${(total * 0.06).toFixed(2)}s ================================`;
  }
  return out;
}

export const LINT_ISSUES = `services/billing/src/client.py:15:1: E302 expected 2 blank lines, found 1
services/billing/src/rate_limiter.py:3:1: F401 'dataclasses.field' imported but unused
Found 2 errors.`;

export const LINT_FIXED = `All checks passed! (services/billing/src/client.py, services/billing/src/rate_limiter.py, services/billing/tests/test_client.py)`;

export const TYPECHECK_CLEAN = `Success: no issues found in 3 source files`;

export const GIT_STATUS = `On branch agent/rate-limit-billing-client
Changes not staged for commit:
  modified:   services/billing/src/client.py
  modified:   services/billing/tests/test_client.py

Untracked files:
  services/billing/src/rate_limiter.py`;

export const GIT_DIFF_SUMMARY = ` services/billing/src/client.py        | 14 ++++++++++----
 services/billing/src/rate_limiter.py  | 33 +++++++++++++++++++++++++++++++++
 services/billing/tests/test_client.py | 34 ++++++++++++++++++++++++++++++++++
 3 files changed, 73 insertions(+), 8 deletions(-)`;

export const GIT_COMMIT_RESULT = `[agent/rate-limit-billing-client 4f2a9c1] Add rate limiting to BillingClient

 3 files changed, 73 insertions(+), 8 deletions(-)
 create mode 100644 services/billing/src/rate_limiter.py`;

export const CI_STATUS_PASS = `branch: agent/rate-limit-billing-client
commit: 4f2a9c1

  lint       PASSED   (12s)
  typecheck  PASSED   (28s)
  test       PASSED   (3m 41s)
  build      PASSED   (54s)`;

export const SYMBOL_NOT_FOUND = `No definitions found for symbol "RateLimiter" in the monorepo.`;

export const APPLY_PATCH_RESULT_1 = `Applied patch to services/billing/src/client.py: 2 hunks, +14 -4 lines.`;
export const APPLY_PATCH_RESULT_2 = `Applied patch to services/billing/tests/test_client.py: 1 hunk, +34 -0 lines.`;
export const APPLY_PATCH_RESULT_3 = `Applied patch to services/billing/src/rate_limiter.py: 1 hunk, +1 -1 lines.`;

export const RATE_LIMITER_PATCH = `--- a/services/billing/src/rate_limiter.py
+++ b/services/billing/src/rate_limiter.py
@@ -1,7 +1,7 @@
 """A token-bucket rate limiter shared across all requests from one client."""
 from __future__ import annotations

 import time
-from dataclasses import dataclass, field
+from dataclasses import dataclass, field  # noqa: F401 - field used in default_factory below
`;

export const CLIENT_PATCH = `--- a/services/billing/src/client.py
+++ b/services/billing/src/client.py
@@ -1,6 +1,8 @@
 """HTTP client for the internal billing API."""
 from __future__ import annotations

 import requests

 from libs.idempotency import IdempotencyStore
 from libs.money import Money
 from libs.observability import get_logger, traced
+
+from services.billing.src.rate_limiter import RateLimiter
@@ -10,13 +12,20 @@ logger = get_logger(__name__)
 class BillingClient:
     """Thin wrapper around the billing service's REST API."""

-    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0) -> None:
+    def __init__(
+        self,
+        base_url: str,
+        api_key: str,
+        timeout: float = 10.0,
+        max_requests_per_second: float = 5.0,
+    ) -> None:
         self.base_url = base_url.rstrip("/")
         self.api_key = api_key
         self.timeout = timeout
         self._session = requests.Session()
         self._session.headers.update({"Authorization": f"Bearer {api_key}"})
         self._idempotency = IdempotencyStore(namespace="billing.client")
+        self._rate_limiter = RateLimiter(max_requests_per_second)
`;

export const TEST_CLIENT_PATCH = `--- a/services/billing/tests/test_client.py
+++ b/services/billing/tests/test_client.py
@@ -1,6 +1,7 @@
 import pytest

 from services.billing.src.client import BillingClient
 from libs.money import Money
+from services.billing.src.rate_limiter import RateLimiter
@@ -40,3 +41,36 @@ def test_timeout_propagates(requests_mock):
     requests_mock.get("https://billing.internal/invoices/inv_1", exc=TimeoutError)
     with pytest.raises(TimeoutError):
         client.get_invoice("inv_1")
+
+
+def test_rate_limiter_present(client):
+    assert hasattr(client, "_rate_limiter")
+    assert isinstance(client._rate_limiter, RateLimiter)
+
+
+def test_rate_limiter_delays_calls_past_the_configured_rate(frozen_clock):
+    limiter = RateLimiter(max_per_second=2.0, burst=1)
+    limiter.wait()
+    frozen_clock.tick(0.1)
+    start = frozen_clock.now()
+    limiter.wait()
+    assert frozen_clock.now() - start >= 0.4
+
+
+def test_rate_limiter_shared_across_methods(client, requests_mock, frozen_clock):
+    requests_mock.get("https://billing.internal/invoices/inv_1", json={"id": "inv_1"})
+    requests_mock.get(
+        "https://billing.internal/customers/cus_1/invoices",
+        json={"invoices": []},
+    )
+    client.get_invoice("inv_1")
+    client.list_invoices("cus_1")
+    assert client._rate_limiter._tokens < 1
+
+
+def test_max_requests_per_second_is_configurable(requests_mock):
+    client = BillingClient("https://billing.internal", "test-key", max_requests_per_second=100.0)
+    assert client._rate_limiter.max_per_second == 100.0
`;
