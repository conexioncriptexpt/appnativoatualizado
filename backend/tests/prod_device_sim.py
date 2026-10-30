# Production device simulator: registers 'QA Android Simulado' on PRODUCTION, pushes screen:packet frames, disconnects after N seconds
import time, sys, io, base64, socketio
from PIL import Image, ImageDraw

URL = "https://crypto-conex.emergent.host"
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 120

img = Image.new("RGB", (360, 640), (220, 30, 30))
ImageDraw.Draw(img).text((40, 300), "QA FRAME", fill=(255, 255, 255))
buf = io.BytesIO(); img.save(buf, "JPEG", quality=60)
FRAME = base64.b64encode(buf.getvalue()).decode()

state = {}
c = socketio.Client()

@c.on("device:registered")
def on_reg(d):
    state["sid"] = d["session_id"]
    print("REGISTERED", d["session_id"], d.get("pin"), "ice:", bool(d.get("iceServers")), len(d.get("iceServers") or []), flush=True)

def on_joined(d):
    state["joined"] = True
    print("JOINED", d, flush=True)
c.on("operator:joined", on_joined)
c.on("command:receive", lambda d: print("CMD", d, flush=True))

c.connect(URL, socketio_path="api/socketio", transports=["websocket"])
print("CONNECTED", c.sid, flush=True)
c.emit("device:register", {"device_id": "qa-sim-android", "platform": "android", "name": "QA Android Simulado"})
end = time.time() + DURATION
while time.time() < end:
    time.sleep(1)
    if "sid" in state and state.get("joined"):  # like the native agent: stream once an operator joins
        c.emit("screen:packet", {"session_id": state["sid"], "data": FRAME, "width": 360, "height": 640})
c.disconnect()
print("DISCONNECTED", flush=True)
