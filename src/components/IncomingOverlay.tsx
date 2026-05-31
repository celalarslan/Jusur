import React, { useEffect } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { CallDocument } from "../types";
import { motion } from "motion/react";

interface IncomingOverlayProps {
  incomingCall: CallDocument;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingOverlay({ incomingCall, onAccept, onDecline }: IncomingOverlayProps) {
  const isVideoCall = (incomingCall.mode || "video") === "video";
  const AcceptIcon = isVideoCall ? Video : Phone;

  useEffect(() => {
    let audioContext: AudioContext | null = null;
    let oscillator: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let vibrateTimer: number | null = null;

    const startRing = () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new AudioContextClass();
        oscillator = audioContext.createOscillator();
        gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gain.gain.value = 0.03;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
      } catch {
        audioContext = null;
      }
    };

    startRing();
    if ("vibrate" in navigator) {
      navigator.vibrate([700, 350, 700]);
      vibrateTimer = window.setInterval(() => navigator.vibrate([700, 350, 700]), 2600);
    }

    return () => {
      if (vibrateTimer) window.clearInterval(vibrateTimer);
      if ("vibrate" in navigator) navigator.vibrate(0);
      oscillator?.stop();
      oscillator?.disconnect();
      gain?.disconnect();
      audioContext?.close().catch(() => {});
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/92 backdrop-blur-md text-white px-6 py-10">
      
      {/* Outer Ring Animation */}
      <div className="flex-1 flex flex-col items-center justify-center w-full">
      <div className="relative mb-8">
        <motion.div
          animate={{
            scale: [1, 1.4, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute inset-0 rounded-full bg-emerald-500/20"
        />
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.8, 0.2, 0.8],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.5,
          }}
          className="absolute inset-0 rounded-full bg-emerald-500/30"
        />
        
        {/* Profile Avatar Icon Placeholder */}
        <div className="relative w-32 h-32 rounded-full bg-slate-800 border-2 border-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/10">
          <AcceptIcon className="w-16 h-16 text-emerald-400 animate-pulse" />
        </div>
      </div>

      <motion.p 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-emerald-400 text-sm font-mono tracking-widest uppercase mb-2"
      >
        {isVideoCall ? "Incoming video call" : "Incoming voice call"}
      </motion.p>
      
      <h2 className="text-3xl font-bold font-sans tracking-tight text-center mb-1">
        {incomingCall.callerName}
      </h2>
      
      <p className="text-slate-400 text-sm font-mono">
        {incomingCall.callerEmail}
      </p>
      </div>

      {/* Buttons and actions */}
      <div className="w-full max-w-xs grid grid-cols-2 gap-5 pb-[env(safe-area-inset-bottom)]">
        {/* Decline Button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            id="btn-decline-call"
            className="w-20 h-20 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-all hover:scale-105 shadow-lg shadow-rose-900/40 active:scale-95 cursor-pointer"
          >
            <PhoneOff className="w-8 h-8 text-white" />
          </button>
          <span className="text-xs text-rose-300 font-black">Decline</span>
        </div>

        {/* Accept Button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAccept}
            id="btn-accept-call"
            className="w-20 h-20 rounded-full bg-emerald-400 hover:bg-emerald-300 flex items-center justify-center transition-all hover:scale-105 shadow-[0_0_42px_rgba(52,211,153,0.45)] active:scale-95 cursor-pointer animate-pulse"
          >
            <AcceptIcon className="w-8 h-8 text-slate-950" />
          </button>
          <span className="text-xs text-emerald-200 font-black">Answer</span>
        </div>
      </div>
    </div>
  );
}
