//import { useState } from 'react';
import { Link } from "react-router-dom";
import { MessageCircle, Video } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl rounded-2xl p-8 w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-12">
          Don't choose videochat yet
        </h1>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Text Only Mode */}
          <Link
            to="/text-chat"
            className="group block p-6 bg-gray-50 hover:bg-gray-100 rounded-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-2 hover:shadow-lg"
          >
            <div className="flex flex-col items-center">
              <MessageCircle
                className="w-16 h-16 text-blue-500 mb-4 group-hover:text-blue-600 transition-colors"
                strokeWidth={1.5}
              />
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Text Chat
              </h2>
              <p className="text-gray-600 text-center">Anonymous Text Chat</p>
            </div>
          </Link>

          {/* Video Mode */}
          <Link
            to="/video-chat"
            className="group block p-6 bg-gray-50 hover:bg-gray-100 rounded-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-2 hover:shadow-lg"
          >
            <div className="flex flex-col items-center">
              <Video
                className="w-16 h-16 text-purple-500 mb-4 group-hover:text-purple-600 transition-colors"
                strokeWidth={1.5}
              />
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Video Chat
              </h2>
              <p className="text-gray-600 text-center">Video Chat</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
