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
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream>(new MediaStream());
  const [connectionStatus, setConnectionStatus] = useState("Initializing...");
 

  const turnUsername = import.meta.env.VITE_TWILIO_TURN_USERNAME || "";
  const turnCredential = import.meta.env.VITE_TWILIO_TURN_PASSWORD || "";
  const logEvent = (event: string, data?: any) => {
    console.log(`[${new Date().toISOString()}] ${event}`, data || "");
  };

  const fetchTurnServers = async () => {
    try {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
      const response = await fetch(`${backendUrl}/api/turn`);
      const data = await response.json();
      console.log("✅ Fetched fresh TURN servers:", data.iceServers);
      return data.iceServers;
    } catch (error) {
      console.error("❌ Failed to fetch TURN servers:", error);
      return [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:global.turn.twilio.com:3478?transport=tcp",
          username: turnUsername,
          credential: turnCredential,
        },
      ];
    }
  };

  useEffect(() => {
    logEvent("Component mounted", { socketId: socket.id, room });

    //let isInitiator = false;
    let iceCandidateBuffer: RTCIceCandidate[] = [];

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
        setConnectionStatus("Failed to access camera/microphone");
        throw error;
      }
    };

    const createPeerConnection = async () => {
      const iceServers = await fetchTurnServers();

      const pc = new RTCPeerConnection({ iceServers });

      // Monitor connection state changes
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        logEvent(`ICE connection state changed: ${state}`);
        

        if (state === "connected" || state === "completed") {
          setConnectionStatus("Connected");
          socket.emit("connection-status", { status: "connected", room });
        } else if (
          state === "failed" ||
          state === "disconnected" ||
          state === "closed"
        ) {
          setConnectionStatus("Connection failed - trying to reconnect...");
          socket.emit("connection-status", { status: "failed", room });
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          logEvent("📡 Generated ICE candidate", event.candidate);
          socket.emit("ice-candidate", { candidate: event.candidate, room });
        } else {
          logEvent("✅ ICE gathering complete, no more candidates");
        }
      };

      pc.ontrack = (event) => {
        logEvent("📡 Received remote track", event.track);
        remoteStream.current.addTrack(event.track);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream.current;
        }
        setConnectionStatus("Received media stream");
      };

      return pc;
    };

    const initializeWebRTC = async () => {
      try {
        setConnectionStatus("Setting up media devices...");
        const stream = await setupMediaStream();

        setConnectionStatus("Creating peer connection...");
        peerConnection.current = await createPeerConnection();
        const pc = peerConnection.current;

        // Add local tracks to the connection
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // REGISTER ALL EVENT HANDLERS BEFORE JOINING ROOM

        socket.on("ice-candidate", async ({ candidate }) => {
          logEvent("📡 Received ICE candidate", candidate);

          if (!pc.remoteDescription) {
            logEvent("⚠️ Buffering ICE candidate - no remote description yet");
            iceCandidateBuffer.push(new RTCIceCandidate(candidate));
            return;
          }

          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            logEvent("✅ Added ICE candidate successfully");
          } catch (err) {
            console.error("❌ Error adding ICE candidate:", err);
          }
        });

        socket.on("offer", async ({ offer }) => {
          try {
            logEvent("📡 Received offer, setting remote description");
            setConnectionStatus("Received offer, creating answer...");
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            while (iceCandidateBuffer.length > 0) {
              const candidate = iceCandidateBuffer.shift();
              if (candidate) {
                await pc.addIceCandidate(candidate);
                logEvent("✅ Added buffered ICE candidate after offer");
              }
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("answer", { answer, room });
            logEvent("📡 Sent answer");
            setConnectionStatus("Answer sent, establishing connection...");
          } catch (err) {
            console.error("❌ Error handling offer:", err);
            setConnectionStatus("Error creating answer");
          }
        });

        socket.on("answer", async ({ answer }) => {
          try {
            logEvent("📡 Received answer, setting remote description");
            await pc.setRemoteDescription(new RTCSessionDescription(answer));

            while (iceCandidateBuffer.length > 0) {
              const candidate = iceCandidateBuffer.shift();
              if (candidate) {
                await pc.addIceCandidate(candidate);
                logEvent("✅ Added buffered ICE candidate after answer");
              }
            }

            setConnectionStatus("Answer received, establishing connection...");
          } catch (err) {
            console.error("❌ Error handling answer:", err);
            setConnectionStatus("Error processing answer");
          }
        });

        socket.on("start-call", async () => {
          logEvent("📞 Received start-call event");
          setConnectionStatus("Call starting...");
        });

        socket.on("peer-disconnected", ({ peerId }) => {
          logEvent(`👋 Peer disconnected: ${peerId}`);
          setConnectionStatus("Peer disconnected - waiting for new connection");

          // Close WebRTC connection
          if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
          }

          // Clear remote video
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }

          // Notify server to rejoin waiting queue
          socket.emit("queue-join");
        });

        socket.emit("join-room", room);
        setConnectionStatus("Joining room...");
      } catch (error) {
        logEvent("❌ WebRTC initialization failed", error);
        setConnectionStatus("Failed to initialize WebRTC");
      }
    };

    initializeWebRTC();

    return () => {
      logEvent("🛑 Cleaning up");
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
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
        <div className="absolute bottom-4 right-4 w-48 h-32 rounded-lg overflow-hidden shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
        <div className="absolute top-4 left-4 bg-black bg-opacity-50 text-white p-2 rounded">
          <span>{connectionStatus}</span>
        </div>
      </div>
    </div>
  );
}
