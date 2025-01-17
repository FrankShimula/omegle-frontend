import express from "express";
import { Server as SocketIOServer } from "socket.io";
import http from "http";

// Initialize express app and server
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: "http://localhost:5173",  // Vite client URL
        methods: ["GET", "POST"]
    }
});

// Handle new connections from clients
io.on("connection", (socket) => {
    console.log("a user connected:", socket.id);

    // listen for incoming messages
    socket.on("message", (data) => {
        console.log("message received:", data);

        // broadcast the message to all other clients
        socket.broadcast.emit("message", data);
    });

    socket.on("disconnect", () => {
        console.log("user disconnected:", socket.id);
    });
});


// Start the server
server.listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
});
