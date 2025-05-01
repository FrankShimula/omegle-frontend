import { Link } from "react-router-dom";
import { MessageCircle, Video } from "lucide-react";
import "../index.css";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="text-center text-white">
        <h1 className="text-4xl md:text-6xl font-bold mb-4 tracking-tight">
          connect. chat. disappear.
        </h1>
        <p className="text-lg md:text-xl text-gray-300 mb-8">
          anonymous text and video chat — no accounts, no history.
        </p>

        {/* buttons */}
        <div className="flex gap-6 justify-center">
          <Link
            to="/text-chat"
            className="group flex items-center justify-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-md hover:shadow-lg transition-transform transform hover:-translate-y-1"
          >
            <MessageCircle className="w-6 h-6" />
            Text Chat
          </Link>

          <Link
            to="/video-chat"
            className="group flex items-center justify-center gap-2 px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-full shadow-md hover:shadow-lg transition-transform transform hover:-translate-y-1"
          >
            <Video className="w-6 h-6" />
            Video Chat
          </Link>
        </div>

        {/* footer */}
        <footer className="mt-16 text-gray-400 text-sm">
          no data saved. no accounts. just chat.
        </footer>
      </div>
    </div>
  );
}
