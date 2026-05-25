import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Globe, Video, VideoOff, Loader2, Send, MessageCircle } from "lucide-react";
import { CallDocument, CallMessage } from "../types";
import { updateCallDoc, deleteCallDoc } from "../firebase";

interface ActiveCallScreenProps {
  call: CallDocument;
  onHangUp: () => void;
  currentUserEmail: string;
  initialMyLanguage?: string;
  initialPartnerLanguage?: string;
  initialVoice?: string;
  initialVideoEnabled?: boolean;
}

// Supported languages list natively by Gemini
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish (Español)" },
  { code: "fr", name: "French (Français)" },
  { code: "de", name: "German (Deutsch)" },
  { code: "it", name: "Italian (Italiano)" },
  { code: "zh", name: "Mandarin (中文)" },
  { code: "ja", name: "Japanese (日本語)" },
  { code: "pt", name: "Portuguese (Português)" },
  { code: "ko", name: "Korean (한국어)" },
  { code: "ru", name: "Russian (Русский)" },
  { code: "tr", name: "Turkish (Türkçe)" },
  { code: "ar", name: "Arabic (العربية)" },
  { code: "hi", name: "Hindi (हिन्दी)" },
  { code: "nl", name: "Dutch (Nederlands)" },
  { code: "pl", name: "Polish (Polski)" }
];

export function ActiveCallScreen({
  call,
  onHangUp,
  currentUserEmail,
  initialMyLanguage = "auto",
  initialPartnerLanguage = "Spanish (Español)",
  initialVoice = "Aoede",
  initialVideoEnabled = true
}: ActiveCallScreenProps) {
  const isTurkishUi = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("tr");
  const isCaller = call.callerEmail === currentUserEmail;
  const isLocalDemoCall = call.meetUri === "jusur://local-demo";
  const partnerName = isCaller ? call.receiverEmail.split("@")[0] : call.callerName;

  // Translation States
  const [isInterpreterOn, setIsInterpreterOn] = useState(false);
  const [myLanguage, setMyLanguage] = useState(initialMyLanguage); // "auto" for Auto-detect
  const [partnerLanguage, setPartnerLanguage] = useState(initialPartnerLanguage);
  const [selectedVoice, setSelectedVoice] = useState(initialVoice);
  const [transcripts, setTranscripts] = useState<{ sender: string; text: string; id: number }[]>([]);
  const [messageText, setMessageText] = useState("");
  const [activeTray, setActiveTray] = useState<"translate" | "messages">("translate");
  const [pipPosition, setPipPosition] = useState({ x: 18, y: 96 });

  // WebRTC & Audio States
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(!initialVideoEnabled);
  const [partnerMuted, setPartnerMuted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "failed" | "loopback_mode">("connecting");
  const [mediaError, setMediaError] = useState<string | null>(null);

  // References
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Web Audio refs for Live translation
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const localSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const remoteSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureGainRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Establish WebRTC audio/video connection via Firestore signaling.
  useEffect(() => {
    let active = true;

    const setupConnection = async () => {
      try {
        const iceConfig = await fetch("/api/rtc/ice-servers")
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null);
        const pc = new RTCPeerConnection({
          iceServers: iceConfig?.iceServers?.length
            ? iceConfig.iceServers
            : [{ urls: "stun:stun.l.google.com:19302" }]
        });
        peerConnectionRef.current = pc;

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          }
        });
        if (!active) return;
        localStreamRef.current = stream;
        stream.getVideoTracks().forEach((track) => {
          track.enabled = initialVideoEnabled;
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        if (isLocalDemoCall) {
          const demoRemoteStream = stream.clone();
          remoteStreamRef.current = demoRemoteStream;
          setConnectionStatus("loopback_mode");

          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = demoRemoteStream;
            remoteVideoRef.current.play().catch(console.error);
          }
          return;
        }

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          if (event.streams && event.streams[0]) {
            remoteStreamRef.current = event.streams[0];
            setConnectionStatus("connected");

            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = event.streams[0];
              remoteVideoRef.current.play().catch(console.error);
            }
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = event.streams[0];
              remoteAudioRef.current.play().catch(console.error);
            }
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setConnectionStatus("connected");
          } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            setConnectionStatus("failed");
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            setConnectionStatus("connected");
          } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "closed") {
            setConnectionStatus("failed");
          }
        };

        if (isCaller) {
          // CALLER FLOW:
          pc.onicecandidate = async (e) => {
            if (e.candidate === null) {
              const offerDescription = pc.localDescription;
              if (offerDescription) {
                console.log("Caller writing SDP offer...");
                await updateCallDoc(call.id, { callerSignal: JSON.stringify(offerDescription) });
              }
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          setTimeout(() => {
            if (active && pc.signalingState !== "stable" && pc.iceConnectionState !== "connected") {
              setConnectionStatus("failed");
            }
          }, 12000);

        } else {
          console.log("Receiver reading SDP offer...");
          pc.onicecandidate = async (e) => {
            if (e.candidate === null) {
              const answerDescription = pc.localDescription;
              if (answerDescription) {
                console.log("Receiver writing SDP answer...");
                await updateCallDoc(call.id, { receiverSignal: JSON.stringify(answerDescription) });
              }
            }
          };
        }

      } catch (err) {
        console.error("WebRTC mic capture or PC setup failed:", err);
        setMediaError("Camera or microphone access failed. Check browser permissions and reload the call.");
        setConnectionStatus("failed");
      }
    };

    setupConnection();

    return () => {
      active = false;
      cleanupWebRTC();
    };
  }, [isCaller, isLocalDemoCall, initialVideoEnabled]);

  // Helper to handle signals updated from App's Firestore listener
  useEffect(() => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    const applySignaling = async () => {
      try {
        // If Caller: Wait for receiverSignal
        if (isCaller && call.receiverSignal && pc.signalingState !== "stable") {
          console.log("Caller applying receiver SDP answer...");
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(call.receiverSignal)));
          setConnectionStatus("connected");
        }
        // Receiver offer handling is performed in the dedicated effect below.
      } catch (e) {
        console.warn("Error applying remote signaling description:", e);
      }
    };

    applySignaling();
  }, [call.callerSignal, call.receiverSignal]);

  // Hook for receiver to apply initial Offer and write Answer
  useEffect(() => {
    const pc = peerConnectionRef.current;
    if (!isCaller && call.callerSignal && pc && pc.signalingState === "stable") {
      const applyOfferAndAnswer = async () => {
        try {
          console.log("Receiver applying caller SDP offer...");
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(call.callerSignal)));
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          // Vanilla ICE candidate callback will write receiverSignal to firestore
        } catch (err) {
          console.error("Failed to accept offer/create answer:", err);
          setConnectionStatus("loopback_mode");
        }
      };
      applyOfferAndAnswer();
    }
  }, [call.callerSignal]);

  // Toggle Live interpreter
  useEffect(() => {
    if (isInterpreterOn) {
      startInterpreter();
    } else {
      stopInterpreter();
    }
    return () => {
      stopInterpreter();
    };
  }, [isInterpreterOn]);

  const cleanupWebRTC = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    stopInterpreter();
  };

  const toggleMic = () => {
    const nextMuted = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
  };

  const toggleCamera = () => {
    const nextOff = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !nextOff;
    });
    setCameraOff(nextOff);
  };

  // Convert Float32 browser buffer to 16kHz Int16 linear PCM
  const convertFloat32ToInt16PCM = (float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Connect WebSockets and Audio Nodes to Gemini Live API
  const startInterpreter = async () => {
    try {
      console.log("Starting Real-time Gemini Interpreter...");
      
      // 1. Mute the WebRTC original stream so the user doesn't hear foreign words
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = true;
      }
      setPartnerMuted(true);

      // 2. Establish WebSocket to backend
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/translate-live?myLang=${encodeURIComponent(myLanguage)}&partnerLang=${encodeURIComponent(partnerLanguage)}&voice=${encodeURIComponent(selectedVoice)}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // 3. Setup browser AudioContext for mixed recording and playback
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      nextStartTimeRef.current = audioCtx.currentTime;

      // Local mic source
      if (localStreamRef.current) {
        localSourceRef.current = audioCtx.createMediaStreamSource(localStreamRef.current);
      }

      // Remote peer WebRTC voice source (mixed into translator)
      if (remoteStreamRef.current && connectionStatus === "connected") {
        remoteSourceRef.current = audioCtx.createMediaStreamSource(remoteStreamRef.current);
      }

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      const captureGain = audioCtx.createGain();
      captureGain.gain.value = 0;
      captureGainRef.current = captureGain;

      if (localSourceRef.current) {
        localSourceRef.current.connect(processor);
      }
      if (remoteSourceRef.current) {
        remoteSourceRef.current.connect(processor);
      }

      processor.connect(captureGain);
      captureGain.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Downsample / encode to linear PCM 16-bit Int16
          const pcmBuffer = convertFloat32ToInt16PCM(inputData);
          const base64 = arrayBufferToBase64(pcmBuffer);
          
          wsRef.current.send(JSON.stringify({ audio: base64 }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Play Gemini output sound chunk gaplessly
          if (msg.audio) {
            playDecodedAudioChunk(msg.audio, msg.audioMimeType);
          }

          // Handle live transcription returned by Gemini
          if (msg.transcript) {
            let senderName = partnerName;
            let textClean = msg.transcript;

            if (textClean.startsWith("[You]")) {
              senderName = "You";
              textClean = textClean.replace("[You]", "").trim();
            } else if (textClean.startsWith("[Partner]")) {
              senderName = partnerName;
              textClean = textClean.replace("[Partner]", "").trim();
            }

            setTranscripts((prev) => {
              // De-duplicate fast-firing live transcripts to avoid flickering
              if (prev.length > 0 && prev[prev.length - 1].sender === senderName) {
                const updated = [...prev];
                updated[updated.length - 1].text = textClean;
                return updated;
              } else {
                return [...prev, { sender: senderName, text: textClean, id: Date.now() }];
              }
            });
          }

          if (msg.inputTranscript) {
            setTranscripts((prev) => {
              const cleaned = msg.inputTranscript.replace("[You]", "").replace("[Partner]", "").trim();
              if (prev.length > 0 && prev[prev.length - 1].sender === "You") {
                const updated = [...prev];
                updated[updated.length - 1].text = cleaned;
                return updated;
              } else {
                return [...prev, { sender: "You", text: cleaned, id: Date.now() }];
              }
            });
          }

          if (msg.interrupted) {
            // Stop current playback
            nextStartTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
          }

        } catch (e) {
          console.error("Error reading WS translator feed chunk:", e);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket Gemini translator translator session finished");
      };

    } catch (err) {
      console.error("Error initializing Interpreter setup:", err);
    }
  };

  const stopInterpreter = () => {
    // 1. Unmute original speech so standard line is audible again
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
    }
    setPartnerMuted(false);

    // 2. Shut down media nodes
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (captureGainRef.current) {
      captureGainRef.current.disconnect();
      captureGainRef.current = null;
    }
    if (localSourceRef.current) {
      localSourceRef.current.disconnect();
      localSourceRef.current = null;
    }
    if (remoteSourceRef.current) {
      remoteSourceRef.current.disconnect();
      remoteSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // 3. Clear Websocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const playDecodedAudioChunk = (base64Data: string, mimeType?: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    try {
      // Decode base64 to binary ArrayBuffer
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Parse 16-bit Int16 PCM array to Float32 sample values
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const rateMatch = mimeType?.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
      const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.05;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

    } catch (e) {
      console.error("PCM Chunk queue scheduling failed:", e);
    }
  };

  // Hang Up call entirely
  const handleHangUp = async () => {
    cleanupWebRTC();
    if (isLocalDemoCall) {
      onHangUp();
      return;
    }

    try {
      await updateCallDoc(call.id, { status: "ended" });
      await deleteCallDoc(call.id);
    } catch (e) {
      console.error("Error cleaning up call values in Firestore:", e);
    }
    onHangUp();
  };

  const sendCallMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = messageText.trim();
    if (!text) return;

    const nextMessage: CallMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      senderEmail: currentUserEmail,
      senderName: isCaller ? (call.callerName || "You") : currentUserEmail.split("@")[0],
      text,
      timestamp: Date.now()
    };

    setMessageText("");
    try {
      await updateCallDoc(call.id, {
        messages: [...(call.messages || []), nextMessage]
      });
      setActiveTray("messages");
    } catch (error) {
      console.error("Failed sending call message:", error);
      setMessageText(text);
    }
  };

  const handlePipPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      active: true,
      offsetX: event.clientX - pipPosition.x,
      offsetY: event.clientY - pipPosition.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePipPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const width = typeof window !== "undefined" ? window.innerWidth : 430;
    const height = typeof window !== "undefined" ? window.innerHeight : 800;
    const nextX = Math.min(Math.max(8, event.clientX - dragRef.current.offsetX), Math.max(8, width - 150));
    const nextY = Math.min(Math.max(64, event.clientY - dragRef.current.offsetY), Math.max(64, height - 230));
    setPipPosition({ x: nextX, y: nextY });
  };

  const handlePipPointerUp = () => {
    dragRef.current.active = false;
  };

  const callMessages = call.messages || [];

  return (
    <div className="fixed inset-0 z-[80] bg-black text-neutral-100 font-sans overflow-hidden">
      <audio ref={remoteAudioRef} className="hidden" autoPlay playsInline />

      <video ref={remoteVideoRef} className="absolute inset-0 h-full w-full object-cover bg-slate-950" autoPlay playsInline />
      {!remoteStreamRef.current && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),transparent_42%),linear-gradient(180deg,#020617,#020617)]">
          <div className="h-20 w-20 rounded-full border border-cyan-300/20 bg-cyan-300/10 flex items-center justify-center mb-4">
            <Video className="w-9 h-9 text-cyan-200" />
          </div>
          <p className="text-lg font-black">{partnerName}</p>
          <p className="mt-2 text-xs text-slate-500 max-w-xs">Waiting for secure video tunnel. Audio connects as soon as signaling completes.</p>
        </div>
      )}

      <div
        className="absolute z-20 w-34 h-48 rounded-[26px] border border-white/15 bg-slate-950 overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.5)] touch-none cursor-grab active:cursor-grabbing"
        style={{ left: pipPosition.x, top: pipPosition.y }}
        onPointerDown={handlePipPointerDown}
        onPointerMove={handlePipPointerMove}
        onPointerUp={handlePipPointerUp}
        onPointerCancel={handlePipPointerUp}
      >
        <video ref={localVideoRef} className="absolute inset-0 h-full w-full object-cover scale-x-[-1]" autoPlay muted playsInline />
        {cameraOff && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/95">
            <VideoOff className="w-7 h-7 text-amber-200" />
          </div>
        )}
        <div className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[9px] font-black uppercase text-white">
          You
        </div>
      </div>

      <div className="absolute inset-x-0 top-0 z-10 px-4 pt-4 pb-8 bg-gradient-to-b from-black/85 to-transparent pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70 font-black">Jusur call</p>
            <h1 className="text-2xl font-black truncate">{partnerName}</h1>
            <div className="mt-1 flex items-center gap-2 text-[11px] font-bold">
              {connectionStatus === "connecting" && <span className="text-amber-300">Connecting</span>}
              {connectionStatus === "connected" && <span className="text-cyan-200">Audio/video active</span>}
              {connectionStatus === "loopback_mode" && <span className="text-slate-300">Loopback test</span>}
              {connectionStatus === "failed" && <span className="text-rose-300">Signal unstable</span>}
              <span className="text-slate-500">Interpreter {isInterpreterOn ? "on" : "ready"}</span>
            </div>
          </div>
        </div>
      </div>

      {mediaError && (
        <div className="absolute left-4 right-4 top-24 z-30 rounded-2xl border border-rose-400/20 bg-rose-500/15 px-3 py-2 text-[11px] font-semibold text-rose-100">
          {mediaError}
        </div>
      )}

      <div className="absolute inset-x-3 bottom-24 z-20 rounded-[28px] border border-white/10 bg-slate-950/88 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.55)] overflow-hidden">
        <div className="grid grid-cols-2 p-1 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTray("translate")}
            className={`h-10 rounded-2xl text-xs font-black flex items-center justify-center gap-2 ${activeTray === "translate" ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}
          >
            <Globe className="w-4 h-4" />
            Translate
          </button>
          <button
            type="button"
            onClick={() => setActiveTray("messages")}
            className={`h-10 rounded-2xl text-xs font-black flex items-center justify-center gap-2 ${activeTray === "messages" ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}
          >
            <MessageCircle className="w-4 h-4" />
            Messages
          </button>
        </div>

        {activeTray === "translate" ? (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black">Live Interpreter</p>
                <p className="text-[10px] text-slate-500 truncate">{myLanguage} to {partnerLanguage}</p>
              </div>
              <button
                onClick={() => setIsInterpreterOn(!isInterpreterOn)}
                id="btn-interpreter-toggle"
                className={`h-10 px-4 rounded-2xl text-xs font-black ${isInterpreterOn ? "bg-emerald-300 text-slate-950" : "bg-white/10 text-cyan-100 border border-white/10"}`}
              >
                {isInterpreterOn ? (isTurkishUi ? "Açık" : "On") : (isTurkishUi ? "Tercüme et" : "Translate")}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={myLanguage} onChange={(e) => setMyLanguage(e.target.value)} className="h-10 rounded-2xl bg-black/60 border border-white/10 px-3 text-[11px] font-bold outline-none">
                <option value="auto">Auto-detect</option>
                {LANGUAGES.map((lang) => <option key={lang.code} value={lang.name}>{lang.name}</option>)}
              </select>
              <select value={partnerLanguage} onChange={(e) => setPartnerLanguage(e.target.value)} className="h-10 rounded-2xl bg-black/60 border border-white/10 px-3 text-[11px] font-bold outline-none">
                {LANGUAGES.map((lang) => <option key={lang.code} value={lang.name}>{lang.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSelectedVoice("Aoede")} className={`h-10 rounded-2xl border text-[11px] font-black ${selectedVoice === "Aoede" ? "bg-cyan-300 text-slate-950 border-cyan-300" : "border-white/10 text-slate-300"}`}>Female voice</button>
              <button type="button" onClick={() => setSelectedVoice("Fenrir")} className={`h-10 rounded-2xl border text-[11px] font-black ${selectedVoice === "Fenrir" ? "bg-violet-300 text-slate-950 border-violet-300" : "border-white/10 text-slate-300"}`}>Male voice</button>
            </div>
            <div className="max-h-28 overflow-y-auto space-y-2">
              {transcripts.length === 0 ? (
                <p className="py-5 text-center text-[11px] text-slate-500 font-semibold">Translation transcript appears here.</p>
              ) : transcripts.slice(-6).map((item) => (
                <div key={item.id} className={`text-[11px] leading-relaxed rounded-2xl px-3 py-2 ${item.sender === "You" ? "ml-10 bg-cyan-300/10 text-cyan-50" : "mr-10 bg-white/10 text-slate-100"}`}>
                  <span className="block text-[9px] uppercase text-slate-500 font-black mb-0.5">{item.sender === "You" ? "You" : partnerName}</span>
                  {item.text}
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <div className="max-h-36 overflow-y-auto space-y-2">
              {callMessages.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-slate-500 font-semibold">No messages in this call yet.</p>
              ) : callMessages.map((message) => {
                const mine = message.senderEmail === currentUserEmail;
                return (
                  <div key={message.id} className={`text-[12px] leading-relaxed rounded-2xl px-3 py-2 max-w-[85%] ${mine ? "ml-auto bg-cyan-300 text-slate-950" : "mr-auto bg-white/10 text-slate-100"}`}>
                    {message.text}
                  </div>
                );
              })}
            </div>
            <form onSubmit={sendCallMessage} className="flex items-center gap-2">
              <input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Write a message..."
                dir="auto"
                inputMode="text"
                autoCapitalize="sentences"
                autoComplete="off"
                enterKeyHint="send"
                className="min-w-0 flex-1 h-11 rounded-2xl bg-black/60 border border-white/10 px-4 text-sm font-semibold outline-none focus:border-cyan-300/40"
              />
              <button type="submit" className="h-11 w-11 rounded-2xl bg-cyan-300 text-slate-950 flex items-center justify-center">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-30 px-5 pb-6 pt-12 bg-gradient-to-t from-black/90 to-transparent">
        <div className="flex items-center justify-center gap-5">
          <button onClick={toggleMic} id="btn-toggle-mic" className={`h-14 w-14 rounded-full flex items-center justify-center border ${micMuted ? "bg-rose-500/20 border-rose-300/30 text-rose-200" : "bg-white/12 border-white/15 text-white"}`}>
            {micMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>
          <button onClick={handleHangUp} id="btn-active-hang-up" className="h-16 w-16 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-[0_0_34px_rgba(225,29,72,0.38)]">
            <PhoneOff className="w-7 h-7" />
          </button>
          <button onClick={toggleCamera} id="btn-toggle-camera" className={`h-14 w-14 rounded-full flex items-center justify-center border ${cameraOff ? "bg-amber-500/20 border-amber-300/30 text-amber-200" : "bg-white/12 border-white/15 text-white"}`}>
            {cameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}
