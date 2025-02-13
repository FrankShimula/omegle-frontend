import express from "express";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import Redis from "ioredis";
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.VITE_WS_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true
    },
});

const logEvent = (socketId, event, data = '') => {
    console.log(`[${new Date().toISOString()}] Socket ${socketId} - ${event}:`, data);
};

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    console.error("REDIS_URL not found in environment variables");
    process.exit(1);
}

const redis = new Redis(REDIS_URL);

redis.on('connect', () => {
    console.log('Successfully connected to Redis');
});

const WAITING_USERS_KEY = "chat:waiting_users";
const ROOM_MAPPINGS_KEY = "chat:room_mappings";

async function getRoomPeers(room) {
    const peers = [];
    const mappings = await redis.hgetall(ROOM_MAPPINGS_KEY);

    for (const [socketId, roomId] of Object.entries(mappings)) {
        if (roomId === room) {
            peers.push(socketId);
        }
    }
    return peers;
}

io.on("connection", async (socket) => {
    logEvent(socket.id, 'Connected');

    socket.on("join-room", async (room) => {
        logEvent(socket.id, 'Joining room', room);

        try {
            // Check if room exists and has a peer
            const peers = await getRoomPeers(room);
            logEvent(socket.id, 'Current peers in room', peers);

            if (peers.length === 0) {
                // First peer in room
                await redis.hset(ROOM_MAPPINGS_KEY, socket.id, room);
                socket.join(room);
                logEvent(socket.id, 'Waiting for peer');
                socket.emit("waiting");
            } else if (peers.length === 1) {
                // Second peer joining
                await redis.hset(ROOM_MAPPINGS_KEY, socket.id, room);
                socket.join(room);

                logEvent(socket.id, 'Room complete, initiating call');
                socket.emit("paired", { room });
                socket.to(room).emit("paired", { room });

                // Initiate WebRTC signaling
                socket.emit("start-call");
            } else {
                logEvent(socket.id, 'Room full');
                socket.emit("error", "Room is full");
            }
        } catch (error) {
            logEvent(socket.id, 'Error joining room', error);
            socket.emit("error", "Failed to join room");
        }
    });

    socket.on("offer", async ({ offer, room }) => {
        logEvent(socket.id, 'Processing offer', { room });
        try {
            const isInRoom = await redis.hget(ROOM_MAPPINGS_KEY, socket.id) === room;
            if (!isInRoom) {
                throw new Error("Not authorized for this room");
            }
            socket.to(room).emit("offer", { offer, room });
            logEvent(socket.id, 'Offer sent to room', room);
        } catch (error) {
            logEvent(socket.id, 'Error processing offer', error);
            socket.emit("error", "Failed to process offer");
        }
    });

    socket.on("answer", async ({ answer, room }) => {
        logEvent(socket.id, 'Processing answer', { room });
        try {
            const isInRoom = await redis.hget(ROOM_MAPPINGS_KEY, socket.id) === room;
            if (!isInRoom) {
                throw new Error("Not authorized for this room");
            }
            socket.to(room).emit("answer", { answer, room });
            logEvent(socket.id, 'Answer sent to room', room);
        } catch (error) {
            logEvent(socket.id, 'Error processing answer', error);
            socket.emit("error", "Failed to process answer");
        }
    });

    socket.on("ice-candidate", async ({ candidate, room }) => {
        logEvent(socket.id, 'Processing ICE candidate', { room });
        try {
            const isInRoom = await redis.hget(ROOM_MAPPINGS_KEY, socket.id) === room;
            if (!isInRoom) {
                throw new Error("Not authorized for this room");
            }
            socket.to(room).emit("ice-candidate", { candidate, room });
            logEvent(socket.id, 'ICE candidate sent to room', room);
        } catch (error) {
            logEvent(socket.id, 'Error processing ICE candidate', error);
            socket.emit("error", "Failed to process ICE candidate");
        }
    });

    socket.on("disconnect", async () => {
        logEvent(socket.id, 'Disconnected');
        try {
            const room = await redis.hget(ROOM_MAPPINGS_KEY, socket.id);
            if (room) {
                const peers = await getRoomPeers(room);
                logEvent(socket.id, 'Cleaning up room', { room, peers });

                // Notify other peers
                socket.to(room).emit("peer-disconnected", { peerId: socket.id });

                // Clean up Redis
                await redis.hdel(ROOM_MAPPINGS_KEY, socket.id);

                // Handle remaining peer
                for (const peerId of peers) {
                    if (peerId !== socket.id) {
                        io.to(peerId).emit("waiting");
                    }
                }
            }

            // Remove from waiting list if present
            await redis.lrem(WAITING_USERS_KEY, 0, socket.id);
        } catch (error) {
            logEvent(socket.id, 'Error handling disconnect', error);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});