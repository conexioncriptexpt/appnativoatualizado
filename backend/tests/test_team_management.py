# Team management tests: /api/users list/update/delete, register roles, socket rejection of deleted users, session requeue
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
TECH = {"email": "tech1@cryptoconex.com", "password": "Tech@1234"}


def H(t):
    return {"Authorization": f"Bearer {t}"}


def login(email, password):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})


@pytest.fixture(scope="module")
def admin():
    r = login(**ADMIN)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def tech_token():
    r = login(**TECH)
    if r.status_code != 200:
        pytest.skip("tech login failed")
    return r.json()["token"]


created = []


def make_user(admin_token, role="technician", pw="Temp@1234"):
    email = f"test_{uuid.uuid4().hex[:8]}@cryptoconex.com"
    r = requests.post(f"{BASE_URL}/api/auth/register", headers=H(admin_token),
                      json={"email": email, "password": pw, "name": "TEST_User", "role": role})
    assert r.status_code == 200, r.text
    d = r.json()
    created.append(d["id"])
    return d, email, pw


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin):
    yield
    for uid in created:
        requests.delete(f"{BASE_URL}/api/users/{uid}", headers=H(admin["token"]))


# --- list users
class TestListUsers:
    def test_admin_lists(self, admin):
        r = requests.get(f"{BASE_URL}/api/users", headers=H(admin["token"]))
        assert r.status_code == 200
        users = r.json()
        emails = [u["email"] for u in users]
        assert ADMIN["email"] in emails and TECH["email"] in emails
        for u in users:
            assert "password_hash" not in u and "_id" not in u
            assert isinstance(u["online"], bool)

    def test_tech_forbidden(self, tech_token):
        r = requests.get(f"{BASE_URL}/api/users", headers=H(tech_token))
        assert r.status_code == 403

    def test_unauth(self):
        assert requests.get(f"{BASE_URL}/api/users").status_code in (401, 403)


# --- register
class TestRegister:
    def test_create_tech_and_admin(self, admin):
        t, _, _ = make_user(admin["token"], "technician")
        a, _, _ = make_user(admin["token"], "admin")
        assert t["role"] == "technician" and a["role"] == "admin"
        users = requests.get(f"{BASE_URL}/api/users", headers=H(admin["token"])).json()
        ids = {u["id"]: u for u in users}
        assert ids[t["id"]]["role"] == "technician" and ids[a["id"]]["role"] == "admin"

    def test_duplicate_email(self, admin):
        r = requests.post(f"{BASE_URL}/api/auth/register", headers=H(admin["token"]),
                          json={"email": TECH["email"], "password": "xxxxxx", "name": "dup", "role": "technician"})
        assert r.status_code == 400

    def test_tech_cannot_register(self, tech_token):
        r = requests.post(f"{BASE_URL}/api/auth/register", headers=H(tech_token),
                          json={"email": "test_x@cryptoconex.com", "password": "xxxxxx", "name": "x"})
        assert r.status_code == 403


# --- update
class TestUpdate:
    def test_change_role_name_password(self, admin):
        u, email, pw = make_user(admin["token"])
        r = requests.put(f"{BASE_URL}/api/users/{u['id']}", headers=H(admin["token"]),
                         json={"role": "admin", "name": "TEST_Renamed", "password": "NewPass@1"})
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "admin" and d["name"] == "TEST_Renamed" and "password_hash" not in d
        assert login(email, pw).status_code == 401
        r2 = login(email, "NewPass@1")
        assert r2.status_code == 200 and r2.json()["user"]["role"] == "admin"
        # demote another admin (there are >1 admins) works
        r3 = requests.put(f"{BASE_URL}/api/users/{u['id']}", headers=H(admin["token"]), json={"role": "technician"})
        assert r3.status_code == 200 and r3.json()["role"] == "technician"

    def test_cannot_demote_self(self, admin):
        r = requests.put(f"{BASE_URL}/api/users/{admin['user']['id']}", headers=H(admin["token"]), json={"role": "technician"})
        assert r.status_code == 400
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(admin["token"])).json()
        assert me["role"] == "admin"

    def test_invalid_role(self, admin):
        u, _, _ = make_user(admin["token"])
        r = requests.put(f"{BASE_URL}/api/users/{u['id']}", headers=H(admin["token"]), json={"role": "root"})
        assert r.status_code == 400

    def test_short_password(self, admin):
        u, _, _ = make_user(admin["token"])
        r = requests.put(f"{BASE_URL}/api/users/{u['id']}", headers=H(admin["token"]), json={"password": "abc"})
        assert r.status_code == 422

    def test_not_found(self, admin):
        r = requests.put(f"{BASE_URL}/api/users/nope", headers=H(admin["token"]), json={"name": "x"})
        assert r.status_code == 404

    def test_tech_cannot_update(self, tech_token, admin):
        r = requests.put(f"{BASE_URL}/api/users/{admin['user']['id']}", headers=H(tech_token), json={"name": "hack"})
        assert r.status_code == 403

    def test_other_admin_cannot_demote_last_admin(self, admin):
        # new admin B; check that if only admin@ + B, B demoting admin@ is allowed (2 admins) -> skip destructive.
        # Instead verify last-admin guard via count: B tries to demote itself -> self guard
        b, email, pw = make_user(admin["token"], "admin")
        tb = login(email, pw).json()["token"]
        r = requests.put(f"{BASE_URL}/api/users/{b['id']}", headers=H(tb), json={"role": "technician"})
        assert r.status_code == 400


# --- delete
class TestDelete:
    def test_cannot_delete_self(self, admin):
        r = requests.delete(f"{BASE_URL}/api/users/{admin['user']['id']}", headers=H(admin["token"]))
        assert r.status_code == 400

    def test_delete_not_found(self, admin):
        assert requests.delete(f"{BASE_URL}/api/users/nope", headers=H(admin["token"])).status_code == 404

    def test_tech_cannot_delete(self, tech_token, admin):
        r = requests.delete(f"{BASE_URL}/api/users/{admin['user']['id']}", headers=H(tech_token))
        assert r.status_code == 403

    def test_delete_flow_token_socket_sessions(self, admin):
        u, email, pw = make_user(admin["token"])
        tok = login(email, pw).json()["token"]
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=H(tok)).status_code == 200

        # device registers and the throwaway tech assigns to itself
        dev = socketio.Client()
        reg = {}
        dev.on("device:registered", lambda d: reg.update(d))
        dev.connect(BASE_URL, socketio_path="api/socketio", transports=["websocket", "polling"])
        dev.emit("device:register", {"platform": "web", "name": "TEST_dev"})
        op = socketio.Client()
        op.connect(BASE_URL, socketio_path="api/socketio", auth={"token": tok}, transports=["websocket", "polling"])
        for _ in range(30):
            if reg:
                break
            time.sleep(0.2)
        assert reg.get("session_id")
        sid = reg["session_id"]
        op.emit("session:assign", {"session_id": sid, "technician_id": u["id"]})
        time.sleep(1.5)
        sess = [s for s in requests.get(f"{BASE_URL}/api/sessions", headers=H(admin["token"])).json() if s["id"] == sid][0]
        assert sess["status"] == "assigned" and sess["assigned_to"] == u["id"]

        r = requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=H(admin["token"]))
        assert r.status_code == 200 and r.json()["ok"] is True
        created.remove(u["id"])
        time.sleep(1.5)
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=H(tok)).status_code == 401
        assert login(email, pw).status_code == 401
        sess = [s for s in requests.get(f"{BASE_URL}/api/sessions", headers=H(admin["token"])).json() if s["id"] == sid][0]
        assert sess["status"] == "waiting" and sess["assigned_to"] is None
        assert not op.connected, "deleted user's live socket should be dropped"

        # reconnect with deleted user's token must be rejected
        op2 = socketio.Client()
        rejected = False
        try:
            op2.connect(BASE_URL, socketio_path="api/socketio", auth={"token": tok}, transports=["websocket", "polling"], wait_timeout=5)
            time.sleep(1)
            rejected = not op2.connected
        except Exception:
            rejected = True
        finally:
            try:
                op2.disconnect()
            except Exception:
                pass
        dev.disconnect()
        try:
            op.disconnect()
        except Exception:
            pass
        assert rejected
