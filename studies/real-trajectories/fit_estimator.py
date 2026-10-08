#!/usr/bin/env python3
"""Fit the two characters-per-token anchors of the Claude estimate on half of the steps.

Usage: fit_estimator.py <segdata.json> <out.json>

Each row is one step of one session: the segments the later request added to
the one before (category, characters, symbol density) and the change in the
provider's reported input tokens. Rows are split by sha256 of the instance id;
the grid search sees side 0 only. Reports the sum of reported over estimated
growth and the mean absolute error per step on both sides, for the old anchors,
the fitted ones and two variants with a free overhead (a constant per step, a
constant per segment) that the tool does not use.
"""
import hashlib, json, sys
import numpy as np

D = json.load(open(sys.argv[1]))


def side(t):
    return int(hashlib.sha256(t.encode()).hexdigest(), 16) % 2


def tot(e, u):  # see score.py: how the harness's litellm summed usage
    return u["prompt_tokens"] + (u["cache_creation"] if ("v1.13" in e or "v1.16" in e) else 0)


rows = []
for t in D:
    e = t["entry"]
    if "cache_read" not in t["usage"][0]:
        continue
    for k, seg in enumerate(t["added"]):
        rows.append((side(t["traj"]), tot(e, t["usage"][k + 1]) - tot(e, t["usage"][k]), np.array([[s[1], s[2]] for s in seg], float).reshape(-1, 2)))


def est(a, P, Dd, lo=0.15, hi=0.45):
    if len(a) == 0:
        return 0.0
    t = np.clip((a[:, 1] - lo) / (hi - lo), 0, 1)
    return float(np.sum(np.maximum(1, np.round(a[:, 0] / (P + t * (Dd - P))))))


def run(rs, P, Dd, step=0.0, seg=0.0):
    y = np.array([r[1] for r in rs], float)
    x = np.array([est(r[2], P, Dd) + step + seg * len(r[2]) for r in rs])
    return y, x


tr = [r for r in rows if r[0] == 0]
te = [r for r in rows if r[0] == 1]
grid = [(P, Dd) for P in np.arange(2.8, 4.41, 0.1) for Dd in np.arange(1.8, 3.31, 0.1)]
losses = []
for P, Dd in grid:
    y, x = run(tr, P, Dd)
    losses.append(np.sum((y - x) ** 2))
P, Dd = grid[int(np.argmin(losses))]
P, Dd = round(float(P), 1), round(float(Dd), 1)


def summary(P, Dd, step=0.0, seg=0.0):
    out = {}
    for name, rs in (("fit_side", tr), ("held_out_side", te)):
        y, x = run(rs, P, Dd, step, seg)
        out[name] = {"steps": len(rs), "reported_over_estimated": round(float(y.sum() / x.sum()), 3), "mean_abs_error_tokens": round(float(np.mean(abs(y - x))), 1)}
    return out


res = {"grid": "prose 2.8..4.4, dense 1.8..3.3, step 0.1, squared error of the change in input tokens, side 0 only", "fitted": {"prose": P, "dense": Dd},
       "old (4.0, 2.9)": summary(4.0, 2.9), "fitted": {"prose": P, "dense": Dd, **summary(P, Dd)}}
best = None
for p2, d2 in grid:
    for c in (0, 10, 20, 30, 40, 50, 60):
        y, x = run(tr, p2, d2, step=c)
        l = np.sum((y - x) ** 2)
        if best is None or l < best[0]:
            best = (l, p2, d2, c)
res["variant, constant per step (not in the tool)"] = {"prose": round(float(best[1]), 1), "dense": round(float(best[2]), 1), "tokens_per_step": best[3], **summary(best[1], best[2], step=best[3])}
best = None
for p2, d2 in grid:
    for s in (0, 2, 4, 6, 8, 10, 12, 15, 20, 30):
        y, x = run(tr, p2, d2, seg=s)
        l = np.sum((y - x) ** 2)
        if best is None or l < best[0]:
            best = (l, p2, d2, s)
res["variant, constant per segment (not in the tool)"] = {"prose": round(float(best[1]), 1), "dense": round(float(best[2]), 1), "tokens_per_segment": best[3], **summary(best[1], best[2], seg=best[3])}
json.dump(res, open(sys.argv[2], "w"), indent=1)
print(json.dumps(res, indent=1))
