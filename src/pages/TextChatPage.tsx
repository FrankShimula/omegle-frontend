import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import ChatComponent from "../components/Chat";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

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
    <div className="h-screen bg-gray-100 flex flex-col">
      <header className="bg-white shadow-sm p-4 flex items-center shrink-0">
        <Link to="/" className="mr-4">
          <ArrowLeft className="text-gray-600 hover:text-gray-900" />
        </Link>
        <h1 className="text-xl font-semibold">
          {room ? "Text Chat" : "Waiting for Partner"}
        </h1>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div className="w-full max-w-2xl h-full">
          {socket && room ? (
            <ChatComponent socket={socket} room={room} />
          ) : (
            <div className="text-center">
              <div className="animate-pulse">
                <div className="h-10 bg-blue-300 rounded mb-4"></div>
                <div className="h-6 bg-blue-200 rounded"></div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
