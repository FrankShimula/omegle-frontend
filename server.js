import express from "express";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import Redis from "ioredis";
import dotenv from "dotenv";
import twilio from "twilio";
import cors from "cors";


dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.VITE_WS_URL ? process.env.VITE_WS_URL.split(",") : ["http://localhost:5173"],
        methods: ["GET", "POST"],
        credentials: true,
    },
});



const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.get("/api/turn", cors(), async (req, res) => {

    try {
        const token = await client.tokens.create();
        console.log("✅ Generated fresh TURN credentials");
        res.json({ iceServers: token.iceServers });
    } catch (error) {
        console.error("❌ Failed to get TURN credentials:", error);
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

app.get('/', (req, res) => {
    res.status(200).send('Server is healthy');
});

const WAITING_USERS_KEY = "chat:waiting_users";
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

                // Mark the waiting user as the initiator
                await redis.hset(ROOM_CONNECTIONS_KEY, waitingUser, "initiator");
                await redis.hset(ROOM_CONNECTIONS_KEY, socket.id, "receiver");

                // Send join confirmation with initiator status
                waitingSocket.emit("join-confirmation", {
                    isInitiator: true,
                    room,
                    peers: [socket.id, waitingUser]
                });
                socket.emit("join-confirmation", {
                    isInitiator: false,
                    room,
                    peers: [socket.id, waitingUser]
                });

                // Let the clients know they've been paired
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

    socket.on("join-room", async (room) => {
        const peers = await getRoomPeers(room);
        console.log(`🔄 ${socket.id} manually joining room ${room}`);

        // Check if user is already in this room
        if (peers.includes(socket.id)) {
            const isInitiator = await redis.hget(ROOM_CONNECTIONS_KEY, socket.id) === "initiator";
            socket.emit("join-confirmation", {
                isInitiator,
                room,
                peers
            });
            console.log(`🔄 ${socket.id} reconnected to room ${room} as ${isInitiator ? "initiator" : "receiver"}`);
        } else {
            socket.join(room);
            await redis.hset(ROOM_MAPPINGS_KEY, socket.id, room);

            // If this is the first person in room
            const isFirstPerson = peers.length === 0;
            await redis.hset(ROOM_CONNECTIONS_KEY, socket.id, isFirstPerson ? "initiator" : "receiver");

            socket.emit("join-confirmation", {
                isInitiator: isFirstPerson,
                room,
                peers: [...peers, socket.id]
            });

            // If this is the second person, let both know to start the connection process
            if (peers.length === 1) {
                io.to(room).emit("start-call", { room });
            }
        }
    });

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
        const otherPeers = peers.filter(id => id !== socket.id);

        if (otherPeers.length > 0) {
            // Send to all other peers in the room
            for (const peerId of otherPeers) {
                io.to(peerId).emit("ice-candidate", { candidate });
            }
        }
    });

    socket.on("connection-status", async ({ status, room }) => {
        console.log(`📊 Connection status from ${socket.id}: ${status} in room ${room}`);
        socket.to(room).emit("peer-connection-status", { status, peerId: socket.id });
    });

    socket.on("disconnect", async () => {
        console.log("🔴 User disconnected:", socket.id);
        const room = await redis.hget(ROOM_MAPPINGS_KEY, socket.id);

        if (room) {
            socket.to(room).emit("peer-disconnected", { peerId: socket.id });

            // Remove disconnected user from Redis
            await redis.hdel(ROOM_MAPPINGS_KEY, socket.id);
            await redis.hdel(ROOM_CONNECTIONS_KEY, socket.id);

            // Find the remaining peer
            const peers = await getRoomPeers(room);
            const remainingPeer = peers.find(id => id !== socket.id);

            if (remainingPeer) {
                console.log(`📥 Moving ${remainingPeer} back to waiting queue`);
                await redis.rpush(WAITING_USERS_KEY, remainingPeer);
                io.to(remainingPeer).emit("waiting");
            }
        }

        // Remove from waiting queue if still there
        await redis.lrem(WAITING_USERS_KEY, 0, socket.id);
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));