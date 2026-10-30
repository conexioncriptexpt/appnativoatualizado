# Remote-control device simulator (preview): registers qa-rc, streams 540x960 JPEG every 300ms, logs command:receive to /tmp/rc_cmds.jsonl
import time, sys, io, json, base64, socketio
from PIL import Image, ImageDraw

URL = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0]
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 240
LOG = "/tmp/rc_cmds.jsonl"
open(LOG, "w").close()

img = Image.new("RGB", (540, 960), (30, 90, 200))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, 539, 959], outline=(255, 255, 0), width=6)
d.text((220, 470), "QA RC", fill=(255, 255, 255))
buf = io.BytesIO(); img.save(buf, "JPEG", quality=60)
FRAME = base64.b64encode(buf.getvalue()).decode()

state = {}
c = socketio.Client()

@c.on("device:registered")
def on_reg(x):
    state["sid"] = x["session_id"]
    print("REGISTERED", x["session_id"], flush=True)

@c.on("command:receive")
def on_cmd(x):
    print("CMD", x, flush=True)
    with open(LOG, "a") as f:
        f.write(json.dumps({"t": time.time(), **x}) + "\n")

c.on("operator:joined", lambda x: print("JOINED", flush=True))
c.connect(URL, socketio_path="api/socketio", transports=["websocket"])
c.emit("device:register", {"device_id": "qa-rc", "platform": "android", "name": "QA Remote"})
end = time.time() + DURATION
while time.time() < end:
    time.sleep(0.3)
    if "sid" in state:
        c.emit("screen:packet", {"session_id": state["sid"], "data": FRAME, "width": 540, "height": 960})
c.disconnect()
print("DISCONNECTED", flush=True)
