from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import logging
import uuid
import jwt
import bcrypt
import socketio
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# ------------------------------------------------------------------ config
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@cryptoconex.com')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')

ICE_SERVERS = [
    {"urls": "stun:stun.relay.metered.ca:80"},
    {"urls": "turn:global.relay.metered.ca:80", "username": "74f6f225452152d90fc71dcd", "credential": "mMNh6ehOyNz44vqF"},
    {"urls": "turn:global.relay.metered.ca:80?transport=tcp", "username": "74f6f225452152d90fc71dcd", "credential": "mMNh6ehOyNz44vqF"},
    {"urls": "turn:global.relay.metered.ca:443", "username": "74f6f225452152d90fc71dcd", "credential": "mMNh6ehOyNz44vqF"},
    {"urls": "turns:global.relay.metered.ca:443?transport=tcp", "username": "74f6f225452152d90fc71dcd", "credential": "mMNh6ehOyNz44vqF"},
]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("cryptoconex")

# ------------------------------------------------------------------ helpers
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user.get("name", ""),
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


# ------------------------------------------------------------------ models
class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: str = "technician"


class LoginInput(BaseModel):
    email: EmailStr
    password: str


# ------------------------------------------------------------------ FastAPI
fastapi_app = FastAPI(title="Crypto Conex API")
api = APIRouter(prefix="/api")


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Não autenticado")
    token = auth[7:]
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return user


@api.get("/")
async def root():
    return {"message": "Crypto Conex API online"}


@api.get("/config/ice")
async def get_ice_config():
    return {"iceServers": ICE_SERVERS}


@api.post("/auth/register")
async def register(data: RegisterInput, user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Apenas o Super Admin pode criar contas")
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    role = data.role if data.role in ("admin", "technician") else "technician"
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": role,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return {"id": doc["id"], "email": email, "name": data.name, "role": role}


@api.post("/auth/login")
async def login(data: LoginInput):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    token = create_token(user)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user.get("name"), "role": user["role"]},
    }


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api.get("/technicians")
async def list_technicians(user=Depends(get_current_user)):
    techs = await db.users.find({"role": "technician"}, {"_id": 0, "password_hash": 0}).to_list(500)
    # online status computed from socket registry
    for t in techs:
        t["online"] = t["id"] in ONLINE_OPERATORS
    return techs


@api.get("/sessions")
async def list_sessions(user=Depends(get_current_user)):
    query = {}
    if user["role"] != "admin":
        # technician sees unassigned queue + own sessions
        query = {"$or": [{"status": "waiting"}, {"assigned_to": user["id"]}]}
    sessions = await db.sessions.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return sessions


@api.get("/sessions/{session_id}/logs")
async def session_logs(session_id: str, user=Depends(get_current_user)):
    logs = await db.logs.find({"session_id": session_id}, {"_id": 0}).sort("timestamp", 1).to_list(1000)
    return logs


@api.get("/stats")
async def stats(user=Depends(get_current_user)):
    waiting = await db.sessions.count_documents({"status": "waiting"})
    active = await db.sessions.count_documents({"status": "active"})
    assigned = await db.sessions.count_documents({"status": "assigned"})
    ended = await db.sessions.count_documents({"status": "ended"})
    techs = await db.users.count_documents({"role": "technician"})
    return {
        "waiting": waiting, "active": active, "assigned": assigned,
        "ended": ended, "technicians": techs, "online_operators": len(ONLINE_OPERATORS),
    }


fastapi_app.include_router(api)
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ seeding
@fastapi_app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.sessions.create_index("id", unique=True)
    existing = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL.lower(),
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Super Admin",
            "role": "admin",
            "created_at": now_iso(),
        })
        logger.info("Super Admin seeded: %s", ADMIN_EMAIL)


@fastapi_app.on_event("shutdown")
async def shutdown():
    client.close()


# ================================================================== Socket.IO
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", logger=False, engineio_logger=False)

# in-memory registries
DEVICE_SIDS = {}       # sid -> session_id (device/end-user connections)
OPERATOR_SIDS = {}     # sid -> user dict (CRM operators)
ONLINE_OPERATORS = {}  # user_id -> set of sids


def room(session_id: str) -> str:
    return f"session:{session_id}"


async def log_event(session_id: str, etype: str, payload=None):
    await db.logs.insert_one({
        "session_id": session_id, "type": etype,
        "payload": payload or {}, "timestamp": now_iso(),
    })


async def broadcast_queue():
    sessions = await db.sessions.find(
        {"status": {"$in": ["waiting", "assigned", "active"]}}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    await sio.emit("queue:update", {"sessions": sessions}, room="operators")


@sio.event
async def connect(sid, environ, auth):
    # Operators authenticate with a JWT; devices connect without auth.
    token = (auth or {}).get("token") if auth else None
    if token:
        try:
            payload = decode_token(token)
            user = {"id": payload["sub"], "email": payload["email"],
                    "role": payload["role"], "name": payload.get("name", "")}
            OPERATOR_SIDS[sid] = user
            ONLINE_OPERATORS.setdefault(user["id"], set()).add(sid)
            await sio.enter_room(sid, "operators")
            sessions = await db.sessions.find(
                {"status": {"$in": ["waiting", "assigned", "active"]}}, {"_id": 0}
            ).sort("created_at", 1).to_list(500)
            await sio.emit("queue:update", {"sessions": sessions}, to=sid)
            await sio.emit("operator:ready", {"user": user}, to=sid)
            logger.info("Operator connected: %s", user["email"])
        except jwt.InvalidTokenError:
            logger.warning("Operator rejected: invalid token")
            return False
    return True


@sio.event
async def disconnect(sid):
    if sid in OPERATOR_SIDS:
        user = OPERATOR_SIDS.pop(sid)
        s = ONLINE_OPERATORS.get(user["id"])
        if s:
            s.discard(sid)
            if not s:
                ONLINE_OPERATORS.pop(user["id"], None)
        return
    if sid in DEVICE_SIDS:
        session_id = DEVICE_SIDS.pop(sid)
        await db.sessions.update_one(
            {"id": session_id}, {"$set": {"status": "ended", "ended_at": now_iso()}}
        )
        await log_event(session_id, "device_disconnected")
        await sio.emit("device:disconnected", {"session_id": session_id}, room=room(session_id))
        await broadcast_queue()


# ---- Device (end-user) events -------------------------------------------
@sio.on("device:register")
async def device_register(sid, data):
    device_id = (data or {}).get("device_id") or str(uuid.uuid4())
    platform = (data or {}).get("platform", "web")
    name = (data or {}).get("name") or f"Dispositivo {device_id[:6]}"
    session_id = str(uuid.uuid4())
    pin = str(uuid.uuid4().int)[:6]
    doc = {
        "id": session_id, "device_id": device_id, "platform": platform,
        "name": name, "pin": pin, "status": "waiting",
        "assigned_to": None, "assigned_to_name": None,
        "created_at": now_iso(), "ended_at": None, "last_activity": now_iso(),
    }
    await db.sessions.insert_one(doc)
    DEVICE_SIDS[sid] = session_id
    await sio.enter_room(sid, room(session_id))
    await log_event(session_id, "device_registered", {"platform": platform, "device_id": device_id})
    doc.pop("_id", None)
    await sio.emit("device:registered", {"session_id": session_id, "pin": pin, "iceServers": ICE_SERVERS}, to=sid)
    await broadcast_queue()


# ---- Operator control events --------------------------------------------
@sio.on("session:assign")
async def session_assign(sid, data):
    user = OPERATOR_SIDS.get(sid)
    if not user:
        return
    session_id = data.get("session_id")
    technician_id = data.get("technician_id")
    if user["role"] != "admin" and technician_id != user["id"]:
        return  # technicians can only assign to themselves
    tech = await db.users.find_one({"id": technician_id}, {"_id": 0, "password_hash": 0})
    if not tech:
        return
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "assigned", "assigned_to": technician_id, "assigned_to_name": tech["name"]}},
    )
    await log_event(session_id, "session_assigned", {"technician": tech["name"], "by": user["email"]})
    # notify the assigned technician's sids
    for tsid in ONLINE_OPERATORS.get(technician_id, set()):
        await sio.emit("session:assigned-to-you", {"session_id": session_id}, to=tsid)
    await broadcast_queue()


@sio.on("operator:subscribe")
async def operator_subscribe(sid, data):
    """Operator joins a session room to receive the WebRTC stream + signal device to start."""
    user = OPERATOR_SIDS.get(sid)
    if not user:
        return
    session_id = data.get("session_id")
    await sio.enter_room(sid, room(session_id))
    await db.sessions.update_one({"id": session_id}, {"$set": {"status": "active", "last_activity": now_iso()}})
    await log_event(session_id, "operator_subscribed", {"operator": user["email"]})
    # tell the device an operator is ready -> device should (re)send offer
    await sio.emit("operator:joined", {"session_id": session_id}, room=room(session_id), skip_sid=sid)
    await broadcast_queue()


@sio.on("operator:unsubscribe")
async def operator_unsubscribe(sid, data):
    session_id = data.get("session_id")
    await sio.leave_room(sid, room(session_id))


# ---- WebRTC signaling relay (bi-directional within the session room) -----
@sio.on("rtc:offer")
async def rtc_offer(sid, data):
    session_id = data.get("session_id")
    await sio.emit("rtc:offer", data, room=room(session_id), skip_sid=sid)


@sio.on("rtc:answer")
async def rtc_answer(sid, data):
    session_id = data.get("session_id")
    await sio.emit("rtc:answer", data, room=room(session_id), skip_sid=sid)


@sio.on("rtc:ice")
async def rtc_ice(sid, data):
    session_id = data.get("session_id")
    await sio.emit("rtc:ice", data, room=room(session_id), skip_sid=sid)


# ---- Remote interaction + accessibility ----------------------------------
@sio.on("command:send")
async def command_send(sid, data):
    user = OPERATOR_SIDS.get(sid)
    if not user:
        return
    session_id = data.get("session_id")
    command = data.get("command", {})
    await db.sessions.update_one({"id": session_id}, {"$set": {"last_activity": now_iso()}})
    await log_event(session_id, "command", {"command": command, "by": user["email"]})
    await sio.emit("command:receive", {"command": command}, room=room(session_id), skip_sid=sid)


@sio.on("a11y:tree")
async def a11y_tree(sid, data):
    """Device pushes its accessibility node hierarchy for the operator to read."""
    session_id = data.get("session_id")
    await sio.emit("a11y:tree", data, room=room(session_id), skip_sid=sid)
    await log_event(session_id, "a11y_tree", {"nodes": len((data or {}).get("tree", []))})


@sio.on("a11y:request")
async def a11y_request(sid, data):
    session_id = data.get("session_id")
    await sio.emit("a11y:request", data, room=room(session_id), skip_sid=sid)


# ================================================================== ASGI app
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="api/socketio")
