import express from "express";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import Redis from "ioredis";
import dotenv from "dotenv";
import twilio from "twilio";
import cors from "cors";
import { getTurnCredentials } from "../utils/Twilioturnfetch.js";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.VITE_BACKEND_URL
      ? process.env.VITE_BACKEND_URL.split(",")
      : ["http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.get("/api/turn", async (req, res) => {
  try {
    const iceServers = await getTurnCredentials();
    res.json({ iceServers });
  } catch {
    res.status(500).json({ error: "TURN server error" });
  }
});

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("❌ REDIS_URL not found in environment variables");
  process.exit(1);
}

const redis = new Redis(REDIS_URL);
redis.on("connect", () => console.log("✅ Connected to Redis"));

app.get("/", (req, res) => {
  res.status(200).send("Server is healthy");
});

function getQueueKey(mode) {
  return `queue:${mode}`;
}

const ROOM_MAPPINGS_KEY = "chat:room_mappings";
const ROOM_CONNECTIONS_KEY = "chat:room_connections";

async function getRoomPeers(room) {
  const peers = [];
  const mappings = await redis.hgetall(ROOM_MAPPINGS_KEY);
  for (const [socketId, roomId] of Object.entries(mappings)) {
    if (roomId === room) peers.push(socketId);
  }
  return peers;
}

io.on("connection", async (socket) => {
  console.log("🔵 User connected:", socket.id);

  const mode = socket.handshake.query.mode === "video" ? "video" : "chat";
  const WAITING_USERS_KEY = getQueueKey(mode);

  try {
    const waitingUser = await redis.lpop(WAITING_USERS_KEY);

    if (waitingUser) {
      const room = `room-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      await redis
        .multi()
        .hset(ROOM_MAPPINGS_KEY, socket.id, room)
        .hset(ROOM_MAPPINGS_KEY, waitingUser, room)
        .exec();

      socket.join(room);
      const waitingSocket = io.sockets.sockets.get(waitingUser);
      if (waitingSocket && socket.connected) {
        waitingSocket.join(room);
        console.log(
          `👥 Room created: ${room} with ${socket.id} & ${waitingUser}`
        );

        await redis.hset(ROOM_CONNECTIONS_KEY, waitingUser, "initiator");
        await redis.hset(ROOM_CONNECTIONS_KEY, socket.id, "receiver");

        waitingSocket.emit("join-confirmation", {
          isInitiator: true,
          room,
          peers: [socket.id, waitingUser],
        });

        socket.emit("join-confirmation", {
          isInitiator: false,
          room,
          peers: [socket.id, waitingUser],
        });

        io.to(room).emit("paired", { room });
        console.log(`🚀 Starting call for room ${room}`);
        io.to(room).emit("start-call", { room });
      } else {
        console.log("⚠️ Waiting user disconnected, returning to queue");
        await redis.rpush(WAITING_USERS_KEY, socket.id);
        socket.emit("waiting");
      }
    } else {
      await redis.rpush(WAITING_USERS_KEY, socket.id);
      console.log(`📥 ${socket.id} is waiting for a peer (${mode})`);
      socket.emit("waiting");
    }
  } catch (error) {
    console.error("❌ Error in room setup:", error);
    socket.emit("error", "Failed to create room");
  }

  socket.on("join-room", async (room) => {
    const peers = await getRoomPeers(room);
    console.log(`🔄 ${socket.id} manually joining room ${room}`);

    if (peers.includes(socket.id)) {
      const isInitiator =
        (await redis.hget(ROOM_CONNECTIONS_KEY, socket.id)) === "initiator";
      socket.emit("join-confirmation", {
        isInitiator,
        room,
        peers,
      });
    } else {
      socket.join(room);
      await redis.hset(ROOM_MAPPINGS_KEY, socket.id, room);

      const isFirstPerson = peers.length === 0;
      await redis.hset(
        ROOM_CONNECTIONS_KEY,
        socket.id,
        isFirstPerson ? "initiator" : "receiver"
      );

      socket.emit("join-confirmation", {
        isInitiator: isFirstPerson,
        room,
        peers: [...peers, socket.id],
      });

      if (peers.length === 1) {
        io.to(room).emit("start-call", { room });
      }
    }
  });

  socket.on("offer", ({ offer, room }) => {
    socket.to(room).emit("offer", { offer });
  });

  socket.on("answer", ({ answer, room }) => {
    socket.to(room).emit("answer", { answer });
  });

  socket.on("ice-candidate", async ({ candidate, room }) => {
    const peers = await getRoomPeers(room);
    const otherPeers = peers.filter((id) => id !== socket.id);
    for (const peerId of otherPeers) {
      io.to(peerId).emit("ice-candidate", { candidate });
    }
  });

  socket.on("connection-status", ({ status, room }) => {
    socket.to(room).emit("peer-connection-status", {
      status,
      peerId: socket.id,
    });
  });

  socket.on("disconnect", async () => {
    console.log("🔴 User disconnected:", socket.id);
    const room = await redis.hget(ROOM_MAPPINGS_KEY, socket.id);

    if (room) {
      socket.to(room).emit("peer-disconnected", { peerId: socket.id });

      await redis.hdel(ROOM_MAPPINGS_KEY, socket.id);
      await redis.hdel(ROOM_CONNECTIONS_KEY, socket.id);

      const peers = await getRoomPeers(room);
      const remainingPeer = peers.find((id) => id !== socket.id);

      if (remainingPeer) {
        await redis.hdel(ROOM_MAPPINGS_KEY, remainingPeer);
        await redis.hdel(ROOM_CONNECTIONS_KEY, remainingPeer);
        await redis.rpush(WAITING_USERS_KEY, remainingPeer);
        io.to(remainingPeer).emit("waiting");
      }
    }

    await redis.lrem(getQueueKey("chat"), 0, socket.id);
    await redis.lrem(getQueueKey("video"), 0, socket.id);
  });

  socket.on("message", ({ room, message }) => {
    socket.to(room).emit("message", { sender: socket.id, message });
    socket.emit("message", { sender: socket.id, message });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
