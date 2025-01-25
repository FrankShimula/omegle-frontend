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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    // Initialize WebRTC when component mounts
    const initializeWebRTC = async () => {
      try {
        // Get user media (camera and microphone)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        // Set the local stream
        setLocalStream(stream);

        // Display local video in the mini screen
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Create and configure peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            // Add TURN servers for production
          ],
        });
        peerConnection.current = pc;

        // Add local stream tracks to peer connection
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Handle incoming tracks (remote video)
        pc.ontrack = (event) => {
          console.log("Remote track received:", event.track);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
            setRemoteStream(event.streams[0]);
          }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("Sending ICE candidate:", event.candidate);
            socket.emit("ice-candidate", {
              candidate: event.candidate,
              room,
            });
          }
        };

        // Create and send offer if we're the initiator
        socket.on("initiate-call", async () => {
          console.log("Initiating call...");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log("Sending offer:", offer);
          socket.emit("offer", { offer, room });
        });

        // Handle incoming offer
        socket.on("offer", async ({ offer }) => {
          console.log("Received offer:", offer);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log("Sending answer:", answer);
          socket.emit("answer", { answer, room });
        });

        // Handle incoming answer
        socket.on("answer", async ({ answer }) => {
          console.log("Received answer:", answer);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        // Handle incoming ICE candidates
        socket.on("ice-candidate", async ({ candidate }) => {
          console.log("Received ICE candidate:", candidate);
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
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [socket, room]);

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!isMuted);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!isVideoOff);
      }
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
