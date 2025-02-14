import express from "express";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.VITE_WS_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true,
    },
});

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    console.error("❌ REDIS_URL not found in environment variables");
    process.exit(1);
}

const redis = new Redis(REDIS_URL);

redis.on("connect", () => console.log("✅ Connected to Redis"));

app.get('/', (req, res) => {
    res.status(200).send('Server is healthy');
});

const WAITING_USERS_KEY = "chat:waiting_users";
const ROOM_MAPPINGS_KEY = "chat:room_mappings";

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

    try {
        const waitingUser = await redis.lpop(WAITING_USERS_KEY);

        if (waitingUser) {
            const room = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            await redis.multi()
                .hset(ROOM_MAPPINGS_KEY, socket.id, room)
                .hset(ROOM_MAPPINGS_KEY, waitingUser, room)
                .exec();

            socket.join(room);
            const waitingSocket = io.sockets.sockets.get(waitingUser);
            if (waitingSocket) {
                waitingSocket.join(room);
                console.log(`👥 Room created: ${room} with ${socket.id} & ${waitingUser}`);

                io.to(room).emit("start-call", { room });
                io.to(room).emit("paired", { room });
            }
        } else {
            await redis.rpush(WAITING_USERS_KEY, socket.id);
            console.log(`📥 ${socket.id} is waiting for a peer`);
            socket.emit("waiting");
        }
    } catch (error) {
        console.error("❌ Error in room setup:", error);
        socket.emit("error", "Failed to create room");
    }

    socket.on("offer", ({ offer, room }) => {
        console.log(`📡 Offer from ${socket.id} → room ${room}`);
        socket.to(room).emit("offer", { offer });
    });

    socket.on("answer", ({ answer, room }) => {
        console.log(`📡 Answer from ${socket.id} → room ${room}`);
        socket.to(room).emit("answer", { answer });
    });

    socket.on("ice-candidate", async ({ candidate, room }) => {
        console.log(`📡 Forwarding ICE candidate from ${socket.id} → room ${room}`);
        const peers = await getRoomPeers(room);
        const otherPeer = peers.find(id => id !== socket.id);
        if (otherPeer) {
            io.to(otherPeer).emit("ice-candidate", { candidate });
        }
    });

    socket.on("disconnect", async () => {
        console.log("🔴 User disconnected:", socket.id);
        const room = await redis.hget(ROOM_MAPPINGS_KEY, socket.id);
        if (room) {
            socket.to(room).emit("peer-disconnected", { peerId: socket.id });
            await redis.hdel(ROOM_MAPPINGS_KEY, socket.id);
        }
        await redis.lrem(WAITING_USERS_KEY, 0, socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
