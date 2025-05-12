import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import VideoChat from "../components/VideoChat";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function VideoChatPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const socketInstance = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:3000", {
      transports: ["websocket"],
      query: { mode: "video" },
    });

    socketInstance.on("paired", ({ room }: { room: string }) => {
      setRoom(room);
      setIsLoading(false);
    });

    socketInstance.on("waiting", () => {
      setRoom(null);
      setIsLoading(true);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <header className="bg-gray-950 bg-opacity-70 text-white px-4 py-2 flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-2 hover:text-gray-300">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">Back</span>
        </Link>
        <span className="text-xs text-gray-400">
          {room ? `` : "Waiting for Partner"}
        </span>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {socket && room ? (
          <VideoChat socket={socket} room={room} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              {isLoading ? (
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              ) : (
                <p className="text-gray-600">Room found.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
