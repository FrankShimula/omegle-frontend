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

// basic health check route
app.get('/', (req, res) => {
    res.status(200).send('Server is healthy');
});

// Make sure we have the Redis URL
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    console.error("REDIS_URL not found in environment variables");
    process.exit(1);
}

// Connect to Redis Cloud
const redis = new Redis(REDIS_URL);

// Test Redis connection
redis.on('connect', () => {
    console.log('Successfully connected to Redis');
});

redis.on('error', (error) => {
    console.error('Redis connection error:', error);
});


// Redis Keys
const WAITING_USERS_KEY = "chat:waiting_users";
const ROOM_MAPPINGS_KEY = "chat:room_mappings";
const MESSAGE_RATE_LIMIT = "chat:rate_limit";

// Helper function to check rate limit
async function checkRateLimit(userId) {
    const count = await redis.incr(`${MESSAGE_RATE_LIMIT}:${userId}`);
    if (count === 1) {
        await redis.expire(`${MESSAGE_RATE_LIMIT}:${userId}`, 60); // 60 seconds window
    }
    return count <= 20; // 20 messages per minute
}

io.on("connection", async (socket) => {
    console.log("a user connected:", socket.id);

    try {
        // Check for waiting users
        const waitingUser = await redis.lpop(WAITING_USERS_KEY);

        if (waitingUser) {
            // Create a room and pair users
            const room = `room-${socket.id}-${waitingUser}`;

            // Store room mappings
            await redis.hset(ROOM_MAPPINGS_KEY, socket.id, room);
            await redis.hset(ROOM_MAPPINGS_KEY, waitingUser, room);

            // Join the room
            socket.join(room);
            const waitingSocket = io.sockets.sockets.get(waitingUser);
            if (waitingSocket) {
                waitingSocket.join(room);
            }

            // Notify both users
            socket.emit("paired", { room });
            io.to(waitingUser).emit("paired", { room });

            console.log(`paired ${socket.id} with ${waitingUser} in ${room}`);
        } else {
            // Add user to waiting list
            await redis.rpush(WAITING_USERS_KEY, socket.id);
            console.log(`user ${socket.id} is waiting`);
            socket.emit("waiting", "Waiting for a partner...");
        }

        // Handle messages
        socket.on("message", async ({ room, message }) => {
            try {
                // Check rate limit
                const withinLimit = await checkRateLimit(socket.id);
                if (!withinLimit) {
                    return socket.emit("error", "Rate limit exceeded. Please wait a moment.");
                }

                // Store message in Redis
                await redis.lpush(`chat:messages:${room}`, JSON.stringify({
                    sender: socket.id,
                    message,
                    timestamp: Date.now()
                }));
                await redis.ltrim(`chat:messages:${room}`, 0, 99); // Keep last 100 messages

                // Broadcast message
                io.to(room).emit("message", {
                    sender: socket.id,
                    message
                });
            } catch (error) {
                console.error("Error handling message:", error);
                socket.emit("error", "Failed to send message");
            }
        });

        // Handle disconnection
        socket.on("disconnect", async () => {
            console.log("user disconnected:", socket.id);

            try {
                // Get user's room
                const room = await redis.hget(ROOM_MAPPINGS_KEY, socket.id);

                if (room) {
                    // Clean up room mappings
                    const clients = await io.in(room).allSockets();
                    for (const clientId of clients) {
                        if (clientId !== socket.id) {
                            // Remove other user's room mapping
                            await redis.hdel(ROOM_MAPPINGS_KEY, clientId);
                            // Add them back to waiting list
                            await redis.rpush(WAITING_USERS_KEY, clientId);
                            // Notify them
                            io.to(clientId).emit("waiting", "Your partner disconnected. Waiting for a new partner...");
                        }
                    }
                    // Remove disconnected user's room mapping
                    await redis.hdel(ROOM_MAPPINGS_KEY, socket.id);
                }

                // Remove from waiting list if present
                await redis.lrem(WAITING_USERS_KEY, 0, socket.id);

                // Clean up rate limit data
                await redis.del(`${MESSAGE_RATE_LIMIT}:${socket.id}`);
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