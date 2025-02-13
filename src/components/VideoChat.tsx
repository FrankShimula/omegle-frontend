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
  const [remoteStream] = useState<MediaStream>(new MediaStream());
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Initializing...");

  const logEvent = (event: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${event}`, data || "");
  };
  const toggleMute = () => {
    logEvent("Toggling mute");
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!isMuted);
        logEvent("Mute state changed", { isMuted: !isMuted });
      }
    }
  };

  const toggleVideo = () => {
    logEvent("Toggling video");
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!isVideoOff);
        logEvent("Video state changed", { isVideoOff: !isVideoOff });
      }
    }
  };

  const toggleFullscreen = () => {
    logEvent("Toggling fullscreen");
    const videoContainer = document.querySelector(".video-container");
    if (videoContainer) {
      if (!document.fullscreenElement) {
        videoContainer
          .requestFullscreen()
          .then(() => {
            setIsFullscreen(true);
            logEvent("Entered fullscreen");
          })
          .catch((err) => logEvent("Fullscreen error", err));
      } else {
        document
          .exitFullscreen()
          .then(() => {
            setIsFullscreen(false);
            logEvent("Exited fullscreen");
          })
          .catch((err) => logEvent("Exit fullscreen error", err));
      }
    }
  };
  const logError = (event: string, error: any) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR - ${event}:`, {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      fullError: error,
    });
  };
  let pc: RTCPeerConnection | null = null;

  useEffect(() => {
    logEvent("Component mounted", { socketId: socket.id, room });

    const setupMediaStream = async () => {
      logEvent("Starting media stream setup");
      try {
        // First check if getUserMedia is available
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("getUserMedia is not supported in this browser");
        }

        // Try to get permissions first
        logEvent("Requesting media permissions");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        logEvent("Media stream obtained", {
          audioTracks: stream.getAudioTracks().length,
          videoTracks: stream.getVideoTracks().length,
        });

        // Verify we actually got tracks
        if (!stream.getVideoTracks().length) {
          throw new Error("No video track available");
        }
        if (!stream.getAudioTracks().length) {
          throw new Error("No audio track available");
        }

        // Try setting the local stream
        localStream.current = stream;
        if (!localVideoRef.current) {
          throw new Error("Local video reference not available");
        }

        localVideoRef.current.srcObject = stream;
        logEvent("Local video stream set successfully");

        return stream;
      } catch (error: any) {
        logError("Media stream setup failed", error);
        let errorMessage = "Failed to access camera/microphone";

        // Provide more specific error messages
        if (error.name === "NotAllowedError") {
          errorMessage = "Camera/microphone permission denied";
        } else if (error.name === "NotFoundError") {
          errorMessage = "No camera/microphone found";
        } else if (error.name === "NotReadableError") {
          errorMessage = "Camera/microphone is already in use";
        }

        setConnectionStatus(errorMessage);
        throw error;
      }
    };

    const createPeerConnection = () => {
      logEvent("Creating peer connection");
      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            {
              urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
              ],
            },
          ],
        });

        if (!pc) {
          throw new Error("Failed to create RTCPeerConnection");
        }

        logEvent("Peer connection created successfully");

        pc.oniceconnectionstatechange = () => {
          logEvent("ICE connection state changed", {
            state: pc.iceConnectionState,
            timestamp: new Date().toISOString(),
          });
          setConnectionStatus(`Connection: ${pc.iceConnectionState}`);
        };

        pc.onconnectionstatechange = () => {
          logEvent("Connection state changed", {
            state: pc.connectionState,
            timestamp: new Date().toISOString(),
          });
        };

        pc.onsignalingstatechange = () => {
          logEvent("Signaling state changed", {
            state: pc.signalingState,
            timestamp: new Date().toISOString(),
          });
        };

        pc.ontrack = (event) => {
          logEvent("Received remote track", {
            kind: event.track.kind,
            id: event.track.id,
            timestamp: new Date().toISOString(),
          });
          remoteStream.addTrack(event.track);
        };

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          logEvent("Remote video stream initialized");
        }

        peerConnection.current = pc;
        return pc;
      } catch (error) {
        logError("Peer connection creation failed", error);
        setConnectionStatus("Failed to create peer connection");
        throw error;
      }
    };

    const initializeWebRTC = async () => {
      logEvent("Starting WebRTC initialization");
      //const stream = await setupMediaStream();
      const peerConn = createPeerConnection();
      try {
        logEvent("Step 1: Setting up media stream");
        const stream = await setupMediaStream();

        logEvent("Step 2: Creating peer connection");
        const pc = createPeerConnection();

        logEvent("Step 3: Adding tracks to peer connection");
        stream.getTracks().forEach((track) => {
          logEvent("Adding track to peer connection", {
            kind: track.kind,
            id: track.id,
          });
          pc.addTrack(track, stream);
        });

        logEvent("Step 4: Setting up socket event handlers");
        socket.on("ice-candidate", async ({ candidate }) => {
          logEvent("Received ICE candidate");
          try {
            if (peerConn?.remoteDescription && candidate) {
              await peerConn.addIceCandidate(new RTCIceCandidate(candidate));
              logEvent("Added ICE candidate successfully");
            } else {
              logEvent("Skipped ICE candidate - no remote description");
            }
          } catch (err) {
            logEvent("Error adding ICE candidate", err);
          }
        });

        socket.on("offer", async ({ offer }) => {
          logEvent("Received offer");
          try {
            if (!peerConn) return;
            await peerConn.setRemoteDescription(
              new RTCSessionDescription(offer)
            );
            logEvent("Set remote description from offer");

            const answer = await peerConn.createAnswer();
            await peerConn.setLocalDescription(answer);
            logEvent("Created and set local answer");

            socket.emit("answer", { answer, room });
            logEvent("Sent answer");
          } catch (err) {
            logEvent("Error handling offer", err);
          }
        });

        socket.on("answer", async ({ answer }) => {
          logEvent("Received answer");
          try {
            if (!peerConn) return;
            await peerConn.setRemoteDescription(
              new RTCSessionDescription(answer)
            );
            logEvent("Set remote description from answer");
          } catch (err) {
            logEvent("Error handling answer", err);
          }
        });

        socket.on("start-call", async () => {
          logEvent("Received start-call event");
          try {
            if (!peerConn) return;
            const offer = await peerConn.createOffer();
            await peerConn.setLocalDescription(offer);
            logEvent("Created and set local offer");
            socket.emit("offer", { offer, room });
            logEvent("Sent offer");
          } catch (err) {
            logEvent("Error starting call", err);
          }
        });

        logEvent("Step 5: Joining room");
        socket.emit("join-room", room);

        logEvent("WebRTC initialization completed successfully");
      } catch (error) {
        logError("WebRTC initialization failed", error);
        setConnectionStatus("Failed to initialize video chat");
      }
    };

    initializeWebRTC();

    return () => {
      logEvent("Component unmounting - cleaning up");
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => {
          track.stop();
          logEvent("Stopped local track", { kind: track.kind });
        });
      }
      if (pc) {
        pc.close();
        logEvent("Closed peer connection");
      }
    };
  }, [socket, room, remoteStream]);

  return (
    <div className="flex flex-col h-screen bg-gray-900 overflow-hidden">
      <div className="absolute top-4 left-4 z-10 bg-black/50 text-white px-4 py-2 rounded">
        {connectionStatus}
      </div>
      <div className="video-container flex-1 relative">
        <div className="absolute inset-0">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        <div className="absolute bottom-4 right-4 w-48 h-32 rounded-lg overflow-hidden shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>

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
