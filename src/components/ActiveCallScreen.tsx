import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Globe, Sparkles, Volume2, Video, VideoOff, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { CallDocument } from "../types";
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
  const isCaller = call.callerEmail === currentUserEmail;
  const isLocalDemoCall = call.meetUri === "jusur://local-demo";
  const partnerName = isCaller ? call.receiverEmail.split("@")[0] : call.callerName;

  // Translation States
  const [isInterpreterOn, setIsInterpreterOn] = useState(false);
  const [myLanguage, setMyLanguage] = useState(initialMyLanguage); // "auto" for Auto-detect
  const [partnerLanguage, setPartnerLanguage] = useState(initialPartnerLanguage);
  const [selectedVoice, setSelectedVoice] = useState(initialVoice);
  const [transcripts, setTranscripts] = useState<{ sender: string; text: string; id: number }[]>([]);

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

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Establish WebRTC audio/video connection via Firestore signaling.
  useEffect(() => {
    let active = true;
    const stunServers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    const pc = new RTCPeerConnection(stunServers);
    peerConnectionRef.current = pc;

    const setupConnection = async () => {
      try {
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
  }, [isLocalDemoCall, initialVideoEnabled]);

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

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#05070a] font-sans text-neutral-100 rounded-2xl border border-cyan-300/10 overflow-hidden shadow-[0_0_60px_rgba(20,184,166,0.16)]">
      <audio ref={remoteAudioRef} className="hidden" autoPlay playsInline />

      <div className="flex justify-between items-center px-5 py-3 border-b border-cyan-300/10 bg-slate-950/85 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-300 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-300"></span>
          </span>
          <div>
            <span className="text-cyan-200/60 text-[9px] font-mono tracking-widest uppercase block mb-0.5">Secure audio/video bridge</span>
            <h1 className="text-sm font-black tracking-tight text-white uppercase font-display">{partnerName}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleMic}
            id="btn-toggle-mic"
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
              micMuted ? "bg-rose-500/15 border-rose-400/30 text-rose-300" : "bg-white/5 border-white/10 text-cyan-100 hover:bg-white/10"
            }`}
            title={micMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={toggleCamera}
            id="btn-toggle-camera"
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
              cameraOff ? "bg-amber-500/15 border-amber-400/30 text-amber-200" : "bg-white/5 border-white/10 text-cyan-100 hover:bg-white/10"
            }`}
            title={cameraOff ? "Turn camera on" : "Turn camera off"}
          >
            {cameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
          </button>
          <button
            onClick={handleHangUp}
            id="btn-active-hang-up"
            className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-lg shadow-rose-950/40"
            title="Disconnect"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0 divide-y divide-white/5">

        <div className="p-4 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] flex flex-col gap-4 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_0.65fr] gap-3">
            <div className="relative aspect-video overflow-hidden rounded-xl border border-cyan-300/10 bg-slate-950 shadow-inner">
              <video ref={remoteVideoRef} className="absolute inset-0 h-full w-full object-cover" autoPlay playsInline />
              {!remoteStreamRef.current && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                  <div className="mb-3 h-12 w-12 rounded-full border border-cyan-300/20 bg-cyan-300/10 flex items-center justify-center">
                    <Video className="w-5 h-5 text-cyan-200" />
                  </div>
                  <p className="text-xs font-bold text-slate-200">Waiting for remote video</p>
                  <p className="mt-1 text-[10px] text-slate-500">Peer media appears here once WebRTC connects.</p>
                </div>
              )}
              <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/45 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-cyan-100">
                {partnerName}
              </div>
            </div>

            <div className="relative aspect-video sm:aspect-auto overflow-hidden rounded-xl border border-white/10 bg-slate-950">
              <video ref={localVideoRef} className="absolute inset-0 h-full w-full object-cover scale-x-[-1]" autoPlay muted playsInline />
              {cameraOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90">
                  <VideoOff className="w-7 h-7 text-amber-200" />
                </div>
              )}
              <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/45 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-slate-100">
                You
              </div>
            </div>
          </div>

          {mediaError && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-100">
              {mediaError}
            </div>
          )}

          <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-cyan-300/10">
            <div className="leading-tight">
              <p className="text-[9px] text-slate-500 font-mono tracking-wider">CHANNEL PROTOCOL / HEALTH</p>
              <div className="flex items-center gap-2 mt-1">
                {connectionStatus === "connecting" && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-500 font-black">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Configuring Bridge...</span>
                  </div>
                )}
                {connectionStatus === "connected" && (
                  <span className="text-xs text-cyan-300 font-black flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
                    Audio/video tunnel active
                  </span>
                )}
                {connectionStatus === "loopback_mode" && (
                  <span className="text-xs text-neutral-300 font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded border border-white/10 font-bold">
                    Loopback Test Simulation
                  </span>
                )}
                {connectionStatus === "failed" && (
                  <span className="text-xs text-rose-400 font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    Signal Unstable
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-[9px] text-slate-500 font-mono tracking-wider block mb-1">INTERPRETER</span>
              <span className="text-xs font-bold text-emerald-300 bg-emerald-400/10 px-2.5 py-0.5 rounded-full border border-emerald-300/15">
                {partnerMuted ? "Speaking translation" : "Ready"}
              </span>
            </div>
          </div>

          {/* Real-time Translator Widget Control */}
          <div className="bg-neutral-900 border border-white/5 p-4 rounded-xl flex flex-col gap-4 shadow-inner">
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-tr from-blue-500/10 to-indigo-500/10 border border-blue-500/20 text-blue-400 shadow-md">
                  <Globe className="w-4 h-4 animate-spin-slow" />
                </div>
                <div>
                  <h3 className="text-xs font-black tracking-tight text-white flex items-center gap-2 font-display">
                    Live Translation Machine
                    <span className="text-[8px] font-mono tracking-widest uppercase bg-gradient-to-r from-cyan-950 to-emerald-950 text-cyan-300 px-2 py-0.5 rounded-full font-black border border-cyan-900/30">Gemini Live</span>
                  </h3>
                  <p className="text-[10px] text-zinc-500">Auto-transcribe, analyze intents, and speak translations gaplessly</p>
                </div>
              </div>

              {/* Luxury neon sliding action */}
              <button
                onClick={() => setIsInterpreterOn(!isInterpreterOn)}
                id="btn-interpreter-toggle"
                className={`relative w-12 h-6.5 rounded-full transition-all duration-300 cursor-pointer p-0.5 ${
                  isInterpreterOn ? "bg-gradient-to-r from-blue-600 to-indigo-600 shadow-[0_0_12px_rgba(37,99,235,0.4)]" : "bg-neutral-800"
                }`}
              >
                <div
                  className={`w-5.5 h-5.5 rounded-full bg-white transition-all duration-300 shadow-md transform flex items-center justify-center ${
                    isInterpreterOn ? "translate-x-5.5" : "translate-x-0"
                  }`}
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isInterpreterOn ? "text-blue-600" : "text-zinc-400"}`} />
                </div>
              </button>
            </div>

            {/* Language Dropdowns beautifully designed */}
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="text-[9px] font-mono text-zinc-500 block mb-1 uppercase tracking-wider font-bold">My Vocal Input</label>
                <div className="relative">
                  <select
                    value={myLanguage}
                    onChange={(e) => {
                      setMyLanguage(e.target.value);
                      if (isInterpreterOn) {
                        stopInterpreter();
                        setTimeout(startInterpreter, 200);
                      }
                    }}
                    id="select-my-language"
                    className="w-full bg-neutral-950 border border-white/5 rounded-xl text-xs py-2.5 px-3 font-semibold outline-none focus:border-blue-500/20 text-zinc-200 cursor-pointer appearance-none shadow-inner"
                  >
                    <option value="auto">Auto-detect (All)</option>
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.name}>{lang.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-[8px] font-mono">▼</div>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-mono text-zinc-500 block mb-1 uppercase tracking-wider font-bold">Receiver Output</label>
                <div className="relative">
                  <select
                    value={partnerLanguage}
                    onChange={(e) => {
                      setPartnerLanguage(e.target.value);
                      if (isInterpreterOn) {
                        stopInterpreter();
                        setTimeout(startInterpreter, 200);
                      }
                    }}
                    id="select-partner-language"
                    className="w-full bg-neutral-950 border border-white/5 rounded-xl text-xs py-2.5 px-3 font-semibold outline-none focus:border-blue-500/20 text-zinc-200 cursor-pointer appearance-none shadow-inner"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.name}>{lang.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-[8px] font-mono">▼</div>
                </div>
              </div>
            </div>

            {/* Voice Accent Selector */}
            <div className="border-t border-white/5 pt-3.5">
              <label className="text-[9px] font-mono text-zinc-550 block mb-2 uppercase tracking-wider font-bold">Vocal Pitch Accent (Ses Seçimi)</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  id="btn-voice-female"
                  onClick={() => {
                    setSelectedVoice("Aoede");
                    if (isInterpreterOn) {
                      stopInterpreter();
                      setTimeout(startInterpreter, 200);
                    }
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    selectedVoice === "Aoede"
                      ? "bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border-blue-500 text-blue-200 shadow-md shadow-blue-500/10"
                      : "bg-neutral-950 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-neutral-900"
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Aoede (Kadın Sesi)</span>
                </button>
                <button
                  type="button"
                  id="btn-voice-male"
                  onClick={() => {
                    setSelectedVoice("Fenrir");
                    if (isInterpreterOn) {
                      stopInterpreter();
                      setTimeout(startInterpreter, 200);
                    }
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    selectedVoice === "Fenrir"
                      ? "bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border-blue-500 text-blue-200 shadow-md shadow-blue-500/10"
                      : "bg-neutral-950 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-neutral-900"
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Fenrir (Erkek Sesi)</span>
                </button>
              </div>
            </div>

          </div>

        </div>

        {/* Scrolling Transcript Feed */}
        <div className="flex-1 flex flex-col bg-neutral-950/20 overflow-hidden min-h-0">
          <div className="px-5 py-3 border-b border-white/5 bg-neutral-950/40 flex justify-between items-center text-[9px] font-mono font-black uppercase tracking-widest text-blue-400 shrink-0">
            <span>🔴 Live scrolling translation feed</span>
            <span className="text-[8px] text-zinc-650 bg-white/5 px-2 py-0.5 rounded">Dynamic UI Sync</span>
          </div>

          <div className="flex-grow overflow-y-auto px-5 py-5 space-y-4 min-h-0 scrollbar-thin">
            {transcripts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center text-zinc-600">
                <div className="relative mb-3 flex items-center justify-center">
                  <motion.div 
                    animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-blue-500/10 blur"
                  />
                  <Sparkles className="w-7 h-7 text-blue-500/30 relative z-10" />
                </div>
                <p className="text-xs font-extrabold text-zinc-400 font-display">Awaiting Voice Input</p>
                <p className="text-[10px] leading-relaxed max-w-[240px] mt-1.5 text-zinc-500">
                  Toggle the Live Translation switch on, speak clearly into your mic, and Jusur will construct live translation arrays instantly.
                </p>
              </div>
            ) : (
              transcripts.map((t) => (
                <div
                  key={t.id}
                  className={`flex flex-col max-w-[85%] ${t.sender === "You" ? "ml-auto items-end" : "mr-auto items-start"}`}
                >
                  <span className="text-[9px] font-mono font-bold text-zinc-500 mb-1 uppercase tracking-widest flex items-center gap-1.5">
                    <span className={`w-1 h-1 rounded-full ${t.sender === "You" ? "bg-blue-400" : "bg-amber-500"}`} />
                    {t.sender === "You" ? "You" : partnerName}
                  </span>
                  
                  <div className={`p-3.5 rounded-2xl text-[12px] leading-relaxed shadow-lg ${
                    t.sender === "You"
                      ? "bg-gradient-to-tr from-blue-950/70 to-indigo-950/50 text-blue-100 border border-blue-500/10 rounded-tr-none text-right"
                      : "bg-neutral-900 text-zinc-100 border border-white/5 rounded-tl-none text-left"
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Quick simulation input for loopback / demo helper */}
          {connectionStatus === "loopback_mode" && (
            <div className="p-3 bg-blue-950/10 border-t border-blue-500/10 text-center text-[10px] text-blue-400/80 font-mono tracking-wider leading-relaxed">
              🎤 Loopback Testing Mode Active. Your local audio loops back to mimic a conversation with {partnerName} for visual verification.
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
