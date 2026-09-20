"""Regression: the merge rule for board elements is deterministic and commutative.

No database and no app here - the function under test is pure on purpose.
The rule must match Excalidraw's own reconcile (higher version wins, ties go
to the LOWER versionNonce), otherwise the server and the browser disagree
about who won and the two screens drift apart in silence.
"""
import sys, pathlib, itertools, copy

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from app.boards_reconcile import reconcile, ordered, contains_data_url, wins

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def el(id, version, nonce, index="a0", **extra):
    return {"id": id, "version": version, "versionNonce": nonce, "index": index,
            "isDeleted": False, **extra}


# --- basic precedence ---
state = {}
changed = reconcile(state, [el("r", 1, 500)])
check("a new element is accepted", [c["id"] for c in changed] == ["r"] and "r" in state)
changed = reconcile(state, [el("r", 1, 500)])
check("feeding the same element again changes nothing (idempotent)", changed == [])
changed = reconcile(state, [el("r", 3, 999, x=10)])
check("a higher version replaces", changed and state["r"]["x"] == 10)
changed = reconcile(state, [el("r", 2, 1, x=20)])
check("a lower version does not, whatever the nonce", changed == [] and state["r"]["x"] == 10)

state = {"t": el("t", 5, 700, text="A")}
reconcile(state, [el("t", 5, 300, text="B")])
check("same version: the LOWER versionNonce wins", state["t"]["text"] == "B")
reconcile(state, [el("t", 5, 900, text="C")])
check("and a higher nonce at the same version loses", state["t"]["text"] == "B")

check("wins() with no current element is True", wins(el("x", 1, 1), None))

# --- deletions survive ---
state = {"d": el("d", 1, 100)}
reconcile(state, [el("d", 2, 100, isDeleted=True)])
check("a deletion (isDeleted on a version bump) lands", state["d"]["isDeleted"] is True)
reconcile(state, [el("d", 1, 100)])
check("and the stale live copy does not resurrect it", state["d"]["isDeleted"] is True)
check("deleted elements stay in the state, not dropped", "d" in state)

# --- order independence ---
batches = [
    [el("a", 1, 10), el("b", 2, 20, x=1)],
    [el("b", 2, 5, x=2), el("c", 1, 1)],
    [el("a", 3, 99, x=3), el("c", 1, 1)],
]
results = []
for perm in itertools.permutations(batches):
    s = {}
    for batch in perm:
        reconcile(s, copy.deepcopy(batch))
    results.append(ordered(s))
check("three batches merged in any order give the same state",
      all(r == results[0] for r in results))
final = {e["id"]: e for e in results[0]}
check("...with the expected winners",
      final["a"]["x"] == 3 and final["b"]["x"] == 2 and "c" in final)

# --- determinism across repeated runs ---
s1, s2 = {}, {}
for batch in batches:
    reconcile(s1, copy.deepcopy(batch))
    reconcile(s2, copy.deepcopy(batch))
check("same input twice, same output", ordered(s1) == ordered(s2))

# --- ordering ---
state = {}
reconcile(state, [el("z", 1, 1, index="a2"), el("y", 1, 1, index="a0"), el("x", 1, 1, index="a1")])
check("ordered() sorts by fractional index", [e["id"] for e in ordered(state)] == ["y", "x", "z"])
reconcile(state, [el("w", 1, 1, index="a1")])
check("equal index: ties broken by id", [e["id"] for e in ordered(state)] == ["y", "w", "x", "z"])
noidx = el("n", 1, 1)
del noidx["index"]
reconcile(state, [noidx])
check("an element without index sinks to the end instead of raising",
      [e["id"] for e in ordered(state)][-1] == "n")

# --- garbage tolerance ---
state = {}
changed = reconcile(state, [{"version": 1, "versionNonce": 1}, {"id": "", "version": 1}])
check("elements without an id are ignored", changed == [] and state == {})
state = {"v": {"id": "v"}}
reconcile(state, [{"id": "v", "version": 1, "versionNonce": 1, "ok": True}])
check("missing version/versionNonce count as 0", state["v"].get("ok") is True)

# --- data URL guard ---
check("plain scene has no data URL", not contains_data_url([el("a", 1, 1)]))
check("data URL at top level is caught",
      contains_data_url([el("a", 1, 1, link="data:image/png;base64,AAAA")]))
check("data URL nested in a list/dict is caught",
      contains_data_url([el("a", 1, 1, customData={"blobs": ["x", "data:text/plain,hi"]})]))
check("https link is fine", not contains_data_url([el("a", 1, 1, link="https://x.pl")]))

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
