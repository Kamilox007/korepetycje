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
from typing import Any

Element = dict[str, Any]


def _rank(el: Element) -> tuple[int, int]:
    # Negated nonce so that a plain tuple comparison picks the lower one.
    return (int(el.get("version", 0)), -int(el.get("versionNonce", 0)))


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
