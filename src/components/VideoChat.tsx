import "../utils/Debug";
import { useEffect, useRef,useState } from "react";
import { Socket } from "socket.io-client";
import VideoControls from "./VideoControls";

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
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const logEvent = (event: string, data?: any) => {
    console.log(`[${new Date().toISOString()}] ${event}`, data || "");
  };

  const fetchTurnServers = async () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
    const response = await fetch(`${backendUrl}/api/turn`);
    if (!response.ok) throw new Error("Failed to fetch TURN servers");
    const data = await response.json();
    return data.iceServers;
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

        if (state === "connected" || state === "completed") {
          socket.emit("connection-status", { status: "connected", room });
        } else if (
          state === "failed" ||
          state === "disconnected" ||
          state === "closed"
        ) {
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
      };

      return pc;
    };

    const initializeWebRTC = async () => {
      try {
        const stream = await setupMediaStream();

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
          } catch (err) {
            console.error("❌ Error handling offer:", err);
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
          } catch (err) {
            console.error("❌ Error handling answer:", err);
          }
        });

        // Handle call initiation
        socket.on("start-call", async ({ room }) => {
          logEvent("📞 Received start-call event", { room });
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
                }
              }, 1000);
            }
          }
        );

        // Handle peer disconnection
        socket.on("peer-disconnected", ({ peerId }) => {
          logEvent(`👋 Peer disconnected: ${peerId}`);
        });

        // Handle peer connection status
        socket.on("peer-connection-status", ({ status, peerId }) => {
          logEvent(`📊 Peer ${peerId} connection status: ${status}`);
        });

        // NOW JOIN THE ROOM after all handlers are set up
        logEvent("🔗 Joining room...");
        socket.emit("join-room", room);
      } catch (error) {
        logEvent("❌ WebRTC initialization failed", error);
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

  // Video control functions
  const toggleMute = () => {
    if (localStream.current) {
      const audioTracks = localStream.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = () => {
    if (localStream.current) {
      const videoTracks = localStream.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff(!isCameraOff);
    }
  };

  const endCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }
    
    socket.emit("leave-room", { room });
    // Redirect or handle UI for call ended
    window.location.href = '/'; // Redirect to home or another route when call ends
  };

  const toggleFullScreen = () => {
    const container = document.querySelector('.video-container');
    
    if (!document.fullscreenElement) {
      container?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullScreen(true);
    } else {
      document.exitFullscreen();
      setIsFullScreen(false);
    }
  };
  

  return (
    <div className="w-full h-screen flex items-start justify-center bg-black">
      <div className="relative w-full max-w-[600px] h-full bg-gray-900 rounded-lg overflow-hidden">
        {/* top half - remote video */}
        <div className="w-full h-1/2 relative">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        </div>
  
        {/* bottom half - local video */}
        <div className="w-full h-1/2 relative">
          <video
            ref={localVideoRef}
            muted
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        </div>
  
        {/* controls - positioned at bottom center */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
          <VideoControls
            isMuted={isMuted}
            isCameraOff={isCameraOff}
            isFullScreen={isFullScreen}
            toggleMute={toggleMute}
            toggleCamera={toggleCamera}
            toggleFullScreen={toggleFullScreen}
            endCall={endCall}
          />
        </div>
      </div>
    </div>
  );
}