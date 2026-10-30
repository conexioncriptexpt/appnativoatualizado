# CRM redesign round: /stats/overview, assistance links, public link, link device flow, PUT /auth/me, register race
import time, uuid
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest, requests, socketio

BASE_URL = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = ("admin@cryptoconex.com", "Conex@2026")
TECH = ("tech1@cryptoconex.com", "Tech@1234")


def login_full(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}")
    j = r.json()
    return {"Authorization": f"Bearer {j['token']}"}, j["user"]


@pytest.fixture(scope="module")
def admin():
    return login_full(*ADMIN)


@pytest.fixture(scope="module")
def tech():
    return login_full(*TECH)


def register_device(device_id, name, link_code=None, keep=False):
    state = {}
    for _ in range(3):
        c = socketio.Client()
        c.on("device:registered", lambda x: state.update(x))
        c.connect(BASE_URL, socketio_path="api/socketio", transports=["websocket"], wait_timeout=10)
        payload = {"device_id": device_id, "platform": "android", "name": name}
        if link_code:
            payload["link_code"] = link_code
        c.emit("device:register", payload)
        for _ in range(40):
            if "session_id" in state:
                break
            time.sleep(0.1)
        if "session_id" in state:
            return c, state
        c.disconnect()
    pytest.fail("device registration failed 3x")


# ---- stats overview
def test_stats_overview(admin):
    h, _ = admin
    r = requests.get(f"{API}/stats/overview", headers=h)
    assert r.status_code == 200
    d = r.json()
    for k in ["total_sessions", "today", "devices", "links", "avg_duration_s", "per_day", "by_platform", "top_technicians"]:
        assert k in d, k
    assert len(d["per_day"]) == 7
    today = datetime.now(ZoneInfo("Europe/Lisbon")).date().isoformat()
    assert d["per_day"][-1]["date"] == today
    assert d["per_day"][-1]["count"] == d["today"]
    assert isinstance(d["by_platform"], dict) and isinstance(d["top_technicians"], list)
    assert requests.get(f"{API}/stats/overview").status_code == 401


# ---- links CRUD + permissions
def test_links_crud_permissions(admin, tech):
    ah, au = admin
    th, tu = tech
    # admin creates for tech
    r = requests.post(f"{API}/links", json={"label": "TEST_link admin->tech", "technician_id": tu["id"]}, headers=ah)
    assert r.status_code == 200, r.text
    l1 = r.json()
    assert l1["technician_id"] == tu["id"] and l1["uses"] == 0 and len(l1["code"]) == 8 and "_id" not in l1
    # tech tries to create for admin -> forced to self
    r = requests.post(f"{API}/links", json={"label": "TEST_link tech", "technician_id": au["id"]}, headers=th)
    assert r.status_code == 200
    l2 = r.json()
    assert l2["technician_id"] == tu["id"]
    # admin own link
    l3 = requests.post(f"{API}/links", json={"label": "TEST_link admin"}, headers=ah).json()
    assert l3["technician_id"] == au["id"]
    # validation
    assert requests.post(f"{API}/links", json={"label": ""}, headers=ah).status_code == 422
    assert requests.post(f"{API}/links", json={"label": "x", "technician_id": "nope"}, headers=ah).status_code == 404
    # listing
    admin_codes = {x["code"] for x in requests.get(f"{API}/links", headers=ah).json()}
    tech_list = requests.get(f"{API}/links", headers=th).json()
    assert {l1["code"], l2["code"], l3["code"]} <= admin_codes
    assert all(x["technician_id"] == tu["id"] for x in tech_list)
    assert l3["code"] not in {x["code"] for x in tech_list}
    # public
    p = requests.get(f"{API}/public/links/{l1['code']}")
    assert p.status_code == 200 and p.json() == {"label": "TEST_link admin->tech", "technician_name": tu["name"]}
    assert requests.get(f"{API}/public/links/zzzzzzzz").status_code == 404
    # delete perms
    assert requests.delete(f"{API}/links/{l3['code']}", headers=th).status_code == 403
    assert requests.delete(f"{API}/links/{l2['code']}", headers=th).status_code == 200
    assert requests.delete(f"{API}/links/{l1['code']}", headers=ah).status_code == 200
    assert requests.delete(f"{API}/links/{l3['code']}", headers=ah).status_code == 200
    assert requests.delete(f"{API}/links/{l3['code']}", headers=ah).status_code == 404
    assert requests.get(f"{API}/public/links/{l1['code']}").status_code == 404


# ---- link device flow
def test_link_device_flow(admin, tech):
    ah, _ = admin
    th, tu = tech
    link = requests.post(f"{API}/links", json={"label": "TEST_D. Maria", "technician_id": tu["id"]}, headers=ah).json()
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    c, st = register_device(did, "Some Phone", link_code=link["code"])
    try:
        sess = [x for x in requests.get(f"{API}/sessions", headers=th).json() if x["id"] == st["session_id"]]
        assert sess, "tech should see its link-assigned session"
        s = sess[0]
        assert s["status"] == "assigned" and s["assigned_to"] == tu["id"]
        assert s["name"] == "TEST_D. Maria" and s["link_code"] == link["code"]
        l = [x for x in requests.get(f"{API}/links", headers=ah).json() if x["code"] == link["code"]][0]
        assert l["uses"] >= 1 and l["last_used"]
    finally:
        c.disconnect()
        time.sleep(0.8)
        requests.delete(f"{API}/devices/{did}", headers=ah)
        requests.delete(f"{API}/links/{link['code']}", headers=ah)


def test_invalid_link_code_falls_back_to_waiting(admin):
    ah, _ = admin
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    c, st = register_device(did, "TEST nolink", link_code="badcode1")
    try:
        s = [x for x in requests.get(f"{API}/sessions", headers=ah).json() if x["id"] == st["session_id"]][0]
        assert s["status"] == "waiting" and s["assigned_to"] is None and s["name"] == "TEST nolink"
    finally:
        c.disconnect()
        time.sleep(0.8)
        requests.delete(f"{API}/devices/{did}", headers=ah)


# ---- PUT /auth/me
def test_update_me_name_and_password(tech):
    th, tu = tech
    orig = tu["name"]
    try:
        r = requests.put(f"{API}/auth/me", json={"name": "TEST Tech Renamed"}, headers=th)
        assert r.status_code == 200 and r.json()["name"] == "TEST Tech Renamed" and "password_hash" not in r.json()
        assert requests.get(f"{API}/auth/me", headers=th).json()["name"] == "TEST Tech Renamed"
    finally:
        requests.put(f"{API}/auth/me", json={"name": orig}, headers=th)
    assert requests.get(f"{API}/auth/me", headers=th).json()["name"] == orig
    bad = requests.put(f"{API}/auth/me", json={"current_password": "wrong", "new_password": "NewPass@1"}, headers=th)
    assert bad.status_code == 400 and bad.json()["detail"] == "A palavra-passe atual está incorreta"
    assert requests.put(f"{API}/auth/me", json={"new_password": "NewPass@1"}, headers=th).status_code == 400
    assert requests.put(f"{API}/auth/me", json={"current_password": TECH[1], "new_password": "123"}, headers=th).status_code == 422
    ok = requests.put(f"{API}/auth/me", json={"current_password": TECH[1], "new_password": "NewPass@1"}, headers=th)
    try:
        assert ok.status_code == 200
        assert requests.post(f"{API}/auth/login", json={"email": TECH[0], "password": "NewPass@1"}).status_code == 200
        assert requests.post(f"{API}/auth/login", json={"email": TECH[0], "password": TECH[1]}).status_code == 401
    finally:
        rv = requests.put(f"{API}/auth/me", json={"current_password": "NewPass@1", "new_password": TECH[1]}, headers=th)
        assert rv.status_code == 200
    assert requests.post(f"{API}/auth/login", json={"email": TECH[0], "password": TECH[1]}).status_code == 200


def test_update_me_whitespace_name(tech):
    th, tu = tech
    r = requests.put(f"{API}/auth/me", json={"name": "   "}, headers=th)
    name_after = requests.get(f"{API}/auth/me", headers=th).json()["name"]
    if name_after != tu["name"]:
        requests.put(f"{API}/auth/me", json={"name": tu["name"]}, headers=th)
    assert name_after == tu["name"], f"whitespace name accepted (status {r.status_code}) -> name became {name_after!r}"


# ---- race regression: rapid connect/register/disconnect cycles leave no open sessions
def test_register_race_no_ghosts(admin):
    ah, _ = admin
    did = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    for i in range(20):
        c = socketio.Client()
        try:
            c.connect(BASE_URL, socketio_path="api/socketio", transports=["websocket"], wait_timeout=10)
            c.emit("device:register", {"device_id": did, "platform": "android", "name": "TEST race"})
            if i % 2:
                time.sleep(0.05)
        except Exception:
            pass
        finally:
            c.disconnect()
    time.sleep(3)
    open_ = [x for x in requests.get(f"{API}/sessions", headers=ah).json()
             if x["device_id"] == did and x["status"] != "ended"]
    requests.delete(f"{API}/devices/{did}", headers=ah)
    assert open_ == [], f"ghost sessions: {len(open_)}"
    left = [x for x in requests.get(f"{API}/sessions", headers=ah).json() if x["device_id"] == did]
    assert left == [], "DELETE /devices should remove all non-live sessions"
