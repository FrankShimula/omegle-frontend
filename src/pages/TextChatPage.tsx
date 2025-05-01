import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import ChatComponent from "../components/Chat";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "../index.css";

export default function TextChatPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<string | null>(null);

  useEffect(() => {
    const socketInstance = io(
      import.meta.env.VITE_BACKEND_URL || "http://localhost:3000",
      {
        transports: ["websocket"],
      }
    );

    socketInstance.on("paired", ({ room }: { room: string }) => setRoom(room));
    socketInstance.on("waiting", () => setRoom(null));

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return (
    <div className="h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      <header className="bg-black/40 backdrop-blur-sm p-3 border-b border-gray-700 flex justify-between items-center text-sm text-white">
  <Link to="/" className="flex items-center space-x-1 hover:underline">
    <ArrowLeft />
    <span>Back</span>
  </Link>
  <div className="text-right">
    <div className="text-xs text-gray-300">{room}</div>
  </div>
</header>



      <main className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div className="w-full max-w-2xl h-full">
          {socket && room ? (
            <ChatComponent socket={socket} room={room} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
