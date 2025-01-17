import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function ChatApp() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");

  useEffect(() => {
    const socketInstance = io("http://localhost:3000", {
      transports: ["websocket"],
    });

    socketInstance.on("connect", () => {
      console.log("connected to server!");
    });

    socketInstance.on("message", (message: string) => {
      setMessages((prev) => [...prev, message]);
    });

    setSocket(socketInstance);

    return () => {
      if (socketInstance && socketInstance.connected) {
        socketInstance.disconnect();
        console.log("disconnected from server.");
      }
    };
  }, []);

  const sendMessage = () => {
    if (input.trim() && socket) {
      socket.emit("message", input.trim());
      setMessages((prev) => [...prev, `You: ${input.trim()}`]);
      setInput("");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <h1 className="text-2xl font-bold mb-4">Chat App</h1>
      <div className="w-1/2 h-64 bg-white rounded shadow p-4 overflow-y-auto mb-4">
        {messages.map((msg, idx) => (
          <p key={idx} className="text-sm text-gray-800 mb-2">
            {msg}
          </p>
        ))}
      </div>
      <div className="flex w-1/2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          className="flex-1 border border-gray-300 rounded-l px-4 py-2 focus:outline-none"
        />
        <button
          onClick={sendMessage}
          className="bg-blue-500 text-white px-4 py-2 rounded-r hover:bg-blue-600"
        >
          send
        </button>
      </div>
    </div>
  );
}
