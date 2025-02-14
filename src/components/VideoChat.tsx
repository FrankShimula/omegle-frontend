import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";

interface VideoChatProps {
  socket: Socket;
  room: string;
}

export default function VideoChat({ socket, room }: VideoChatProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream>(new MediaStream());

  const logEvent = (event: string, data?: any) => {
    console.log(`[${new Date().toISOString()}] ${event}`, data || "");
  };

  useEffect(() => {
    logEvent("Component mounted", { socketId: socket.id, room });

    const setupMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStream.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        return stream;
      } catch (error) {
        logEvent("❌ Media stream setup failed", error);
        throw error;
      }
    };

    const createPeerConnection = () => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          logEvent("📡 Sending ICE candidate", event.candidate);
          socket.emit("ice-candidate", { candidate: event.candidate, room });
        }
      };

      pc.ontrack = (event) => {
        logEvent("📡 Received remote track", event.track);
        remoteStream.current.addTrack(event.track);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream.current;
        }
      };

      return pc;
    };

    const initializeWebRTC = async () => {
      const stream = await setupMediaStream();
      peerConnection.current = createPeerConnection();
      const pc = peerConnection.current;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      socket.on("ice-candidate", async ({ candidate }) => {
        logEvent("📡 Received ICE candidate", candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          logEvent("✅ ICE candidate added");
        } else {
          logEvent(
            "⚠️ ICE candidate received before remote description. Waiting..."
          );
          setTimeout(
            () => pc.addIceCandidate(new RTCIceCandidate(candidate)),
            1000
          );
        }
      });

      socket.on("offer", async ({ offer }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        logEvent("📡 Set remote description from offer");

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { answer, room });
        logEvent("📡 Sent answer");
      });

      socket.on("answer", async ({ answer }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        logEvent("📡 Set remote description from answer");
      });

      socket.on("start-call", async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { offer, room });
        logEvent("📡 Sent offer");
      });

      socket.emit("join-room", room);
      logEvent("🔗 Joined room");
    };

    initializeWebRTC();

    return () => {
      logEvent("🛑 Cleaning up");
      if (localStream.current)
        localStream.current.getTracks().forEach((track) => track.stop());
      if (peerConnection.current) peerConnection.current.close();
      socket.off("ice-candidate");
      socket.off("offer");
      socket.off("answer");
      socket.off("start-call");
    };
  }, [socket, room]);

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <div className="video-container flex-1 relative">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <div className="absolute bottom-4 right-4 w-48 h-32 rounded-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      </div>
    </div>
  );
}
