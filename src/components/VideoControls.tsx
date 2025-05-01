import { useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

export default function VideoControls({ onEndCall }: { onEndCall: () => void }) {
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4 z-50">
      {/* Mic Toggle */}
      <button
        onClick={() => setMicOn(!micOn)}
        className="bg-gray-800 text-white p-4 rounded-full hover:bg-gray-700 transition"
        aria-label="Toggle Microphone"
      >
        {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
      </button>

      {/* Video Toggle */}
      <button
        onClick={() => setVideoOn(!videoOn)}
        className="bg-gray-800 text-white p-4 rounded-full hover:bg-gray-700 transition"
        aria-label="Toggle Video"
      >
        {videoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
      </button>

      {/* End Call */}
      <button
        onClick={onEndCall}
        className="bg-red-600 text-white p-4 rounded-full hover:bg-red-700 transition"
        aria-label="End Call"
      >
        <PhoneOff className="w-6 h-6" />
      </button>
    </div>
  );
}
