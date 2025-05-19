import { Link } from "react-router-dom";
import { MessageCircle, Video } from "lucide-react";
import "../index.css"


export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="text-center space-y-10">
        <div className="space-x-6">
          <Link
            to="/text-chat"
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white text-lg font-semibold rounded-full shadow-md hover:bg-blue-700 transition"
          >
            <MessageCircle className="w-5 h-5 mr-2" /> Text Chat
          </Link>
          <Link
            to="/video-chat"
            className="inline-flex items-center px-6 py-3 bg-purple-600 text-white text-lg font-semibold rounded-full shadow-md hover:bg-purple-700 transition"
          >
            <Video className="w-5 h-5 mr-2" /> Video Chat
          </Link>
        </div>
        <p className="text-gray-400 text-sm">
          connect. chat. disappear. — no accounts, no history.
        </p>
      </div>
    </div>
  );
}
