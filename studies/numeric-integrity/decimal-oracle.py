"""Independent decimal equality oracle for the parser's numeric round trip."""
import json
import random
import sys
from decimal import Decimal
from pathlib import Path

mode, path = sys.argv[1:3]
if mode == "generate":
    cases = ["0", "-0", "0.000e99999", "1.000", "10000e-4", "0.10", "1E+3",
             "1e-400", "1e400", "5e-324", "4.9e-324", "1e-323",
             "1.7976931348623157e308", "1.7976931348623158e308", "1.7976931348623159e308"]
    for power in [32, 52, 53, 54, 55, 63, 64, 100]:
        for offset in range(-16, 17):
            number = str(2 ** power + offset)
            cases.extend([number, "-" + number, number + "00e-2"])
    rng = random.Random(20261012)
    for _ in range(600):
        digits = str(rng.randrange(1, 10 ** rng.randrange(2, 60)))
        exponent = rng.randrange(-350, 310)
        cases.append(f"{digits}e{exponent}")
        # Python's shortest float spelling supplies ordinary supported controls.
        value = float(f"{digits}e{exponent}")
        if value != float("inf"):
            cases.append(repr(value))
    Path(path).write_text(json.dumps(list(dict.fromkeys(cases)), indent=2) + "\n")
elif mode == "verify":
    report = json.loads(Path(path).read_text())
    mismatches = []
    counts = {"preserved": 0, "changed": 0, "correct": 0}
    for row in report["results"]:
        expected = Decimal(row["literal"]) == Decimal(row["serialized"])
        counts["preserved" if expected else "changed"] += 1
        counts["correct"] += row["accepted"] == expected
        if row["accepted"] != expected:
            mismatches.append(row)
    result = {"node": report["node"], "mode": report["mode"], "cases": len(report["results"]), **counts, "mismatches": mismatches}
    Path(sys.argv[3]).write_text(json.dumps(result, indent=2) + "\n")
    print({key: value for key, value in result.items() if key != "mismatches"})
    if report["mode"] == "verify":
        assert not mismatches
else:
    raise ValueError(mode)
