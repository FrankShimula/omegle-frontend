import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function ChatApp() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>(
    []
  );
  const [input, setInput] = useState<string>("");

  useEffect(() => {
    const socketInstance = io(
      import.meta.env.VITE_WS_URL || "http://localhost:3000",
      {
        transports: ["websocket"],
      }
    );

    socketInstance.on("connect", () => {
      console.log("connected to server!");
    });

    socketInstance.on("paired", ({ room }) => {
      console.log(`paired in room: ${room}`);
      setRoom(room);
    });

    // Updated message handler to properly handle incoming messages
    socketInstance.on("message", ({ sender, message }) => {
      console.log("Received message:", { sender, message });
      setMessages((prev) => [...prev, { sender, text: message }]);
    });

    socketInstance.on("waiting", (message: string) => {
      console.log(message);
      setRoom(null);
      setMessages([]);
    });

    setSocket(socketInstance);

    return () => {
      if (socketInstance.connected) {
        socketInstance.disconnect();
        console.log("disconnected from server.");
      }
    };
  }, []);

  const sendMessage = () => {
    const trimmedMessage = input.trim();
    if (trimmedMessage && socket?.id && room) {
      // Emit the message to the server
      socket.emit("message", { room, message: trimmedMessage });

      // Don't add the message locally anymore - wait for the server to broadcast it back
      setInput("");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="bg-blue-500 p-4">
          <h1 className="text-xl font-semibold text-white">
            {room ? "Chat Room" : "Waiting Room"}
          </h1>
        </div>

        {room ? (
          <>
            <div className="h-96 p-4 overflow-y-auto">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex mb-4 ${
                    msg.sender === socket?.id ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`rounded-lg px-4 py-2 max-w-xs ${
                      msg.sender === socket?.id
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    <div className="text-xs mb-1">
                      {msg.sender === socket?.id ? "You" : "Anonymous"}
                    </div>
                    <div className="break-words">{msg.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 rounded-full px-4 py-2 bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={sendMessage}
                  className="rounded-full bg-blue-500 text-white px-6 py-2 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="h-96 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600">
                Waiting to be paired with another user...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
