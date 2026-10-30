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
        raise HTTPException(status_code=401, detail="Utilizador não encontrado")
    LAST_SEEN[user["id"]] = datetime.now(timezone.utc)
    return user


LAST_SEEN = {}  # user_id -> last authenticated request (CRM pages without a socket)


def online_operator_count() -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=30)
    return len(set(ONLINE_OPERATORS) | {u for u, t in LAST_SEEN.items() if t > cutoff})


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
        raise HTTPException(status_code=400, detail="E-mail já registado")
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


class UserUpdateInput(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)


def require_admin(user: dict):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Apenas o Administrador pode gerir a equipa")


@api.get("/users")
async def list_users(user=Depends(get_current_user)):
    require_admin(user)
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(1000)
    for u in users:
        u["online"] = u["id"] in ONLINE_OPERATORS
    return users


@api.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdateInput, user=Depends(get_current_user)):
    require_admin(user)
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    updates = {}
    if data.name is not None:
        if not data.name.strip():
            raise HTTPException(status_code=400, detail="O nome não pode ficar vazio")
        updates["name"] = data.name.strip()
    if data.role:
        if data.role not in ("admin", "technician"):
            raise HTTPException(status_code=400, detail="Tipo de conta inválido")
        if target["role"] == "admin" and data.role != "admin":
            if user_id == user["id"]:
                raise HTTPException(status_code=400, detail="Não pode retirar a sua própria permissão de Administrador")
            if await db.users.count_documents({"role": "admin"}) <= 1:
                raise HTTPException(status_code=400, detail="Tem de existir pelo menos um Administrador")
        updates["role"] = data.role
    if data.password:
        updates["password_hash"] = hash_password(data.password)
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    if "role" in updates and updates["role"] != target["role"]:
        for osid in list(ONLINE_OPERATORS.get(user_id, set())):
            await sio.disconnect(osid)  # force reconnect so socket permissions refresh
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(get_current_user)):
    require_admin(user)
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Não pode remover a sua própria conta")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    if target["role"] == "admin" and await db.users.count_documents({"role": "admin"}) <= 1:
        raise HTTPException(status_code=400, detail="Tem de existir pelo menos um Administrador")
    await db.users.delete_one({"id": user_id})
    await db.assist_links.delete_many({"technician_id": user_id})
    # return their open sessions to the queue and drop their live sockets
    await db.sessions.update_many(
        {"assigned_to": user_id, "status": {"$in": ["assigned", "active"]}},
        {"$set": {"status": "waiting", "assigned_to": None, "assigned_to_name": None}},
    )
    for osid in list(ONLINE_OPERATORS.get(user_id, set())):
        await sio.disconnect(osid)
    await broadcast_queue()
    return {"ok": True}


class MeUpdateInput(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=6)


@api.put("/auth/me")
async def update_me(data: MeUpdateInput, user=Depends(get_current_user)):
    updates = {}
    if data.name is not None:
        if not data.name.strip():
            raise HTTPException(status_code=400, detail="O nome não pode ficar vazio")
        updates["name"] = data.name.strip()
    if data.new_password:
        me = await db.users.find_one({"id": user["id"]})
        if not data.current_password or not verify_password(data.current_password, me["password_hash"]):
            raise HTTPException(status_code=400, detail="A palavra-passe atual está incorreta")
        updates["password_hash"] = hash_password(data.new_password)
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})


@api.get("/stats/overview")
async def stats_overview(user=Depends(get_current_user)):
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Europe/Lisbon")
    today = datetime.now(tz).date()
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]
    since = datetime.combine(days[0], datetime.min.time(), tz).astimezone(timezone.utc).isoformat()
    recent = await db.sessions.find({"created_at": {"$gte": since}}, {"_id": 0, "created_at": 1}).to_list(20000)
    per_day = {d.isoformat(): 0 for d in days}
    for s in recent:
        k = datetime.fromisoformat(s["created_at"]).astimezone(tz).date().isoformat()
        if k in per_day:
            per_day[k] += 1
    by_platform = {g["_id"] or "web": g["n"] async for g in db.sessions.aggregate(
        [{"$group": {"_id": "$platform", "n": {"$sum": 1}}}])}
    durations = []
    async for s in db.sessions.find({"status": "ended", "ended_at": {"$ne": None}}, {"_id": 0, "created_at": 1, "ended_at": 1}).sort("created_at", -1).limit(500):
        try:
            durations.append((datetime.fromisoformat(s["ended_at"]) - datetime.fromisoformat(s["created_at"])).total_seconds())
        except (TypeError, ValueError):
            pass
    top = [{"name": g["_id"], "sessions": g["n"]} async for g in db.sessions.aggregate([
        {"$match": {"assigned_to_name": {"$ne": None}}},
        {"$group": {"_id": "$assigned_to_name", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 5}])]
    return {
        "total_sessions": await db.sessions.count_documents({}),
        "today": per_day[today.isoformat()],
        "devices": await db.devices.count_documents({}),
        "links": await db.assist_links.count_documents({}),
        "avg_duration_s": int(sum(durations) / len(durations)) if durations else 0,
        "per_day": [{"date": k, "count": v} for k, v in per_day.items()],
        "by_platform": by_platform,
        "top_technicians": top,
    }


# ---- Assistance links ------------------------------------------------------
class LinkInput(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    technician_id: Optional[str] = None


@api.get("/links")
async def list_links(user=Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"technician_id": user["id"]}
    return await db.assist_links.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/links")
async def create_link(data: LinkInput, user=Depends(get_current_user)):
    tech_id = data.technician_id if user["role"] == "admin" and data.technician_id else user["id"]
    tech = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not tech:
        raise HTTPException(status_code=404, detail="Técnico não encontrado")
    doc = {
        "code": uuid.uuid4().hex[:8], "label": data.label.strip(),
        "technician_id": tech["id"], "technician_name": tech["name"],
        "created_by": user["email"], "created_at": now_iso(), "uses": 0, "last_used": None,
    }
    await db.assist_links.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/links/{code}")
async def delete_link(code: str, user=Depends(get_current_user)):
    link = await db.assist_links.find_one({"code": code})
    if not link:
        raise HTTPException(status_code=404, detail="Link não encontrado")
    if user["role"] != "admin" and link["technician_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem permissão")
    await db.assist_links.delete_one({"code": code})
    return {"ok": True}


@api.get("/public/links/{code}")
async def public_link(code: str):
    link = await db.assist_links.find_one({"code": code}, {"_id": 0, "label": 1, "technician_name": 1})
    if not link:
        raise HTTPException(status_code=404, detail="Link inválido ou expirado")
    return link


class DeviceRenameInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)


def online_session_ids() -> set:
    return set(DEVICE_SIDS.values())


@api.get("/devices")
async def list_devices(user=Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).sort("last_seen", -1).to_list(2000)
    live = online_session_ids()
    if live:
        online = await db.sessions.distinct("device_id", {"id": {"$in": list(live)}})
    else:
        online = []
    for d in devices:
        d["online"] = d["device_id"] in online
        d["display_name"] = d.get("custom_name") or d.get("original_name")
    return devices


@api.put("/devices/{device_id}")
async def rename_device(device_id: str, data: DeviceRenameInput, user=Depends(get_current_user)):
    require_admin(user)
    name = data.name.strip()
    res = await db.devices.update_one({"device_id": device_id}, {"$set": {"custom_name": name}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Aparelho não encontrado")
    await db.sessions.update_many({"device_id": device_id}, {"$set": {"name": name}})
    await broadcast_queue()
    return {"ok": True, "display_name": name}


@api.delete("/devices/{device_id}")
async def delete_device(device_id: str, user=Depends(get_current_user)):
    require_admin(user)
    device = await db.devices.find_one({"device_id": device_id})
    if not device:
        raise HTTPException(status_code=404, detail="Aparelho não encontrado")
    live = list(set(DEVICE_SIDS.values()))
    ended = await db.sessions.distinct("id", {"device_id": device_id, "id": {"$nin": live}})
    await db.logs.delete_many({"session_id": {"$in": ended}})
    await db.sessions.delete_many({"id": {"$in": ended}})
    # a live session keeps running, but loses the custom name
    await db.sessions.update_many({"device_id": device_id}, {"$set": {"name": device.get("original_name")}})
    await db.devices.delete_one({"device_id": device_id})
    await broadcast_queue()
    return {"ok": True}


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
        "ended": ended, "technicians": techs, "online_operators": online_operator_count(),
    }


fastapi_app.include_router(api)
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
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
    await db.devices.create_index("device_id", unique=True)
    # backfill the device registry from session history (one-off)
    if await db.devices.count_documents({}) == 0:
        async for g in db.sessions.aggregate([
            {"$sort": {"created_at": 1}},
            {"$group": {"_id": "$device_id", "platform": {"$last": "$platform"}, "name": {"$last": "$name"},
                        "first_seen": {"$first": "$created_at"}, "last_seen": {"$last": "$created_at"},
                        "connections": {"$sum": 1}}},
        ]):
            if not g["_id"]:
                continue
            await db.devices.update_one({"device_id": g["_id"]}, {"$setOnInsert": {
                "device_id": g["_id"], "platform": g["platform"], "original_name": g["name"],
                "custom_name": None, "first_seen": g["first_seen"], "last_seen": g["last_seen"],
                "connections": g["connections"]}}, upsert=True)
    # socket registries are in memory: sessions still open from a previous run have no device
    await db.sessions.update_many(
        {"status": {"$in": ["waiting", "assigned", "active"]}},
        {"$set": {"status": "ended", "ended_at": now_iso()}},
    )
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
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
    max_http_buffer_size=16_000_000,  # allow large base64 JPEG screen frames from native agents
    ping_timeout=30,
)

# in-memory registries
DEVICE_SIDS = {}       # sid -> session_id (device/end-user connections)
OPERATOR_SIDS = {}     # sid -> user dict (CRM operators)
ONLINE_OPERATORS = {}  # user_id -> set of sids
SESSIONS_ACTIVE = set()  # session_ids already marked active (avoids a DB write per frame)


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
            db_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
            if not db_user:
                return False
            user = {"id": db_user["id"], "email": db_user["email"],
                    "role": db_user["role"], "name": db_user.get("name", "")}
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
        SESSIONS_ACTIVE.discard(session_id)
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
    # claim the sid first so a disconnect arriving mid-registration ends this session
    DEVICE_SIDS[sid] = session_id
    try:
        await sio.enter_room(sid, room(session_id))
    except ValueError:
        DEVICE_SIDS.pop(sid, None)
        return
    # close stale open sessions of this same device (reconnects / dropped transports)
    live = set(DEVICE_SIDS.values())
    await db.sessions.update_many(
        {"device_id": device_id, "status": {"$ne": "ended"}, "id": {"$nin": list(live)}},
        {"$set": {"status": "ended", "ended_at": now_iso()}},
    )
    saved = await db.devices.find_one_and_update(
        {"device_id": device_id},
        {"$set": {"platform": platform, "original_name": name, "last_seen": now_iso()},
         "$setOnInsert": {"device_id": device_id, "custom_name": None, "first_seen": now_iso()},
         "$inc": {"connections": 1}},
        upsert=True, return_document=True, projection={"_id": 0},
    )
    name = saved.get("custom_name") or name
    pin = str(uuid.uuid4().int)[:6]
    link = None
    if (data or {}).get("link_code"):
        link = await db.assist_links.find_one({"code": data["link_code"]}, {"_id": 0})
    if link and not saved.get("custom_name"):
        name = link["label"]
        await db.devices.update_one({"device_id": device_id}, {"$set": {"custom_name": name}})
    doc = {
        "id": session_id, "device_id": device_id, "platform": platform,
        "name": name, "pin": pin, "status": "assigned" if link else "waiting",
        "assigned_to": link["technician_id"] if link else None,
        "assigned_to_name": link["technician_name"] if link else None,
        "link_code": link["code"] if link else None,
        "created_at": now_iso(), "ended_at": None, "last_activity": now_iso(),
    }
    await db.sessions.insert_one(doc)
    if DEVICE_SIDS.get(sid) != session_id:
        # socket dropped while registering
        await db.sessions.update_one({"id": session_id}, {"$set": {"status": "ended", "ended_at": now_iso()}})
        return
    if link:
        await db.assist_links.update_one({"code": link["code"]}, {"$inc": {"uses": 1}, "$set": {"last_used": now_iso()}})
    await log_event(session_id, "device_registered", {"platform": platform, "device_id": device_id})
    doc.pop("_id", None)
    await sio.emit("device:registered", {"session_id": session_id, "pin": pin, "iceServers": ICE_SERVERS}, to=sid)
    if link:
        for tsid in ONLINE_OPERATORS.get(link["technician_id"], set()):
            await sio.emit("session:assigned-to-you", {"session_id": session_id}, to=tsid)
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


async def _can_operate(user: dict, session_id: str, allow_waiting: bool = False) -> bool:
    if not user:
        return False
    if user["role"] == "admin":
        return True
    sess = await db.sessions.find_one({"id": session_id}, {"_id": 0, "assigned_to": 1, "status": 1})
    if not sess:
        return False
    if sess.get("assigned_to") == user["id"]:
        return True
    if allow_waiting and sess.get("status") == "waiting":
        return True
    return False


@sio.on("operator:subscribe")
async def operator_subscribe(sid, data):
    """Operator joins a session room to receive the WebRTC stream + signal device to start."""
    user = OPERATOR_SIDS.get(sid)
    session_id = data.get("session_id")
    if not await _can_operate(user, session_id, allow_waiting=True):
        return
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
    if not data or not data.get("session_id"):
        return
    await sio.emit("rtc:offer", data, room=room(data["session_id"]), skip_sid=sid)


@sio.on("rtc:answer")
async def rtc_answer(sid, data):
    if not data or not data.get("session_id"):
        return
    await sio.emit("rtc:answer", data, room=room(data["session_id"]), skip_sid=sid)


@sio.on("rtc:ice")
async def rtc_ice(sid, data):
    if not data or not data.get("session_id"):
        return
    await sio.emit("rtc:ice", data, room=room(data["session_id"]), skip_sid=sid)


# ---- Remote interaction + accessibility ----------------------------------
@sio.on("command:send")
async def command_send(sid, data):
    user = OPERATOR_SIDS.get(sid)
    session_id = data.get("session_id")
    if not await _can_operate(user, session_id):
        return
    command = data.get("command", {})
    await db.sessions.update_one({"id": session_id}, {"$set": {"last_activity": now_iso()}})
    await log_event(session_id, "command", {"command": command, "by": user["email"]})
    await sio.emit("command:receive", {"command": command}, room=room(session_id), skip_sid=sid)


@sio.on("a11y:tree")
async def a11y_tree(sid, data):
    """Device pushes its accessibility node hierarchy for the operator to read."""
    if not data:
        return
    session_id = data.get("session_id")
    if not session_id or DEVICE_SIDS.get(sid) != session_id:
        return
    await sio.emit("a11y:tree", data, room=room(session_id), skip_sid=sid)
    await log_event(session_id, "a11y_tree", {"nodes": len(data.get("tree", []))})


@sio.on("a11y:request")
async def a11y_request(sid, data):
    if not data:
        return
    session_id = data.get("session_id")
    if not session_id:
        return
    await sio.emit("a11y:request", data, room=room(session_id), skip_sid=sid)


@sio.on("screen:packet")
async def screen_packet(sid, data):
    """Native agents (Android/Windows) push JPEG screen frames; relay to operators in the room."""
    if not data:
        return
    session_id = data.get("session_id")
    if not session_id or DEVICE_SIDS.get(sid) != session_id:
        return  # only the owning device may push frames
    if session_id not in SESSIONS_ACTIVE:
        SESSIONS_ACTIVE.add(session_id)
        await db.sessions.update_one({"id": session_id}, {"$set": {"status": "active", "last_activity": now_iso()}})
        await broadcast_queue()
    await sio.emit("screen:frame", data, room=room(session_id), skip_sid=sid)


# ================================================================== ASGI app
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="api/socketio")
