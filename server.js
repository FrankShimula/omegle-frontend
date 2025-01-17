import express from "express";
import { Server as SocketIOServer } from "socket.io";
import http from "http";

// initialize express app and server
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: "http://localhost:5173", // vite client url
        methods: ["GET", "POST"],
    },
});

// store unmatched users
const waitingUsers = [];

io.on("connection", (socket) => {
    console.log("a user connected:", socket.id);

    // check if there is another user waiting
    if (waitingUsers.length > 0) {
        const otherUser = waitingUsers.pop();

        // create a private room for the two users
        const room = `room-${socket.id}-${otherUser.id}`;
        socket.join(room);
        otherUser.join(room);

        // notify users they've been paired
        socket.emit("paired", { room });
        otherUser.emit("paired", { room });

        // store room info on the socket for later cleanup
        socket.data.room = room;
        otherUser.data.room = room;

        console.log(`paired ${socket.id} with ${otherUser.id} in ${room}`);
    } else {
        // no users waiting, add this user to the queue
        waitingUsers.push(socket);
        console.log(`user ${socket.id} is waiting`);
    }

    // listen for messages in the private room
    socket.on("message", ({ room, message }) => {
        // Include sender information when broadcasting the message
        io.to(room).emit("message", {
            sender: socket.id,
            message: message
        });
    });

    // handle disconnection
    socket.on("disconnect", () => {
        console.log("user disconnected:", socket.id);

        // remove the user from the queue if they were waiting
        const index = waitingUsers.findIndex((user) => user.id === socket.id);
        if (index !== -1) {
            waitingUsers.splice(index, 1);
        }

        // notify the other user in the room
        const room = socket.data.room;
        if (room) {
            const clientsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
            clientsInRoom.forEach((clientId) => {
                if (clientId !== socket.id) {
                    const otherUser = io.sockets.sockets.get(clientId);
                    otherUser.leave(room);
                    waitingUsers.push(otherUser); // return them to the queue
                    otherUser.emit("waiting", "The other user disconnected. Waiting for a new connection...");
                }
            });
        }
    });
});


// start the server
server.listen(3000, () => {
    console.log("server is running on http://localhost:3000");
});
