/**
 * Crypto Conex — Servidor Node.js de referência (Socket.io + Rooms + JWT + MongoDB).
 * Implementação 100% compatível com o backend FastAPI que roda em produção.
 * Roteamento dinâmico de sessões Admin -> Técnico -> Dispositivo via Rooms.
 *
 *   npm install express socket.io jsonwebtoken bcryptjs mongodb cors
 *   node server.js
 */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
const { randomUUID } = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const PORT = process.env.PORT || 8001;

const ICE_SERVERS = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80", username: "74f6f225452152d90fc71dcd", credential: "mMNh6ehOyNz44vqF" },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "74f6f225452152d90fc71dcd", credential: "mMNh6ehOyNz44vqF" },
  { urls: "turn:global.relay.metered.ca:443", username: "74f6f225452152d90fc71dcd", credential: "mMNh6ehOyNz44vqF" },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "74f6f225452152d90fc71dcd", credential: "mMNh6ehOyNz44vqF" },
];

async function main() {
  const mongo = await MongoClient.connect(MONGO_URL);
  const db = mongo.db("crypto_conex");
  const Users = db.collection("users");
  const Sessions = db.collection("sessions");
  const Logs = db.collection("logs");

  // seed admin
  if (!(await Users.findOne({ email: "admin@cryptoconex.com" }))) {
    await Users.insertOne({
      id: randomUUID(), email: "admin@cryptoconex.com",
      password_hash: bcrypt.hashSync("Conex@2026", 10),
      name: "Super Admin", role: "admin",
    });
  }

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { path: "/api/socketio", cors: { origin: "*" } });

  app.get("/api/config/ice", (_, res) => res.json({ iceServers: ICE_SERVERS }));

  app.post("/api/auth/login", async (req, res) => {
    const user = await Users.findOne({ email: req.body.email.toLowerCase() });
    if (!user || !bcrypt.compareSync(req.body.password, user.password_hash))
      return res.status(401).json({ detail: "E-mail ou senha incorretos" });
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  // ---- in-memory registries ----
  const DEVICE_SIDS = {};     // sid -> session_id
  const OPERATOR_SIDS = {};    // sid -> user
  const ONLINE_OPERATORS = {}; // userId -> Set<sid>
  const room = (id) => `session:${id}`;

  async function broadcastQueue() {
    const sessions = await Sessions.find({ status: { $in: ["waiting", "assigned", "active"] } }).sort({ created_at: 1 }).toArray();
    io.to("operators").emit("queue:update", { sessions });
  }
  const logEvent = (sid, type, payload = {}) =>
    Logs.insertOne({ session_id: sid, type, payload, timestamp: new Date().toISOString() });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try { socket.data.user = jwt.verify(token, JWT_SECRET); } catch { return next(new Error("invalid token")); }
    }
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    if (user) {
      OPERATOR_SIDS[socket.id] = user;
      (ONLINE_OPERATORS[user.sub] ??= new Set()).add(socket.id);
      socket.join("operators");
      Sessions.find({ status: { $in: ["waiting", "assigned", "active"] } }).sort({ created_at: 1 }).toArray()
        .then((sessions) => socket.emit("queue:update", { sessions }));
    }

    socket.on("device:register", async (data = {}) => {
      const session_id = randomUUID();
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const doc = {
        id: session_id, device_id: data.device_id || randomUUID(),
        platform: data.platform || "web", name: data.name || "Dispositivo",
        pin, status: "waiting", assigned_to: null, assigned_to_name: null,
        created_at: new Date().toISOString(), ended_at: null,
      };
      await Sessions.insertOne(doc);
      DEVICE_SIDS[socket.id] = session_id;
      socket.join(room(session_id));
      await logEvent(session_id, "device_registered", { platform: doc.platform });
      socket.emit("device:registered", { session_id, pin, iceServers: ICE_SERVERS });
      broadcastQueue();
    });

    socket.on("session:assign", async ({ session_id, technician_id }) => {
      const op = OPERATOR_SIDS[socket.id];
      if (!op) return;
      if (op.role !== "admin" && technician_id !== op.sub) return;
      const tech = await Users.findOne({ id: technician_id });
      if (!tech) return;
      await Sessions.updateOne({ id: session_id }, { $set: { status: "assigned", assigned_to: technician_id, assigned_to_name: tech.name } });
      (ONLINE_OPERATORS[technician_id] || new Set()).forEach((sid) => io.to(sid).emit("session:assigned-to-you", { session_id }));
      broadcastQueue();
    });

    socket.on("operator:subscribe", async ({ session_id }) => {
      socket.join(room(session_id));
      await Sessions.updateOne({ id: session_id }, { $set: { status: "active" } });
      socket.to(room(session_id)).emit("operator:joined", { session_id });
      broadcastQueue();
    });

    // WebRTC signaling relay
    ["rtc:offer", "rtc:answer", "rtc:ice"].forEach((ev) =>
      socket.on(ev, (data) => socket.to(room(data.session_id)).emit(ev, data))
    );

    socket.on("command:send", async ({ session_id, command }) => {
      await logEvent(session_id, "command", { command, by: OPERATOR_SIDS[socket.id]?.email });
      socket.to(room(session_id)).emit("command:receive", { command });
    });

    socket.on("a11y:tree", (data) => socket.to(room(data.session_id)).emit("a11y:tree", data));
    socket.on("a11y:request", (data) => socket.to(room(data.session_id)).emit("a11y:request", data));

    socket.on("disconnect", async () => {
      if (OPERATOR_SIDS[socket.id]) {
        const u = OPERATOR_SIDS[socket.id];
        ONLINE_OPERATORS[u.sub]?.delete(socket.id);
        delete OPERATOR_SIDS[socket.id];
        return;
      }
      const session_id = DEVICE_SIDS[socket.id];
      if (session_id) {
        delete DEVICE_SIDS[socket.id];
        await Sessions.updateOne({ id: session_id }, { $set: { status: "ended", ended_at: new Date().toISOString() } });
        io.to(room(session_id)).emit("device:disconnected", { session_id });
        broadcastQueue();
      }
    });
  });

  server.listen(PORT, () => console.log(`Crypto Conex (Node) ouvindo em :${PORT}`));
}

main().catch(console.error);
