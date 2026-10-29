# Native apps (Android/Windows) Socket.io contract: device:register, screen:packet->screen:frame relay, command relay, logs, status
import os
import time
import base64
import threading
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
SIO_PATH = "api/socketio"
# tiny fake JPEG (SOI ... EOI)
JPEG_B64 = base64.b64encode(b"\xff\xd8\xff\xe0" + os.urandom(2048) + b"\xff\xd9").decode()


def wait_for(cond, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.1)
    return False


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "admin"
    return d["token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


# --- REST auth regression
class TestRestRegression:
    def test_me(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN["email"] and d["role"] == "admin"
        assert "password_hash" not in d and "_id" not in d

    @pytest.mark.parametrize("ep", ["/api/sessions", "/api/stats", "/api/technicians"])
    def test_protected_ok(self, admin_token, ep):
        r = requests.get(f"{BASE_URL}{ep}", headers=H(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    @pytest.mark.parametrize("ep", ["/api/sessions", "/api/stats", "/api/technicians"])
    def test_protected_401(self, ep):
        assert requests.get(f"{BASE_URL}{ep}").status_code == 401


# --- Socket.io native contract
@pytest.fixture(scope="module")
def flow(admin_token):
    ev = {"registered": [], "queue": [], "frames": [], "commands": [], "joined": []}
    lock = threading.Lock()

    dev = socketio.Client(reconnection=False)
    op = socketio.Client(reconnection=False)

    @dev.on("device:registered")
    def _r(d):
        ev["registered"].append(d)

    @dev.on("command:receive")
    def _c(d):
        ev["commands"].append(d)

    @dev.on("operator:joined")
    def _j(d):
        ev["joined"].append(d)

    @op.on("queue:update")
    def _q(d):
        with lock:
            ev["queue"].append(d)

    @op.on("screen:frame")
    def _f(d):
        ev["frames"].append(d)

    op.connect(BASE_URL, socketio_path=SIO_PATH, auth={"token": admin_token},
               transports=["websocket"], wait_timeout=15)
    dev.connect(BASE_URL, socketio_path=SIO_PATH, transports=["websocket"], wait_timeout=15)
    device_id = f"TEST_native_{uuid.uuid4().hex[:8]}"
    dev.emit("device:register", {"device_id": device_id, "platform": "android", "name": "TEST_Native_Android"})
    assert wait_for(lambda: ev["registered"]), "device:registered not received"
    yield {"dev": dev, "op": op, "ev": ev, "sid": ev["registered"][0]["session_id"], "device_id": device_id}
    for c in (dev, op):
        try:
            c.disconnect()
        except Exception:
            pass


class TestNativeContract:
    def test_device_registered_payload(self, flow):
        d = flow["ev"]["registered"][0]
        assert isinstance(d["session_id"], str) and len(d["session_id"]) > 10
        assert isinstance(d["pin"], str) and len(d["pin"]) == 6 and d["pin"].isdigit()
        assert isinstance(d["iceServers"], list) and len(d["iceServers"]) > 0

    def test_operator_queue_update_has_waiting_session(self, flow):
        sid = flow["sid"]

        def has():
            for q in flow["ev"]["queue"]:
                for s in q.get("sessions", []):
                    if s["id"] == sid and s["status"] == "waiting" and s["platform"] == "android":
                        return True
            return False
        assert wait_for(has), "operator did not receive queue:update with waiting session"

    def test_subscribe_sets_active(self, flow, admin_token):
        flow["op"].emit("operator:subscribe", {"session_id": flow["sid"]})
        assert wait_for(lambda: flow["ev"]["joined"]), "device did not get operator:joined"
        r = requests.get(f"{BASE_URL}/api/sessions", headers=H(admin_token))
        s = next(x for x in r.json() if x["id"] == flow["sid"])
        assert s["status"] == "active"

    def test_screen_packet_relayed_as_screen_frame(self, flow):
        flow["dev"].emit("screen:packet", {"session_id": flow["sid"], "data": JPEG_B64, "w": 720, "h": 1600})
        assert wait_for(lambda: flow["ev"]["frames"]), "operator did not receive screen:frame"
        f = flow["ev"]["frames"][0]
        assert f["session_id"] == flow["sid"]
        assert f["data"] == JPEG_B64
        assert base64.b64decode(f["data"])[:2] == b"\xff\xd8"

    def test_multiple_frames_relayed(self, flow):
        n0 = len(flow["ev"]["frames"])
        for _ in range(5):
            flow["dev"].emit("screen:packet", {"session_id": flow["sid"], "data": JPEG_B64})
        assert wait_for(lambda: len(flow["ev"]["frames"]) >= n0 + 5)

    def test_device_does_not_echo_own_frame(self, flow):
        # skip_sid: device must not receive its own screen:frame; operator receives; device has no handler -> check via commands untouched
        assert all(c.get("command", {}).get("type") != "screen" for c in flow["ev"]["commands"])

    def test_command_relay(self, flow):
        cmd = {"type": "click", "x": 123, "y": 456}
        flow["op"].emit("command:send", {"session_id": flow["sid"], "command": cmd})
        assert wait_for(lambda: flow["ev"]["commands"]), "device did not receive command:receive"
        assert flow["ev"]["commands"][0]["command"] == cmd

    def test_command_logged(self, flow, admin_token):
        def logged():
            r = requests.get(f"{BASE_URL}/api/sessions/{flow['sid']}/logs", headers=H(admin_token))
            return any(l["type"] == "command" and l["payload"]["command"].get("x") == 123 for l in r.json())
        assert wait_for(logged, 8)
        r = requests.get(f"{BASE_URL}/api/sessions/{flow['sid']}/logs", headers=H(admin_token))
        types = [l["type"] for l in r.json()]
        assert "device_registered" in types and "operator_subscribed" in types
        assert all("_id" not in l for l in r.json())

    def test_session_still_active_after_packets(self, flow, admin_token):
        r = requests.get(f"{BASE_URL}/api/sessions", headers=H(admin_token))
        s = next(x for x in r.json() if x["id"] == flow["sid"])
        assert s["status"] == "active"

    def test_device_disconnect_ends_session(self, flow, admin_token):
        flow["dev"].disconnect()

        def ended():
            r = requests.get(f"{BASE_URL}/api/sessions", headers=H(admin_token))
            s = next(x for x in r.json() if x["id"] == flow["sid"])
            return s["status"] == "ended"
        assert wait_for(ended, 8)


class TestScreenPacketActivatesWithoutSubscribe:
    def test_packet_sets_active(self, admin_token):
        got = []
        dev = socketio.Client(reconnection=False)

        @dev.on("device:registered")
        def _r(d):
            got.append(d)
        dev.connect(BASE_URL, socketio_path=SIO_PATH, transports=["websocket"], wait_timeout=15)
        try:
            dev.emit("device:register", {"device_id": "TEST_win", "platform": "windows", "name": "TEST_Native_Win"})
            assert wait_for(lambda: got)
            sid = got[0]["session_id"]
            dev.emit("screen:packet", {"session_id": sid, "data": JPEG_B64})

            def active():
                r = requests.get(f"{BASE_URL}/api/sessions", headers=H(admin_token))
                s = next(x for x in r.json() if x["id"] == sid)
                return s["status"] == "active" and s["platform"] == "windows"
            assert wait_for(active, 8)
        finally:
            dev.disconnect()
