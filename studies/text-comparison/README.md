# Read the edits inside a duplicate group

At baseline `e835a2f`, two text blocks in the same message had identical
inspection button labels. Reviewing differences required opening one original
at a time. The retained [baseline browser receipt](results/baseline-browser.json)
records this in Chromium and Firefox, at 1440px and 375px.

The source browser displays each member's request number and full source path.
**Compare with first** opens a literal line comparison with three unchanged
lines of context around each edit. Both source positions remain visible. The
example picker now exposes the existing
[three configuration snapshots](../../examples/anthropic-edited-repeats.json).
The similarity detector and its grouping rules have not changed.

Only the existing first 20 member controls are displayed; each later displayed
member can be compared with the first. This is not arbitrary pair selection.
The comparison uses analyzed text, which can be identical when raw metadata
differs. Both complete analyzed texts and original JSON objects are downloadable.
No text or raw object is added to the portable JSON/HTML reports.

## Literal content and explicit limits

Case, whitespace, CRLF/LF and a missing final newline remain significant.
Changed lines show their endings; an optional escaped display exposes tabs,
spaces at line ends and invisible controls. Source markup is rendered as text.
UTF-8 text downloads preserve valid Unicode. An unpaired surrogate instead
gets a JSON-string download, with an explanation, so it is not silently replaced.

Unequal inputs above 500,000 combined JavaScript string code units or 10,000
combined lines do not get an inline preview. The line differ is bounded by
512 edits and a 40ms algorithm timeout. This timeout does not bound the whole
UI event, tokenization, line splitting, DOM rendering or downloads. Completed
previews are withheld if their displayed content exceeds 32,000 code units or
600 rows. Exact equality is checked first, including for larger strings.

Every refusal explicitly says the text differs and offers the complete files;
it never presents a partial diff or implies equality. A successful preview may
fold unchanged intervals but retains every changed line. Similarity and a diff
do not establish that a read is safe to remove.

The browser bundles pinned [jsdiff 9.0.0](https://github.com/kpdecker/jsdiff).
Its BSD-3-Clause notice is served verbatim and linked from the footer.
The dependency is development-only because the library and CLI do not use it.

## Reproduction

`cases.mjs` constructs seven inputs: two distant configuration edits, exact
text, whitespace/endings, literal HTML, an oversized comparison, unpaired
surrogates and a comparison opened while another request is selected. These
are authored inputs, not provider traffic or production-frequency estimates.

After a locked install and build:

```sh
node studies/text-comparison/browser.mjs . /tmp/browser.json /tmp/screens chromium 375
node studies/text-comparison/replay.mjs dist /tmp/cli /tmp/cli.json
```

Omit the browser engine/width arguments to run all four combinations. For long
verification sessions, run each combination separately. The browser script
loads the bundled example and fonts, verifies the bundled license, then
disconnects before the seven cases. It checks complete downloads, literal
changes, keyboard focus, both-theme accessibility, exported offline reports,
and served asset bytes. It does not test reloading the app without a network.

The independent `oracle.mjs` (Node 24+) reconstructs both original texts from
the preview rows and omitted source intervals. It checks 400 seeded mutations
and all first-to-later-member pairs in the 240 pinned terminal snapshots from
the [public trajectory audit](../duplicate-evidence/README.md), including
members beyond the first 20 browser controls. It verifies original and
reconstructed source hashes before use:

```sh
node studies/text-comparison/oracle.mjs . /path/to/reconstruction /tmp/oracle.json
```

The reconstruction directory contains `reconstruction.json` and `bodies/` from
the earlier study. Original public trajectories must be in
`studies/real-trajectories/cache/`. Corpus data is not embedded in these receipts.
The oracle proves faithful completed previews, not a minimal edit script or
semantic removability. Timeout fallback counts can vary across machines.

This is a source browser feature. No hosted deployment or npm release is part
of this change. Clean-build and installed-artifact results are retained below
after verification.
