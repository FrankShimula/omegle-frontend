import "../utils/Debug";
import { useEffect, useRef, useState } from "react";
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMessage = () => {
    const trimmedMessage = input.trim();
    if (trimmedMessage) {
      socket.emit("message", { room, message: trimmedMessage });
      setInput("");
    }
  };

  return (
    <div className="h-screen-dynamic flex flex-col h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 font-sans text-white">
      {/* 
      <div className="bg-black/40 backdrop-blur-sm py-2 px-3 border-b border-gray-700 shrink-0">
        <h1 className="text-lg font-bold">Anonymous Chat</h1>
        <p className="text-xs text-gray-400">Room ID: {room}</p>
      </div>*/}

      {/* messages */}
      <div className="flex-1 px-4 py-6 overflow-y-auto space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${
              msg.sender === socket.id ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-md px-4 py-3 rounded-2xl shadow-md animate-pop-in ${
                msg.sender === socket.id
                  ? "bg-purple-600 text-white"
                  : "bg-gray-700 text-white"
              }`}
            >
              <div className="text-xs font-medium mb-1 text-gray-300">
                {msg.sender === socket.id ? "You" : "Anonymous"}
              </div>
              <div className="text-sm break-words">{msg.text}</div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* input */}
      <div className="bg-black/30 backdrop-blur-lg p-4 border-t border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            className="flex-1 bg-gray-800 text-white px-4 py-2 rounded-full focus:ring-2 ring-purple-500 outline-none placeholder-gray-400"
          />
          <button
            onClick={sendMessage}
            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-full transition"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
