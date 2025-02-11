import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";

interface ChatComponentProps {
  socket: Socket;
  room: string;
}

export default function ChatComponent({ socket, room }: ChatComponentProps) {
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>(
    []
  );
  const [input, setInput] = useState<string>("");

  useEffect(() => {
    // Log when component mounts
    console.log("🟢 Chat component mounted for room:", room);
    console.log("🟢 Socket connection status:", socket.connected);

    // Monitor socket connection status
    socket.on("connect", () => {
      console.log("🟢 Socket connected");
    });

    socket.on("disconnect", () => {
      console.log("⚠️ Socket disconnected");
    });

    socket.on("connect_error", (error) => {
      console.error("❌ Socket connection error:", error);
    });

    // Message handling
    socket.on("message", ({ sender, message }) => {
      console.log("📨 Received message:", {
        sender,
        message,
        isOwnMessage: sender === socket.id,
      });

      setMessages((prev) => {
        const newMessages = [...prev, { sender, text: message }];
        console.log("📨 Updated messages:", newMessages);
        return newMessages;
      });
    });

    // Cleanup
    return () => {
      console.log("🟢 Cleaning up chat component");
      socket.off("message");
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
    };
  }, [socket, room]);

  const sendMessage = () => {
    const trimmedMessage = input.trim();
    if (trimmedMessage) {
      console.log("📤 Sending message:", {
        room,
        message: trimmedMessage,
      });

      socket.emit("message", { room, message: trimmedMessage });

      setInput("");
      console.log("🟢 Message input cleared");
    } else {
      console.log("⚠️ Attempted to send empty message");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-50 to-gray-100 font-sans">
      {/* Chat Header */}
      <div className="bg-white shadow-sm p-4 border-b border-gray-200">
        <h1 className="text-xl font-semibold text-gray-800">Chat Room</h1>
        <p className="text-sm text-gray-500">Room: {room}</p>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${
              msg.sender === socket.id ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-md rounded-lg px-4 py-2 shadow-sm transition-all duration-200 ${
                msg.sender === socket.id
                  ? "bg-blue-500 text-white"
                  : "bg-white text-gray-800"
              }`}
            >
              <div className="text-xs font-medium mb-1">
                {msg.sender === socket.id ? "You" : "Anonymous"}
              </div>
              <div className="text-sm break-words">{msg.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Chat Input */}
      <div className="bg-white p-4 border-t border-gray-200">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            className="flex-1 rounded-full px-4 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
          />
          <button
            onClick={sendMessage}
            className="rounded-full bg-blue-500 text-white px-6 py-2 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
