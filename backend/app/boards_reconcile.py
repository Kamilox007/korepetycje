"""Merging Excalidraw elements on the server.

A pure function, no FastAPI, no database, no global state - so it can be
tested on its own and the same rule can be reasoned about on both ends.

The rule mirrors `shouldDiscardRemoteElement` in Excalidraw's own
data/reconcile.ts (verified against @excalidraw/excalidraw 0.18.1): the
higher `version` wins; on a tie the LOWER `versionNonce` wins. Deterministic,
and independent of the order packets arrive in, which is what lets two or
three people draw at once without a CRDT.

Elements flagged `isDeleted: true` are kept. Excalidraw deletes by flag, not
by removal, and the flag rides on a version bump like any other edit: drop
the element here and the deletion "loses" to whoever still has the old copy.
"""
import random
from typing import Any

Element = dict[str, Any]


def _num(value: Any) -> int:
    """Version fields as an int, with anything odd (None, a string, a float
    from a broken client) counting as 0 rather than blowing up the room."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _rank(el: Element) -> tuple[int, int]:
    # Negated nonce so that a plain tuple comparison picks the lower one.
    return (_num(el.get("version")), -_num(el.get("versionNonce")))


def valid_order_key(index: Any) -> bool:
    """Is `index` a fractional index Excalidraw can parse?

    The first character encodes how long the integer part is ('a' -> 1 digit
    after it, 'b' -> 2, ... and mirrored for 'Z'..'A'), so "b9" or "d1" are
    too short and Excalidraw's getIntegerPart raises "invalid order key" on
    them. It raises inside the pointer handler, which kills drawing for
    everyone holding that element - see sanitize_index below.
    """
    if not isinstance(index, str) or not index:
        return False
    head = index[0]
    if "a" <= head <= "z":
        needed = ord(head) - ord("a") + 2
    elif "A" <= head <= "Z":
        needed = ord("Z") - ord(head) + 2
    else:
        return False
    if len(index) < needed:
        return False
    return all(c.isdigit() or "a" <= c <= "z" or "A" <= c <= "Z" for c in index)


def sanitize_index(el: Element) -> Element:
    """Strip an unparseable `index`, keeping the element itself.

    A client that sends one poisons the page for everybody: Excalidraw throws
    on every freedraw pointerdown, so nobody can draw, and every client that
    still holds the element re-uploads it after the next reconnect. Without
    `index` Excalidraw simply generates a fresh one on load, which is the
    cheap, lossless way out.
    """
    if "index" in el and not valid_order_key(el.get("index")):
        return {k: v for k, v in el.items() if k != "index"}
    return el


def wins(incoming: Element, current: Element | None) -> bool:
    """Should `incoming` replace `current`? True when there is nothing to replace."""
    if current is None:
        return True
    return _rank(incoming) > _rank(current)


def reconcile(current: dict[str, Element], incoming: list[Element]) -> list[Element]:
    """Merge `incoming` into `current` (keyed by element id), in place.

    Returns the elements that actually changed the state - the ones to
    broadcast to the other clients and the reason to mark the page dirty.
    Feeding the same elements twice returns an empty list.
    """
    changed: list[Element] = []
    for el in incoming:
        el_id = el.get("id")
        if not isinstance(el_id, str) or not el_id:
            continue
        el = sanitize_index(el)
        if wins(el, current.get(el_id)):
            current[el_id] = el
            changed.append(el)
    return changed


def _order_key(el: Element) -> tuple[int, str, str]:
    # Excalidraw's orderByFractionalIndex: by `index`, ties by id. Elements
    # without an index (should not happen with 0.18+, but be tolerant) sink to
    # the end in a stable way instead of raising.
    index = el.get("index")
    if isinstance(index, str):
        return (0, index, str(el.get("id", "")))
    return (1, "", str(el.get("id", "")))


def ordered(current: dict[str, Element]) -> list[Element]:
    """The state as a list in drawing order - what gets stored and sent as `init`."""
    return sorted(current.values(), key=_order_key)


def contains_data_url(elements: list[Element]) -> bool:
    """Guard for decision 2.4: image bytes belong on disk, never in a scene.

    Excalidraw keeps files outside `elements`, so this should never fire for a
    well-behaved client; it exists so a hand-crafted payload cannot push
    megabytes of base64 into the database and the Litestream WAL.
    """
    def walk(value: Any) -> bool:
        if isinstance(value, str):
            return value.startswith("data:")
        if isinstance(value, dict):
            return any(walk(v) for v in value.values())
        if isinstance(value, list):
            return any(walk(v) for v in value)
        return False

    return walk(elements)


def restore_update(current: dict[str, Element], snapshot: list[Element]) -> list[Element]:
    """The update that turns `current` into `snapshot` and WINS everywhere.

    A snapshot's elements are older than what everyone holds now, so merging
    them as-is would lose on `version`. Instead each restored element gets a
    version above anything seen so far (and a fresh nonce), and every element
    that exists now but not in the snapshot is re-sent as deleted with the
    same bump. Applying the result through the normal merge - in the room,
    on every client, in the database - lands the snapshot state without any
    special "replace all" path.
    """
    top = max((_num(e.get("version")) for e in current.values()), default=0)
    top = max(top, max((_num(e.get("version")) for e in snapshot), default=0)) + 1
    update: list[Element] = []
    seen: set[str] = set()
    for el in snapshot:
        el_id = el.get("id")
        if not isinstance(el_id, str) or not el_id:
            continue
        seen.add(el_id)
        update.append({**el, "version": top, "versionNonce": random.randrange(1, 2**31)})
    for el_id, el in current.items():
        if el_id in seen or el.get("isDeleted"):
            continue
        update.append({**el, "isDeleted": True, "version": top,
                       "versionNonce": random.randrange(1, 2**31)})
    return update
