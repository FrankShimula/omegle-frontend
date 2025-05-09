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
  
  // Control states
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
    <div className="w-full h-full flex flex-col items-center justify-center">
      <div className="video-container w-full md:w-[800px] h-[100vh] md:h-[600px] relative">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover rounded-lg"
        />
        <video
          ref={localVideoRef}
          muted
          autoPlay
          playsInline
          className="w-[100px] h-[100px] object-cover rounded-lg absolute bottom-20 right-4 border border-white"
        />
        
        {/* Video Controls */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center space-x-4 p-2 bg-black bg-opacity-50 rounded-lg">
          <button 
            onClick={toggleMute}
            className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white"
          >
            {isMuted ? 
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg> :
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            }
          </button>
          
          <button 
            onClick={toggleCamera}
            className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white"
          >
            {isCameraOff ? 
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg> :
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            }
          </button>
          
          <button 
            onClick={toggleFullScreen}
            className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white"
          >
            {isFullScreen ?
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg> :
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
              </svg>
            }
          </button>
          
          <button 
            onClick={endCall}
            className="p-2 rounded-full bg-red-600 hover:bg-red-700 text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}