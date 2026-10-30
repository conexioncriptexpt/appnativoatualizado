# Device registry tests: GET/PUT/DELETE /api/devices + socket device:register upsert
import os, time, uuid
import pytest, requests, socketio

BASE_URL = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0].rstrip("/")
API = f"{BASE_URL}/api"


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def admin():
    return login("admin@cryptoconex.com", "Conex@2026")


@pytest.fixture(scope="module")
def tech():
    return login("tech1@cryptoconex.com", "Tech@1234")


class Sim:
    # retries because preview ingress sometimes drops a fresh WS right after connect (~8%)
    def __init__(self, device_id, name, platform="android"):
        self.state = {}
        self.attempts = 0
        for _ in range(3):
            self.attempts += 1
            self.c = socketio.Client()
            self.c.on("device:registered", lambda x: self.state.update(x))
            self.c.connect(BASE_URL, socketio_path="api/socketio", transports=["websocket"], wait_timeout=10)
            self.c.emit("device:register", {"device_id": device_id, "platform": platform, "name": name})
            for _ in range(40):
                if "session_id" in self.state:
                    break
                time.sleep(0.1)
            if "session_id" in self.state:
                break
            self.c.disconnect()
        assert "session_id" in self.state

    def close(self):
        self.c.disconnect()
        time.sleep(0.8)


class Operator:
    def __init__(self, headers):
        self.queue = []
        self.c = socketio.Client()
        self.c.on("queue:update", lambda x: self.queue.append(x["sessions"]))
        self.c.connect(BASE_URL, socketio_path="api/socketio", transports=["websocket"],
                       auth={"token": headers["Authorization"][7:]}, wait_timeout=10)
        time.sleep(0.5)

    def latest_name(self, session_id):
        for s in (self.queue[-1] if self.queue else []):
            if s["id"] == session_id:
                return s["name"]


def get_dev(h, did):
    r = requests.get(f"{API}/devices", headers=h)
    assert r.status_code == 200
    return next((d for d in r.json() if d["device_id"] == did), None)


def test_list_devices_shape(admin, tech):
    r = requests.get(f"{API}/devices", headers=tech)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) > 0  # backfilled history
    for k in ["device_id", "platform", "original_name", "custom_name", "display_name",
              "first_seen", "last_seen", "connections", "online"]:
        assert k in data[0], k
    assert "_id" not in data[0]
    assert requests.get(f"{API}/devices").status_code in (401, 403)


def test_register_upsert_and_online(admin):
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    s = Sim(did, "TEST Orig")
    try:
        d = get_dev(admin, did)
        assert d and d["connections"] == s.attempts and d["online"] is True
        assert d["display_name"] == "TEST Orig" and d["custom_name"] is None
    finally:
        s.close()
    d = get_dev(admin, did)
    assert d["online"] is False
    last, prev = d["last_seen"], d["connections"]
    time.sleep(1.1)
    s = Sim(did, "TEST Orig")
    d2 = get_dev(admin, did)
    assert d2["connections"] == prev + s.attempts and d2["online"] is True and d2["last_seen"] > last
    s.close()
    requests.delete(f"{API}/devices/{did}", headers=admin)


def test_rename_permissions_and_404(admin, tech):
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    s = Sim(did, "TEST P"); s.close()
    assert requests.put(f"{API}/devices/{did}", json={"name": "x"}, headers=tech).status_code == 403
    assert requests.delete(f"{API}/devices/{did}", headers=tech).status_code == 403
    assert requests.put(f"{API}/devices/nope-{uuid.uuid4()}", json={"name": "x"}, headers=admin).status_code == 404
    assert requests.delete(f"{API}/devices/nope-{uuid.uuid4()}", headers=admin).status_code == 404
    assert requests.put(f"{API}/devices/{did}", json={"name": ""}, headers=admin).status_code == 422
    assert requests.put(f"{API}/devices/{did}", json={"name": "a" * 61}, headers=admin).status_code == 422
    requests.delete(f"{API}/devices/{did}", headers=admin)


def test_rename_live_updates_queue_and_persists(admin):
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    op = Operator(admin)
    s = Sim(did, "TEST Live")
    sid = s.state["session_id"]
    try:
        r = requests.put(f"{API}/devices/{did}", json={"name": "  TEST Renamed  "}, headers=admin)
        assert r.status_code == 200 and r.json()["display_name"] == "TEST Renamed"
        time.sleep(1)
        assert op.latest_name(sid) == "TEST Renamed"
        d = get_dev(admin, did)
        assert d["custom_name"] == "TEST Renamed" and d["original_name"] == "TEST Live"
        sess = [x for x in requests.get(f"{API}/sessions", headers=admin).json() if x["id"] == sid][0]
        assert sess["name"] == "TEST Renamed"
    finally:
        s.close()
    s2 = Sim(did, "TEST Live")
    sid2 = s2.state["session_id"]
    time.sleep(0.8)
    assert op.latest_name(sid2) == "TEST Renamed"
    s2.close()
    op.c.disconnect()
    requests.delete(f"{API}/devices/{did}", headers=admin)


def test_delete_offline_removes_sessions_and_logs(admin):
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    s = Sim(did, "TEST Del")
    sid = s.state["session_id"]
    s.close()
    assert len(requests.get(f"{API}/sessions/{sid}/logs", headers=admin).json()) > 0
    r = requests.delete(f"{API}/devices/{did}", headers=admin)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert get_dev(admin, did) is None
    assert not [x for x in requests.get(f"{API}/sessions", headers=admin).json() if x["id"] == sid]
    assert requests.get(f"{API}/sessions/{sid}/logs", headers=admin).json() == []
    s = Sim(did, "TEST Del")
    d = get_dev(admin, did)
    assert d["connections"] == s.attempts and d["custom_name"] is None
    s.close()
    requests.delete(f"{API}/devices/{did}", headers=admin)


def test_delete_live_reverts_name_and_reconnect_is_new(admin):
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    op = Operator(admin)
    s = Sim(did, "TEST Orig2")
    sid = s.state["session_id"]
    try:
        requests.put(f"{API}/devices/{did}", json={"name": "TEST Custom2"}, headers=admin)
        time.sleep(0.5)
        assert op.latest_name(sid) == "TEST Custom2"
        assert requests.delete(f"{API}/devices/{did}", headers=admin).status_code == 200
        time.sleep(0.8)
        assert op.latest_name(sid) == "TEST Orig2"  # session still running, original name
        assert get_dev(admin, did) is None
    finally:
        s.close()
    s = Sim(did, "TEST Orig2")
    d = get_dev(admin, did)
    assert d["connections"] == s.attempts and d["custom_name"] is None and d["display_name"] == "TEST Orig2"
    s.close()
    op.c.disconnect()
    requests.delete(f"{API}/devices/{did}", headers=admin)
