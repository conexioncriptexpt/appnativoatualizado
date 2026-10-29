import { io } from "socket.io-client";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Exponential backoff reconnection is handled natively by socket.io.
export function createSocket(auth) {
  return io(BACKEND_URL, {
    path: "/api/socketio",
    transports: ["websocket", "polling"],
    auth: auth || {},
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
  });
}
