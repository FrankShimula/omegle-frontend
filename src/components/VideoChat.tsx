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

  useEffect(() => {
    const initializeWebRTC = async () => {
      try {
        // Get user media (camera and microphone)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        // Display local video
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" }, // STUN server
            // Add TURN servers for production
          ],
        });
        peerConnection.current = pc;

        // Add local stream to peer connection
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // Handle remote tracks
        pc.ontrack = (event) => {
          console.log("ontrack fired, streams:", event.streams);
          if (event.streams[0] && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("sending ICE candidate:", event.candidate);
            socket.emit("ice-candidate", {
              candidate: event.candidate,
              room,
            });
          }
        };

        // Create and send an offer if we're the initiator
        socket.on("initiate-call", async () => {
          console.log("initiating call...");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("offer", { offer, room });
        });

        // Handle incoming offer
        socket.on("offer", async ({ offer }) => {
          console.log("received offer:", offer);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("answer", { answer, room });
        });

        // Handle incoming answer
        socket.on("answer", async ({ answer }) => {
          console.log("received answer:", answer);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        // Handle incoming ICE candidates
        socket.on("ice-candidate", async ({ candidate }) => {
          console.log("received ICE candidate:", candidate);
          if (candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        });
      } catch (error) {
        console.error("error initializing webrtc:", error);
      }
    };

    initializeWebRTC();

    return () => {
      // Cleanup peer connection and local video tracks
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
          .catch((err) => console.error("error enabling fullscreen:", err));
      } else {
        document
          .exitFullscreen()
          .then(() => setIsFullscreen(false))
          .catch((err) => console.error("error exiting fullscreen:", err));
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 overflow-hidden">
      <div className="video-container flex-1 relative">
        {/* Remote Video */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />

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
