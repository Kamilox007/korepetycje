"""Regression: board snapshots - the 24 h rule, restore, and retention.

The snapshot is the only defence against a link holder selecting everything
and pressing Delete: the live save then overwrites the page. So the first
write in 24 h must keep the state from BEFORE it, a second write the same
day must not pile up rows, restore must bring the content back even for
people connected live, and the daily job must sweep old rows idempotently.
"""
import sys, pathlib
from datetime import timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models, auth, boards_reconcile

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def el(id, version, nonce, index="a0", **extra):
    return {"id": id, "type": "rectangle", "version": version, "versionNonce": nonce,
            "index": index, "isDeleted": False, **extra}


def snapshots_of(page_id):
    db = SessionLocal()
    try:
        return (db.query(models.BoardSnapshot).filter(models.BoardSnapshot.page_id == page_id)
                .order_by(models.BoardSnapshot.id).all())
    finally:
        db.close()


def age_snapshot(snapshot_id, hours):
    db = SessionLocal()
    try:
        s = db.get(models.BoardSnapshot, snapshot_id)
        s.created_at = auth.utcnow() - timedelta(hours=hours)
        db.commit()
    finally:
        db.close()


def live(elements):
    return {e["id"] for e in elements if not e.get("isDeleted")}


# --- the pure helper: a restore update wins the merge ---
current = {"a": el("a", 5, 1), "b": el("b", 7, 1, index="a1"), "gone": el("gone", 2, 1, isDeleted=True)}
snap = [el("a", 1, 9, x=1), el("c", 1, 9, index="a2")]
update = boards_reconcile.restore_update(current, snap)
boards_reconcile.reconcile(current, update)
check("restore_update: snapshot elements come back with a winning version",
      current["a"]["x"] == 1 and current["a"]["version"] > 7 and "c" in current)
check("restore_update: elements absent from the snapshot are deleted",
      current["b"]["isDeleted"] is True)
check("restore_update: already-deleted elements are left alone",
      all(u["id"] != "gone" for u in update))

with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })
    board = admin.post("/api/boards", json={"title": "Snap"}).json()
    tok = board["path"].removeprefix("/t/")
    p0 = board["pages"][0]["id"]
    guest = TestClient(app)
    put = lambda els: guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": els})

    # --- the 24 h rule ---
    put([el("a", 1, 1)])
    check("writing an empty page takes no snapshot (nothing to protect)", snapshots_of(p0) == [])
    put([el("b", 1, 1, index="a1")])
    snaps = snapshots_of(p0)
    check("first write onto content takes a snapshot", len(snaps) == 1)
    check("...of the state from BEFORE the write", live(snaps[0].elements) == {"a"})
    check("snapshot carries the page title", snaps[0].title == board["pages"][0]["title"])
    put([el("c", 1, 1, index="a2")])
    check("a second write the same day does not add a snapshot", len(snapshots_of(p0)) == 1)
    put([el("a", 1, 1)])
    check("a no-op write does not add one either", len(snapshots_of(p0)) == 1)
    age_snapshot(snaps[0].id, 25)
    put([el("d", 1, 1, index="a3")])
    snaps = snapshots_of(p0)
    check("once the last snapshot is older than 24 h the next write takes a new one", len(snaps) == 2)
    check("...again of the pre-write state", live(snaps[1].elements) == {"a", "b", "c"})

    # --- listing (panel) ---
    r = admin.get(f"/api/boards/{board['id']}/snapshots")
    check("panel lists snapshots, newest first",
          r.status_code == 200 and [s["id"] for s in r.json()] == [snaps[1].id, snaps[0].id])
    check("list carries no elements", "elements" not in r.json()[0])
    check("list carries page_id", r.json()[0]["page_id"] == p0)

    # --- restore, nobody connected ---
    first = snaps[0].id   # state {a}
    r = admin.post(f"/api/boards/{board['id']}/snapshots/{first}/restore")
    check("restore succeeds", r.status_code == 200)
    check("restore answers with the page state", live(r.json()["elements"]) == {"a"})
    page = guest.get(f"/api/t/{tok}/pages/{p0}").json()
    check("after restore the page shows the snapshot's content", live(page["elements"]) == {"a"})
    check("elements added since are kept as deleted, not dropped",
          {e["id"] for e in page["elements"]} == {"a", "b", "c", "d"})
    check("restore itself took a snapshot of the pre-restore state (recoverable)",
          len(snapshots_of(p0)) == 3 and live(snapshots_of(p0)[-1].elements) == {"a", "b", "c", "d"})
    # a stale client re-sending the old copies must not undo the restore
    put([el("b", 1, 1, index="a1"), el("c", 1, 1, index="a2")])
    page = guest.get(f"/api/t/{tok}/pages/{p0}").json()
    check("stale re-sends of restored-away elements lose the merge", live(page["elements"]) == {"a"})

    # --- restore with a live room open ---
    with guest.websocket_connect(f"/api/t/{tok}/ws?page_id={p0}") as ws:
        init = ws.receive_json()
        check("live client sees the restored state", live(init["elements"]) == {"a"})
        second = snaps[1].id  # state {a, b, c}
        r = admin.post(f"/api/boards/{board['id']}/snapshots/{second}/restore")
        check("restore with a room open succeeds", r.status_code == 200)
        msg = ws.receive_json()
        while msg["t"] != "update":
            msg = ws.receive_json()
        check("connected client receives the restore as an update",
              {e["id"] for e in msg["elements"] if not e.get("isDeleted")} >= {"b", "c"})
        page = guest.get(f"/api/t/{tok}/pages/{p0}").json()
        check("restore through the room is persisted right away", live(page["elements"]) == {"a", "b", "c"})

    # --- errors ---
    check("snapshot of another board -> 404",
          admin.post(f"/api/boards/{board['id'] + 999}/snapshots/{first}/restore").status_code == 404)
    other = admin.post("/api/boards", json={"title": "Inna"}).json()
    check("snapshot id under the wrong board -> 404",
          admin.post(f"/api/boards/{other['id']}/snapshots/{first}/restore").status_code == 404)

    # --- retention ---
    old_id = snapshots_of(p0)[0].id
    age_snapshot(old_id, 31 * 24)
    r = admin.post("/api/maintenance/generate-lessons")
    check("daily job reports the swept snapshots", r.json()["board_snapshots_purged"] == 1)
    check("snapshot older than 30 days is gone",
          old_id not in {s.id for s in snapshots_of(p0)})
    check("younger ones stay", len(snapshots_of(p0)) >= 2)
    r = admin.post("/api/maintenance/generate-lessons")
    check("running it again sweeps nothing (idempotent)", r.json()["board_snapshots_purged"] == 0)
    from app.main import _generate_upcoming
    age_snapshot(snapshots_of(p0)[0].id, 31 * 24)
    _generate_upcoming()
    check("the cron entry point sweeps too", len(snapshots_of(p0)) >= 1 and
          all((auth.utcnow() - s.created_at) < timedelta(days=30) for s in snapshots_of(p0)))

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
