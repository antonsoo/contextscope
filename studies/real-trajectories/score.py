#!/usr/bin/env python3
"""Score contextscope against the usage each provider reported.

Inputs (all produced by analyze.mjs / segdata.mjs from the reconstructed requests):
  --released  analysis of contextscope v0.3.3
  --head      analysis of this repository before the study's changes (HEAD 9479694)
  --after     analysis of the working tree after them
  --segdata   segments added per step (segdata.mjs, run on the working tree)
Writes results.json.
"""
import argparse, collections, hashlib, json, os
import numpy as np

ap = argparse.ArgumentParser()
for k in ("released", "head", "after", "segdata", "out"):
    ap.add_argument("--" + k, required=True)
ap.add_argument("--manifest", required=True)
ap.add_argument("--bodies", required=True)
ap.add_argument("--fit", required=True)
a = ap.parse_args()


def load(p):
    return [json.loads(l) for l in open(p)]


def side(t):  # train/test split of trajectories, fixed by the instance id
    return int(hashlib.sha256(t.encode()).hexdigest(), 16) % 2


def is_claude(r):
    return "cache_read" in r["usage"]


def sem(entry):  # how the harness's litellm summed usage: see README "Reading the usage fields"
    return "A" if ("v1.13" in entry or "v1.16" in entry) else "B"


def total_in(r, entry):
    u = r["usage"]
    if "cache_read" not in u:
        return u["prompt_tokens"]
    return u["prompt_tokens"] + (u["cache_creation"] if sem(entry) == "A" else 0)


def pct(x, q):
    return float(np.percentile(x, q))


R = {"released": load(a.released), "head": load(a.head), "after": load(a.after)}
out = {"provenance": {
    "released": "contextscope v0.3.3 (tag, commit 4bef9ea)", "head": "contextscope 9479694, the checkout before this study's changes",
    "after": "the working tree of the commit that adds this study",
    "reconstruction": "mini-swe-agent tags v1.13.3, v1.16.0, v2.0.0 (pinned source) with litellm 1.104.2; OpenAI entries need no library",
    "swe_bench_experiments_commit": "40f164d5b8f1d249bf95a6df8b74b577fd8e519d (main, 2026-09-03)",
}, "splits": "trajectories are split by sha256(instance id) mod 2; side 1 is held out", "versions": {}}
man = json.load(open(a.manifest))

# ---- dataset
ds = {}
for e, v in man["entries"].items():
    rows = [r for r in R["after"] if r["entry"] == e]
    ds[e] = {"listed": v["listed"], "sampled": len(v["files"]), "analysed_trajectories": len({r["traj"] for r in rows}),
             "requests": len(rows), "calls_mismatch_trajectories": len({r["traj"] for r in rows if r["meta_calls"] != r["n"]})}
out["dataset"] = ds

# ---- token counts, per entry, per version
tok = {}
for ver, rows in R.items():
    for e in sorted({r["entry"] for r in rows}):
        rs = [r for r in rows if r["entry"] == e]
        claude = is_claude(rs[0])
        tot = np.array([total_in(r, e) for r in rs], float)
        est = np.array([r["cs"]["claude" if claude else "openai"] for r in rs], float)
        err = (est - tot) / tot
        te = np.array([side(r["traj"]) == 1 for r in rs])
        d = {"n": len(rs), "signed_mean_pct": round(err.mean() * 100, 2), "mape_pct": round(abs(err).mean() * 100, 2),
             "p95_abs_pct": round(pct(abs(err), 95), 2) if False else round(pct(abs(err) * 100, 95), 2),
             "heldout_n": int(te.sum()), "heldout_signed_mean_pct": round(err[te].mean() * 100, 2),
             "heldout_mape_pct": round(abs(err[te]).mean() * 100, 2), "heldout_p95_abs_pct": round(pct(abs(err[te]) * 100, 95), 2)}
        tok.setdefault(e, {})[ver] = d
out["token_counts"] = tok

# OpenAI framing: residual of reported prompt_tokens against content + 5 per message
res = collections.Counter()
for r in R["released"]:
    if not is_claude(r):
        n = r["cs"]["nseg"]
        res[r["usage"]["prompt_tokens"] - r["cs"]["openai"] - 5 * n] += 1
out["openai_framing_residual_released_count_minus_5_per_message"] = {str(k): v for k, v in sorted(res.items())}
res2 = collections.Counter(r["usage"]["prompt_tokens"] - r["cs"]["openai"] for r in R["after"] if not is_claude(r))
out["openai_residual_after_change"] = {str(k): v for k, v in sorted(res2.items())}

# ---- content type (regression of the change in reported input tokens on the change in estimated tokens)
seg = json.load(open(a.segdata))
cats = ["user", "assistant", "tool_call", "tool_result", "thinking"]


def est_seg(s, P, D, lo=0.15, hi=0.45):
    t = min(1, max(0, (s[2] - lo) / (hi - lo)))
    return max(1, round(s[1] / (P + t * (D - P))))


bytype = {}
for label, (P, D) in {"before (4.0 / 2.9)": (4.0, 2.9), "after (3.3 / 2.5)": (3.3, 2.5)}.items():
    X, y, ent = [], [], []
    for t in seg:
        e = t["entry"]
        if "cache_read" not in t["usage"][0] or side(t["traj"]) != 1:
            continue
        for k, added in enumerate(t["added"]):
            row = {c: 0 for c in cats}
            for s in added:
                if s[0] in row:
                    row[s[0]] += est_seg(s, P, D)
            X.append([row[c] for c in cats]); y.append(total_in({"usage": t["usage"][k + 1]}, e) - total_in({"usage": t["usage"][k]}, e)); ent.append(e)
    X, y = np.array(X, float), np.array(y, float)
    keep = [i for i in range(len(cats)) if X[:, i].sum() > 0]
    A = np.hstack([X[:, keep], np.ones((len(y), 1))])
    coef = np.linalg.lstsq(A, y, rcond=None)[0]
    bytype[label] = {"heldout_steps": len(y), "factor_actual_over_estimate": {cats[i]: round(float(c), 3) for i, c in zip(keep, coef)},
                     "per_step_constant_tokens": round(float(coef[-1]), 1), "sum_actual_over_sum_est": round(float(y.sum() / X.sum()), 3)}
    per = {}
    for e in sorted(set(ent)):
        m = np.array([x == e for x in ent])
        per[e] = round(float(y[m].sum() / X[m].sum()), 3)
    bytype[label]["sum_ratio_by_entry"] = per
out["by_content_type_heldout"] = bytype

# ---- cache, Anthropic
cache = {}
for ver, rows in R.items():
    for e in sorted({r["entry"] for r in rows if is_claude(r)}):
        rs = [r for r in rows if r["entry"] == e]
        conf = collections.Counter((r["usage"]["cache_read"] > 0, r["cs"]["read"] > 0) for r in rs)
        d = {"requests": len(rs), "actual_read_sim_read": conf[(True, True)], "actual_read_sim_none": conf[(True, False)],
             "actual_none_sim_read": conf[(False, True)], "actual_none_sim_none": conf[(False, False)]}
        d["agree_pct"] = round(100 * (d["actual_read_sim_read"] + d["actual_none_sim_none"]) / len(rs), 2)
        tot = sum(total_in(r, e) for r in rs); est = sum(r["cs"]["claude"] for r in rs)
        d["actual_read_share_pct"] = round(100 * sum(r["usage"]["cache_read"] for r in rs) / tot, 2)
        d["sim_read_share_pct"] = round(100 * sum(r["cs"]["read"] for r in rs) / est, 2)
        # named causes
        fl = collections.Counter()
        for r in rs:
            for k in set(r["cs"]["finds"]):
                if k == "below_minimum_cacheable":
                    fl[(k, "provider cached nothing" if r["usage"]["cache_read"] == 0 and r["usage"]["cache_creation"] == 0 else "provider cached")] += 1
                elif k == "lookback_window_exceeded":
                    fl[(k, "provider read the cache" if r["usage"]["cache_read"] > 0 else "provider did not read")] += 1
        d["findings"] = {f"{k}: {v}": n for (k, v), n in sorted(fl.items())}
        nothing = sum(1 for r in rs if r["usage"]["cache_read"] == 0 and r["usage"]["cache_creation"] == 0)
        flagged = sum(1 for r in rs if r["usage"]["cache_read"] == 0 and r["usage"]["cache_creation"] == 0 and "below_minimum_cacheable" in r["cs"]["finds"])
        d["provider_cached_nothing"] = nothing
        d["of_which_flagged_below_minimum"] = flagged
        cache.setdefault(e, {})[ver] = d
out["anthropic_cache"] = cache

# what the sessions lost, per entry, from the provider's numbers (after-change analysis, any version gives the same usage)
# documented minimum cacheable prefix (platform.claude.com/docs/en/build-with-claude/prompt-caching, fetched 2026-10-08)
MIN = {"claude-opus-4-5": 4096, "claude-opus-4-6": 4096, "claude-haiku-4-5": 4096, "claude-sonnet-4-5": 1024}
lost = {}
rows = R["after"]
T = collections.defaultdict(list)
for r in rows:
    if is_claude(r):
        T[(r["entry"], r["traj"])].append(r)
gaps = []
for (e, t), rs in T.items():
    rs.sort(key=lambda r: r["k"])
    model = rs[0]["cs"]["model"]
    d = lost.setdefault(e, {"steps": 0, "input_tokens_total": 0, "tokens_not_read_below_minimum": 0, "tokens_not_read_above_minimum": 0,
                            "unexplained_miss_steps": 0, "unexplained_miss_examples": []})
    for prev, cur in zip(rs, rs[1:]):
        gaps.append(cur["created"] - prev["created"])
        pt = total_in(prev, e)
        short = pt - cur["usage"]["cache_read"]
        d["steps"] += 1
        d["input_tokens_total"] += total_in(cur, e)
        if short > 64:
            m = MIN[model]
            if pt < m:
                d["tokens_not_read_below_minimum"] += short
            else:
                d["tokens_not_read_above_minimum"] += short
                if short > 1000:
                    d["unexplained_miss_steps"] += 1
                    if len(d["unexplained_miss_examples"]) < 3:
                        d["unexplained_miss_examples"].append({"traj": t, "step": cur["k"], "prev_input": pt, "read": cur["usage"]["cache_read"], "seconds_since_prev": cur["created"] - prev["created"]})
out["anthropic_losses"] = lost
out["anthropic_seconds_between_calls"] = {"n": len(gaps), "median": float(np.median(gaps)), "p99": pct(gaps, 99), "max": float(max(gaps)), "over_300s": int(sum(g >= 300 for g in gaps))}

# ---- cache, OpenAI
oa = {}
for ver in ("released", "after"):
    for e in sorted({r["entry"] for r in R[ver] if not is_claude(r)}):
        T = collections.defaultdict(list)
        for r in R[ver]:
            if r["entry"] == e:
                T[r["traj"]].append(r)
        c = collections.Counter(); ar = pr = 0; bysize = collections.defaultdict(lambda: [0, 0]); k0 = [0, 0]
        pairs = []
        for t, rs in T.items():
            rs.sort(key=lambda r: r["k"])
            for r in rs:
                act = r["usage"]["cached_tokens"] or 0
                if r["k"] == 0:
                    k0[0] += 1; k0[1] += act > 0
                    continue
                pred = r["cs"]["read"]
                if pred == 0 and act == 0: c["both zero"] += 1
                elif pred == 0: c["provider cached, tool predicted none"] += 1
                elif act == 0: c["tool predicted a read, provider cached nothing"] += 1
                elif act == pred: c["equal"] += 1
                elif act < pred: c["provider cached less"] += 1
                else: c["provider cached more"] += 1
                ar += act; pr += pred
                if pred > 0:
                    b = min(pred // 2048, 8) * 2048
                    bysize[b][0] += 1; bysize[b][1] += act > 0
                pairs.append((pred, act))
        n = sum(c.values())
        oa.setdefault(e, {})[ver] = {"steps_after_first": n, **dict(c), "equal_pct": round(100 * c["equal"] / n, 1),
                                     "provider_cached_over_predicted_tokens": round(ar / pr, 3),
                                     "first_requests": k0[0], "first_requests_with_cached_tokens": int(k0[1])}
        if ver == "after":
            oa[e][ver]["hit_rate_by_predicted_prefix_tokens"] = {str(k): round(v[1] / v[0], 3) for k, v in sorted(bysize.items())}
out["openai_cache"] = oa
tot_ = collections.Counter()
for e, v in oa.items():
    for k, x in v["after"].items():
        if isinstance(x, int) and k not in ("steps_after_first", "first_requests", "first_requests_with_cached_tokens"):
            tot_[k] += x
out["openai_cache_all_entries_after"] = dict(tot_)

# ---- other facts quoted in the README
first = collections.defaultdict(list)
for r in R["after"]:
    if r["k"] == 0 and is_claude(r):
        first[r["entry"]].append(total_in(r, r["entry"]) - r["cs"]["claude"])
out["claude_first_request_reported_minus_estimate_tokens_now"] = {e: {"mean": round(float(np.mean(v)), 0), "median": float(np.median(v))} for e, v in first.items()}
lens = collections.Counter((r["entry"], r["traj"]) for r in R["after"])
out["session_length_requests"] = {"min": min(lens.values()), "median": int(np.median(list(lens.values()))), "max": max(lens.values())}
out["openai_cached_tokens_not_multiple_of_128"] = sum(1 for r in R["after"] if not is_claude(r) and (r["usage"]["cached_tokens"] or 0) % 128)
out["openai_nonzero_cached_tokens"] = sum(1 for r in R["after"] if not is_claude(r) and r["usage"]["cached_tokens"])
# a text block appended to the user message that carries a tool result (mini-SWE-agent's format-error reply)
import gzip
ev = collections.Counter()
for e in sorted({r["entry"] for r in R["after"] if is_claude(r) and "v2.0.0" in r["entry"]}):
    for f in sorted(os.listdir(os.path.join(a.bodies, e))):
        L = [json.loads(l) for l in gzip.open(os.path.join(a.bodies, e, f), "rt")][1:]
        for i, rec in enumerate(L[1:], 1):
            last = rec["body"]["messages"][-1]
            kinds = {c["type"] for c in last["content"]}
            if last["role"] == "user" and {"tool_result", "text"} <= kinds:
                u, pu = rec["usage"], L[i - 1]["usage"]
                ev[(rec["body"]["model"], "cache_read>0" if u["cache_read"] else "cache_read=0", "input fell" if u["prompt_tokens"] < pu["prompt_tokens"] else "input did not fall")] += 1
out["steps_with_text_after_tool_result"] = {" | ".join(k): v for k, v in sorted(ev.items())}
out["estimator_fit"] = json.load(open(a.fit))
json.dump(out, open(a.out, "w"), indent=1)
print("wrote", a.out)
