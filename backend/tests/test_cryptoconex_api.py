# Crypto Conex regression tests: auth (login/me/register/roles), sessions/stats/technicians, Socket.io signaling flow
import os
import time
import uuid
import pytest
import requests
import socketio

def _load_base():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip()
    return url.rstrip("/")

BASE_URL = _load_base()
ADMIN = {"email": "admin@cryptoconex.com", "password": "Conex@2026"}
TECH = {"email": "tech1@cryptoconex.com", "password": "Tech@1234", "name": "Tecnico Um", "role": "technician"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    if r.status_code != 200:
        pytest.skip("admin login failed")
    return r.json()["token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


# --- Auth
class TestAuth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200 and "online" in r.json()["message"]

    def test_admin_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["token"], str) and len(d["token"]) > 20
        assert d["user"]["role"] == "admin"
        assert d["user"]["email"] == ADMIN["email"]
        assert "password_hash" not in d["user"]

    def test_login_wrong_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN["email"], "password": "bad"})
        assert r.status_code == 401
        assert "detail" in r.json()

    def test_login_case_insensitive_email(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN["email"].upper(), "password": ADMIN["password"]})
        assert r.status_code == 200

    def test_me(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN["email"] and d["role"] == "admin"
        assert "password_hash" not in d and "_id" not in d

    def test_me_no_token(self):
        assert requests.get(f"{BASE_URL}/api/auth/me").status_code == 401

    def test_me_bad_token(self):
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=H("abc.def.ghi")).status_code == 401

    def test_register_technician_and_login(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/auth/register", json=TECH, headers=H(admin_token))
        assert r.status_code in (200, 400), r.text
        if r.status_code == 200:
            d = r.json()
            assert d["email"] == TECH["email"] and d["role"] == "technician" and d["name"] == TECH["name"]
        else:
            assert "cadastrado" in r.json()["detail"]
        lr = requests.post(f"{BASE_URL}/api/auth/login", json={"email": TECH["email"], "password": TECH["password"]})
        assert lr.status_code == 200
        assert lr.json()["user"]["role"] == "technician"

    def test_register_duplicate(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/auth/register", json=TECH, headers=H(admin_token))
        assert r.status_code == 400

    def test_register_requires_admin(self):
        lr = requests.post(f"{BASE_URL}/api/auth/login", json={"email": TECH["email"], "password": TECH["password"]})
        tok = lr.json()["token"]
        r = requests.post(f"{BASE_URL}/api/auth/register", headers=H(tok), json={
            "email": f"test_{uuid.uuid4().hex[:6]}@cryptoconex.com", "password": "abcdef", "name": "X"})
        assert r.status_code == 403

    def test_register_unauthenticated(self):
        r = requests.post(f"{BASE_URL}/api/auth/register", json=TECH)
        assert r.status_code == 401

    def test_register_validation(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/auth/register", headers=H(admin_token),
                          json={"email": "notanemail", "password": "1", "name": "X"})
        assert r.status_code == 422


# --- Data endpoints
class TestData:
    def test_sessions(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/sessions", headers=H(admin_token))
        assert r.status_code == 200 and isinstance(r.json(), list)
        for s in r.json()[:5]:
            assert "_id" not in s and "id" in s and "status" in s

    def test_stats(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/stats", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        for k in ["waiting", "active", "assigned", "ended", "technicians", "online_operators"]:
            assert isinstance(d[k], int)
        assert d["technicians"] >= 1

    def test_technicians(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/technicians", headers=H(admin_token))
        assert r.status_code == 200
        techs = r.json()
        assert any(t["email"] == TECH["email"] for t in techs)
        for t in techs:
            assert "password_hash" not in t and "_id" not in t and isinstance(t["online"], bool)

    def test_ice(self):
        r = requests.get(f"{BASE_URL}/api/config/ice")
        assert r.status_code == 200 and len(r.json()["iceServers"]) > 0

    def test_protected_without_auth(self):
        for p in ["/api/sessions", "/api/stats", "/api/technicians"]:
            assert requests.get(f"{BASE_URL}{p}").status_code == 401


# --- Socket.io full flow
class TestSocketFlow:
    def test_full_flow(self, admin_token):
        tech_login = requests.post(f"{BASE_URL}/api/auth/login",
                                   json={"email": TECH["email"], "password": TECH["password"]}).json()
        tech_id = tech_login["user"]["id"]
        tech_token = tech_login["token"]

        op = socketio.Client()
        tech = socketio.Client()
        dev = socketio.Client()
        got = {"queue": [], "cmd": [], "joined": [], "reg": None, "assigned_to_you": [], "offer": [], "tech_queue": []}
        op.on("queue:update", lambda d: got["queue"].append(d))
        op.on("rtc:offer", lambda d: got["offer"].append(d))
        tech.on("session:assigned-to-you", lambda d: got["assigned_to_you"].append(d))
        tech.on("queue:update", lambda d: got["tech_queue"].append(d))
        dev.on("device:registered", lambda d: got.__setitem__("reg", d))
        dev.on("command:receive", lambda d: got["cmd"].append(d))
        dev.on("operator:joined", lambda d: got["joined"].append(d))
        try:
            op.connect(BASE_URL, socketio_path="api/socketio", auth={"token": admin_token}, transports=["websocket"])
            tech.connect(BASE_URL, socketio_path="api/socketio", auth={"token": tech_token}, transports=["websocket"])
            dev.connect(BASE_URL, socketio_path="api/socketio", transports=["websocket"])
            time.sleep(1)
            dev.emit("device:register", {"device_id": "TEST_dev_" + uuid.uuid4().hex[:6], "platform": "web", "name": "TEST_Device"})
            time.sleep(2)
            assert got["reg"] and got["reg"]["session_id"] and len(got["reg"]["pin"]) == 6
            sid = got["reg"]["session_id"]
            assert any(s["id"] == sid and s["status"] == "waiting" for q in got["queue"] for s in q["sessions"])

            # online technicians reported
            techs = requests.get(f"{BASE_URL}/api/technicians", headers=H(admin_token)).json()
            assert any(t["id"] == tech_id and t["online"] for t in techs)

            op.emit("session:assign", {"session_id": sid, "technician_id": tech_id})
            time.sleep(1.5)
            assert any(a["session_id"] == sid for a in got["assigned_to_you"])
            last = [s for s in got["queue"][-1]["sessions"] if s["id"] == sid][0]
            assert last["status"] == "assigned" and last["assigned_to"] == tech_id

            # tech sees own session via REST
            ts = requests.get(f"{BASE_URL}/api/sessions", headers=H(tech_token)).json()
            assert any(s["id"] == sid for s in ts)

            op.emit("operator:subscribe", {"session_id": sid})
            time.sleep(1.5)
            assert any(j["session_id"] == sid for j in got["joined"])

            # signaling relay device -> operator
            dev.emit("rtc:offer", {"session_id": sid, "sdp": {"type": "offer", "sdp": "x"}})
            time.sleep(1)
            assert any(o["session_id"] == sid for o in got["offer"])

            op.emit("command:send", {"session_id": sid, "command": {"type": "message", "text": "TEST_hi"}})
            op.emit("command:send", {"session_id": sid, "command": {"type": "click", "x": 1, "y": 2}})
            time.sleep(1.5)
            types = [c["command"]["type"] for c in got["cmd"]]
            assert "message" in types and "click" in types

            logs = requests.get(f"{BASE_URL}/api/sessions/{sid}/logs", headers=H(admin_token)).json()
            ltypes = [l["type"] for l in logs]
            for t in ["device_registered", "session_assigned", "operator_subscribed", "command"]:
                assert t in ltypes
            assert all("_id" not in l for l in logs)

            dev.disconnect()
            time.sleep(1.5)
            sess = requests.get(f"{BASE_URL}/api/sessions", headers=H(admin_token)).json()
            assert [s for s in sess if s["id"] == sid][0]["status"] == "ended"
        finally:
            for c in (op, tech, dev):
                try:
                    c.disconnect()
                except Exception:
                    pass

    def test_invalid_token_rejected(self):
        c = socketio.Client()
        with pytest.raises(Exception):
            c.connect(BASE_URL, socketio_path="api/socketio", auth={"token": "bad"}, transports=["websocket"], wait_timeout=5)
        try:
            c.disconnect()
        except Exception:
            pass
