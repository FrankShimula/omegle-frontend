import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";

interface VideoChatProps {
  socket: Socket;
  room: string;
}

export default function VideoChat({ socket, room }: VideoChatProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    // Initialize WebRTC when component mounts
    const initializeWebRTC = async () => {
      try {
        // Get user media (camera and microphone)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        // Clone the stream for local preview
        const previewStream = new MediaStream(stream.getTracks());
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = previewStream; // Display local video in mini screen
        }

        // Create and configure peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            // Add TURN servers for production
          ],
        });
        peerConnection.current = pc;

        // Add ORIGINAL stream tracks to peer connection
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Handle incoming tracks (remote video)
        pc.ontrack = (event) => {
          console.log("🟢 REMOTE TRACK RECEIVED", event.streams[0]);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
            setRemoteStream(event.streams[0]);
          }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("🟢 SENDING ICE CANDIDATE", event.candidate);
            socket.emit("ice-candidate", {
              candidate: event.candidate,
              room,
            });
          }
        };

        // Create and send offer if we're the initiator
        socket.on("initiate-call", async () => {
          console.log("🟢 INITIATING CALL");
          const offer = await pc.createOffer();
          console.log("OFFER CREATED:", offer);
          await pc.setLocalDescription(offer);
          socket.emit("offer", { offer, room });
        });

        // Handle incoming offer
        socket.on("offer", async ({ offer }) => {
          console.log("🟢 OFFER RECEIVED");
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          console.log("ANSWER CREATED:", answer);
          await pc.setLocalDescription(answer);
          socket.emit("answer", { answer, room });
        });

        // Handle incoming answer
        socket.on("answer", async ({ answer }) => {
          console.log("🟢 ANSWER RECEIVED");
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        // Handle incoming ICE candidates
        socket.on("ice-candidate", async ({ candidate }) => {
          console.log("🟢 ICE CANDIDATE RECEIVED", candidate);
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        });
      } catch (error) {
        console.error("Error initializing WebRTC:", error);
      }
    };

    initializeWebRTC();

    // Cleanup
    return () => {
      peerConnection.current?.close();
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [socket, room]);

  const toggleMute = () => {
    const stream = localVideoRef.current?.srcObject as MediaStream;
    const audioTrack = stream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    const stream = localVideoRef.current?.srcObject as MediaStream;
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleFullscreen = () => {
    const videoContainer = document.querySelector(".video-container");
    if (videoContainer) {
      if (!document.fullscreenElement) {
        videoContainer
          .requestFullscreen()
          .then(() => setIsFullscreen(true))
          .catch((err) => {
            console.error("Error attempting to enable fullscreen:", err);
          });
      } else {
        document
          .exitFullscreen()
          .then(() => setIsFullscreen(false))
          .catch((err) => {
            console.error("Error attempting to exit fullscreen:", err);
          });
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 overflow-hidden">
      {/* Video Grid */}
      <div className="video-container flex-1 relative">
        {/* Remote Video */}
        {remoteStream ? (
          <div className="absolute inset-0">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <p className="text-gray-400">Waiting for remote video...</p>
          </div>
        )}

        {/* Local Video (Mini Screen) */}
        <div className="absolute bottom-4 right-4 w-48 h-32 rounded-lg overflow-hidden shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>

        {/* Controls */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
          <button
            onClick={toggleMute}
            className={`p-3 rounded-full ${
              isMuted ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"
            } text-white transition-all duration-200`}
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full ${
              isVideoOff ? "bg-red-500" : "bg-gray-700 hover:bg-gray-600"
            } text-white transition-all duration-200`}
          >
            {isVideoOff ? "Start Video" : "Stop Video"}
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 text-white transition-all duration-200"
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>
    </div>
  );
}
