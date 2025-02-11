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

app.get('/', (req, res) => {
    res.status(200).send('Server is healthy');
});

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    console.error("REDIS_URL not found in environment variables");
    process.exit(1);
}

const redis = new Redis(REDIS_URL);

redis.on('connect', () => {
    console.log('Successfully connected to Redis');
});

// Redis Keys
const WAITING_USERS_KEY = "chat:waiting_users";
const ROOM_MAPPINGS_KEY = "chat:room_mappings";
const PEER_CONNECTIONS_KEY = "chat:peer_connections"; // New key for tracking peer states

// Helper function to get room peers
async function getRoomPeers(room) {
    const roomPeers = [];
    const mappings = await redis.hgetall(ROOM_MAPPINGS_KEY);

    for (const [socketId, roomId] of Object.entries(mappings)) {
        if (roomId === room) {
            roomPeers.push(socketId);
        }
    }
    return roomPeers;
}

// Helper function to log connection state
async function logConnectionState(socketId, room) {
    const peers = await getRoomPeers(room);
    console.log(`Room ${room} connection state:`, {
        currentSocket: socketId,
        peers,
        timestamp: new Date().toISOString()
    });
}

io.on("connection", async (socket) => {
    console.log("New connection:", socket.id);
    let currentRoom = null;

    try {
        const waitingUser = await redis.lpop(WAITING_USERS_KEY);

        if (waitingUser) {
            // Create a room and pair users
            const room = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            currentRoom = room;

            // Store room mappings atomically
            await redis.multi()
                .hset(ROOM_MAPPINGS_KEY, socket.id, room)
                .hset(ROOM_MAPPINGS_KEY, waitingUser, room)
                .exec();

            socket.join(room);
            const waitingSocket = io.sockets.sockets.get(waitingUser);
            if (waitingSocket) {
                waitingSocket.join(room);
                console.log(`Created room ${room} with peers:`, socket.id, waitingUser);

                // Initialize peer connection states
                await redis.hset(PEER_CONNECTIONS_KEY,
                    `${room}:${socket.id}`, 'new',
                    `${room}:${waitingUser}`, 'new'
                );

                // Initiate the WebRTC process
                waitingSocket.emit("initiate-call", { room });
                socket.emit("paired", { room });
                waitingSocket.emit("paired", { room });
            }
        } else {
            await redis.rpush(WAITING_USERS_KEY, socket.id);
            console.log(`User ${socket.id} waiting for peer`);
            socket.emit("waiting");
        }

        // WebRTC signaling handlers with improved logging and verification
        socket.on("offer", async ({ offer, room }) => {
            try {
                const isInRoom = await redis.hget(ROOM_MAPPINGS_KEY, socket.id) === room;
                if (!isInRoom) {
                    return socket.emit("error", "Not authorized for this room");
                }

                console.log(`Processing offer from ${socket.id} in room ${room}`);
                await logConnectionState(socket.id, room);

                socket.to(room).emit("offer", { offer, room });
            } catch (error) {
                console.error("Error handling offer:", error);
                socket.emit("error", "Failed to process offer");
            }
        });

        socket.on("answer", async ({ answer, room }) => {
            try {
                const isInRoom = await redis.hget(ROOM_MAPPINGS_KEY, socket.id) === room;
                if (!isInRoom) {
                    return socket.emit("error", "Not authorized for this room");
                }

                console.log(`Processing answer from ${socket.id} in room ${room}`);
                await logConnectionState(socket.id, room);

                socket.to(room).emit("answer", { answer, room });
            } catch (error) {
                console.error("Error handling answer:", error);
                socket.emit("error", "Failed to process answer");
            }
        });

        socket.on("ice-candidate", async ({ candidate, room }) => {
            try {
                const isInRoom = await redis.hget(ROOM_MAPPINGS_KEY, socket.id) === room;
                if (!isInRoom) {
                    return socket.emit("error", "Not authorized for this room");
                }

                // Log the ICE candidate details
                console.log(`ICE candidate from ${socket.id} in room ${room}:`, {
                    type: candidate.type,
                    protocol: candidate.protocol,
                    address: candidate.address,
                    port: candidate.port,
                    timestamp: new Date().toISOString()
                });

                // Forward the candidate to the other peer
                const peers = await getRoomPeers(room);
                const otherPeer = peers.find(id => id !== socket.id);
                if (otherPeer) {
                    io.to(otherPeer).emit("ice-candidate", {
                        candidate,
                        from: socket.id
                    });
                }

                await logConnectionState(socket.id, room);
            } catch (error) {
                console.error("Error handling ICE candidate:", error);
                socket.emit("error", "Failed to process ICE candidate");
            }
        });

        // Handle disconnection with improved cleanup
        socket.on("disconnect", async () => {
            console.log("User disconnected:", socket.id);

            try {
                const room = await redis.hget(ROOM_MAPPINGS_KEY, socket.id);

                if (room) {
                    const peers = await getRoomPeers(room);
                    console.log(`Cleaning up room ${room} after disconnect of ${socket.id}`);

                    // Notify other peers
                    socket.to(room).emit("peer-disconnected", { peerId: socket.id });

                    // Clean up Redis
                    await redis.multi()
                        .hdel(ROOM_MAPPINGS_KEY, socket.id)
                        .hdel(PEER_CONNECTIONS_KEY, `${room}:${socket.id}`)
                        .exec();

                    // Handle remaining peer
                    for (const peerId of peers) {
                        if (peerId !== socket.id) {
                            await redis.rpush(WAITING_USERS_KEY, peerId);
                            io.to(peerId).emit("waiting");
                        }
                    }
                }

                // Remove from waiting list if present
                await redis.lrem(WAITING_USERS_KEY, 0, socket.id);

            } catch (error) {
                console.error("Error handling disconnection:", error);
            }
        });

    } catch (error) {
        console.error("Error in connection handler:", error);
        socket.emit("error", "Failed to establish connection");
    }
});

// Error handling for Redis
redis.on("error", (error) => {
    console.error("Redis error:", error);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await redis.quit();
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});