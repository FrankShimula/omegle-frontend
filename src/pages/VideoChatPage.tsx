import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import VideoChat from "../components/VideoChat";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function VideoChatPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const socketInstance = io(
      import.meta.env.VITE_WS_URL || "http://localhost:3000",
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
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
      <header className="bg-white shadow-sm p-4 flex items-center">
        <Link to="/" className="mr-4">
          <ArrowLeft className="text-gray-600 hover:text-gray-900" />
        </Link>
        <h1 className="text-xl font-semibold">
          {room ? "Video Chat" : "Waiting for Partner"}
        </h1>
      </header>

      <main className="flex-grow flex flex-col">
        {socket && room ? (
          <div className="h-full flex-grow">
            <VideoChat socket={socket} room={room} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              {isLoading ? (
                <div className="flex flex-col items-center space-y-4">
                  <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                  <p className="text-gray-600">
                    Waiting for a partner to join...
                  </p>
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
