# Background device simulator: registers a device via socket.io and logs received commands (used for UI tests)
import time, sys, socketio
URL = [l.split("=",1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0]
c = socketio.Client()
c.on("device:registered", lambda d: print("REGISTERED", d["session_id"], d["pin"], flush=True))
c.on("command:receive", lambda d: print("CMD", d, flush=True))
c.on("operator:joined", lambda d: print("JOINED", d, flush=True))
c.on("rtc:answer", lambda d: print("ANSWER", flush=True))
c.on("rtc:ice", lambda d: print("ICE", flush=True))
c.connect(URL, socketio_path="api/socketio", transports=["websocket"])
c.emit("device:register", {"device_id": "TEST_ui_dev", "platform": "android", "name": "TEST_UI_Device"})
time.sleep(int(sys.argv[1]) if len(sys.argv) > 1 else 150)
c.disconnect()
