import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import VideoChat from "../components/VideoChat";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "../index.css";

export default function VideoChatPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const socketInstance = io(
      import.meta.env.VITE_BACKEND_URL || "http://localhost:3000",
      {
        transports: ["websocket"],
      }
    );

    socketInstance.on("paired", ({ room }: { room: string }) => {
      console.log("✅ Room paired, waiting for WebRTC to establish...");
      setRoom(room);
    });

    socketInstance.on("start-call", () => {
      console.log("📞 Call is starting, WebRTC connection should begin...");
      setIsLoading(false);
    });

    socketInstance.on("waiting", () => {
      setRoom(null);
      setIsLoading(true);
    });

    socketInstance.on("connect", () => {
      setIsLoading(false); // Set loading to false when connected
    });

    socketInstance.on("disconnect", () => {
      setRoom(null); // Reset room on disconnect
      setIsLoading(true);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      <header className="absolute top-0 left-0 right-0 z-10 bg-gray-950 bg-opacity-70 text-white px-4 py-2 flex items-center justify-between">
  <Link to="/" className="flex items-center space-x-2 hover:text-gray-300">
    <ArrowLeft className="w-5 h-5" />
    <span className="text-sm">Back</span>
  </Link>
  <span className="text-xs text-gray-400">
    {room ? `Room: ${room}` : "Waiting for Partner"}
  </span>
</header>


      <main className="flex-1">
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
