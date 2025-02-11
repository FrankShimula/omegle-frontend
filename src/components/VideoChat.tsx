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
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Initializing...");

  // Toggle handlers remain the same
  const toggleMute = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!isMuted);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
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
          .catch((err) => console.error("Fullscreen error:", err));
      } else {
        document
          .exitFullscreen()
          .then(() => setIsFullscreen(false))
          .catch((err) => console.error("Exit fullscreen error:", err));
      }
    }
  };

  useEffect(() => {
    console.log("Socket state on mount:", {
      connected: socket.connected,
      id: socket.id,
      room,
    });

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
      setConnectionStatus("Socket disconnected");
    });

    socket.on("error", (error) => {
      console.error("Socket error:", error);
      setConnectionStatus(`Error: ${error}`);
    });

    // Debug existing socket events
    socket.on("waiting", () => {
      console.log("Received waiting event");
      setConnectionStatus("Waiting for peer...");
    });

    socket.on("paired", (data) => {
      console.log("Received paired event:", data);
      setConnectionStatus("Paired with peer");
    });

    socket.on("initiate-call", () => {
      console.log("Received initiate-call event");
      setConnectionStatus("Initiating call...");
    });
    let pc: RTCPeerConnection;

    const logPeerState = () => {
      if (!pc) return;

      console.log("WebRTC State:", {
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        localDescription: pc.localDescription?.type,
        remoteDescription: pc.remoteDescription?.type,
        timestamp: new Date().toISOString(),
      });
    };

    const initializeWebRTC = async () => {
      try {
        console.log("Starting WebRTC initialization...");
        setConnectionStatus("Getting user media...");

        if (!socket.connected) {
          console.error("Socket not connected!");
          setConnectionStatus("Error: Socket not connected");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        console.log("Got user media:", {
          audioTracks: stream.getAudioTracks().length,
          videoTracks: stream.getVideoTracks().length,
        });

        localStream.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream.current;
        }

        setConnectionStatus("Creating peer connection...");

        pc = new RTCPeerConnection({
          iceServers: [
            {
              urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
              ],
            },
          ],
        });

        console.log("Emitting join-room event for room:", room);
        socket.emit("join-room", room);

        peerConnection.current = pc;
        logPeerState();

        // Log all state changes
        pc.oniceconnectionstatechange = () => {
          console.log("ICE Connection State Change:", pc.iceConnectionState);
          setConnectionStatus(`ICE: ${pc.iceConnectionState}`);
          logPeerState();
        };

        pc.onconnectionstatechange = () => {
          console.log("Connection State Change:", pc.connectionState);
          setConnectionStatus(`Connection: ${pc.connectionState}`);
          logPeerState();
        };

        pc.onsignalingstatechange = () => {
          console.log("Signaling State Change:", pc.signalingState);
          logPeerState();
        };

        pc.onicegatheringstatechange = () => {
          console.log("ICE Gathering State:", pc.iceGatheringState);
          logPeerState();
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("Generated ICE candidate:", {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            });
            socket.emit("ice-candidate", { candidate: event.candidate, room });
          }
        };

        pc.ontrack = (event) => {
          console.log("Received remote track:", {
            kind: event.track.kind,
            id: event.track.id,
            label: event.track.label,
          });

          event.streams[0].getTracks().forEach((track) => {
            console.log("Adding track to remote stream:", track.kind);
            remoteStream.current.addTrack(track);
          });
        };

        // Add local tracks to peer connection
        stream.getTracks().forEach((track) => {
          console.log("Adding local track to peer connection:", track.kind);
          pc.addTrack(track, stream);
        });

        socket.on("ice-candidate", async ({ candidate }) => {
          try {
            console.log("Received ICE candidate:", candidate);
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              console.log("Successfully added ICE candidate");
            } else {
              console.log("Skipping ICE candidate - no remote description yet");
            }
            logPeerState();
          } catch (err) {
            console.error("Error adding received ICE candidate:", err);
          }
        });

        socket.on("offer", async ({ offer }) => {
          try {
            console.log("Received offer");
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log("Set remote description from offer");

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log("Created and set local description (answer)");

            socket.emit("answer", { answer, room });
            logPeerState();
          } catch (err) {
            console.error("Error handling offer:", err);
          }
        });

        socket.on("answer", async ({ answer }) => {
          try {
            console.log("Received answer");
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log("Set remote description from answer");
            logPeerState();
          } catch (err) {
            console.error("Error handling answer:", err);
          }
        });

        socket.on("start-call", async () => {
          try {
            console.log("Starting call as initiator");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log("Created and set local description (offer)");
            socket.emit("offer", { offer, room });
            logPeerState();
          } catch (err) {
            console.error("Error starting call:", err);
          }
        });
      } catch (error) {
        console.error("WebRTC initialization error:", error);
        setConnectionStatus("Failed to initialize");
      }
    };

    initializeWebRTC();

    return () => {
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
    };
  }, [socket, room]);

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
