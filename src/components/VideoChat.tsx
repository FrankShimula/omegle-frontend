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
  const [connectionStatus, setConnectionStatus] = useState("Initializing");
  const [iceConnectionState, setIceConnectionState] = useState("");

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

      // fallback to static credentials if fetch fails
      return [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:global.turn.twilio.com:3478?transport=tcp",
          username: import.meta.env.VITE_TWILIO_TURN_USERNAME,
          credential: import.meta.env.VITE_TWILIO_TURN_PASSWORD,
        },
      ];
    }
  };

  useEffect(() => {
    logEvent("Component mounted", { socketId: socket.id, room });

    let iceCandidateBuffer: RTCIceCandidate[] = [];
    let isInitiator = false;

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
      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
      });

      // Monitor connection state changes
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        logEvent(`ICE connection state changed: ${state}`);
        setIceConnectionState(state);

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

      pc.onconnectionstatechange = () => {
        logEvent(`Connection state changed: ${pc.connectionState}`);
      };

      pc.onsignalingstatechange = () => {
        logEvent(`Signaling state changed: ${pc.signalingState}`);
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
        stream.getTracks().forEach((track) => {
          if (pc) pc.addTrack(track, stream);
        });

        // REGISTER ALL EVENT HANDLERS BEFORE JOINING ROOM

        // Handle ice candidates from remote peer
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

        // Handle offer from remote peer
        socket.on("offer", async ({ offer }) => {
          try {
            logEvent("📡 Received offer, setting remote description");
            setConnectionStatus("Received offer, creating answer...");
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            // Process any buffered ICE candidates
            logEvent(
              `Processing ${iceCandidateBuffer.length} buffered ICE candidates`
            );
            while (iceCandidateBuffer.length > 0) {
              const candidate = iceCandidateBuffer.shift();
              if (candidate) {
                await pc.addIceCandidate(candidate);
                logEvent("✅ Added buffered ICE candidate after offer");
              }
            }

            // Create and send answer
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

        // Handle answer from remote peer
        socket.on("answer", async ({ answer }) => {
          try {
            logEvent("📡 Received answer, setting remote description");
            await pc.setRemoteDescription(new RTCSessionDescription(answer));

            // Process any buffered ICE candidates
            logEvent(
              `Processing ${iceCandidateBuffer.length} buffered ICE candidates`
            );
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

        // Handle call initiation
        socket.on("start-call", async ({ room }) => {
          logEvent("📞 Received start-call event", { room });
          setConnectionStatus("Call starting...");
        });

        // Handle join confirmation with initiator status
        socket.on(
          "join-confirmation",
          async ({ isInitiator: isInit, room: joinedRoom, peers }) => {
            isInitiator = isInit;
            logEvent(`🔄 Join confirmed for room ${joinedRoom}`, {
              isInitiator,
              peers,
            });

            setConnectionStatus(
              isInit
                ? "You're the initiator, creating offer..."
                : "Waiting for offer from initiator..."
            );

            // If this client is the initiator, create and send an offer after a short delay
            if (isInit) {
              // Wait a moment for both peers to be fully set up
              setTimeout(async () => {
                try {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  socket.emit("offer", { offer, room: joinedRoom });
                  logEvent(
                    "📡 Created and sent initial offer as room initiator"
                  );
                } catch (err) {
                  console.error("❌ Error creating initial offer:", err);
                  setConnectionStatus("Error creating offer");
                }
              }, 1000);
            }
          }
        );

        // Handle peer disconnection
        socket.on("peer-disconnected", ({ peerId }) => {
          logEvent(`👋 Peer disconnected: ${peerId}`);
          setConnectionStatus("Peer disconnected - waiting for new connection");
        });

        // Handle peer connection status
        socket.on("peer-connection-status", ({ status, peerId }) => {
          logEvent(`📊 Peer ${peerId} connection status: ${status}`);
        });

        // NOW JOIN THE ROOM after all handlers are set up
        logEvent("🔗 Joining room...");
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

      // Remove all event listeners
      socket.off("ice-candidate");
      socket.off("offer");
      socket.off("answer");
      socket.off("start-call");
      socket.off("join-confirmation");
      socket.off("peer-disconnected");
      socket.off("peer-connection-status");
    };
  }, [socket, room]);

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <div className="video-container flex-1 relative max-h-full">
        {/* remote video taking up the full space */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover max-h-full"
        />

        {/* local video stays in the corner without stretching */}
        <div className="absolute bottom-16 right-4 w-48 h-32 rounded-lg overflow-hidden shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>

        {/* connection status indicator */}
        <div className="absolute top-4 left-4 bg-black bg-opacity-50 text-white p-2 rounded">
          <div className="flex items-center">
            <div
              className={`w-3 h-3 rounded-full mr-2 ${
                iceConnectionState === "connected" ||
                iceConnectionState === "completed"
                  ? "bg-green-500"
                  : iceConnectionState === "checking"
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
            ></div>
            <span>{connectionStatus}</span>
          </div>
          <div className="text-xs text-gray-300 mt-1">
            ICE: {iceConnectionState || "new"}
          </div>
        </div>
      </div>
    </div>
  );
}
