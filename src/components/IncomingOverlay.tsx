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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md text-white p-6">
      
      {/* Outer Ring Animation */}
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
          <Phone className="w-16 h-16 text-emerald-400 animate-pulse" />
        </div>
      </div>

      <motion.p 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-emerald-400 text-sm font-mono tracking-widest uppercase mb-2"
      >
        Incoming smart call
      </motion.p>
      
      <h2 className="text-3xl font-bold font-sans tracking-tight text-center mb-1">
        {incomingCall.callerName}
      </h2>
      
      <p className="text-slate-400 text-sm font-mono mb-12">
        {incomingCall.callerEmail}
      </p>

      {/* Buttons and actions */}
      <div className="flex items-center gap-12 sm:gap-16">
        {/* Decline Button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            id="btn-decline-call"
            className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-all hover:scale-110 shadow-lg shadow-rose-900/40 active:scale-95 cursor-pointer"
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
          <span className="text-xs text-rose-400 font-mono">Decline</span>
        </div>

        {/* Accept Button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAccept}
            id="btn-accept-call"
            className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center transition-all hover:scale-110 shadow-lg shadow-emerald-500/40 active:scale-95 cursor-pointer animate-bounce"
          >
            <Video className="w-7 h-7 text-white" />
          </button>
          <span className="text-xs text-emerald-400 font-mono">Accept</span>
        </div>
      </div>
    </div>
  );
}
