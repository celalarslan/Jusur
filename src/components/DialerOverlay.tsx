import React, { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import { motion } from "motion/react";

interface DialerOverlayProps {
  receiverName: string;
  receiverEmail: string;
  status: string;
  onCancel: () => void;
  timeoutSeconds?: number;
}

export function DialerOverlay({ 
  receiverName, 
  receiverEmail, 
  status, 
  onCancel, 
  timeoutSeconds = 15 
}: DialerOverlayProps) {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950 text-white p-6 rounded-2xl border border-zinc-800">
      
      {/* Visual ring element */}
      <div className="relative mb-8">
        <motion.div
          animate={{
            scale: [1, 1.35, 1],
            opacity: [0.6, 0.1, 0.6],
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute inset-0 rounded-full bg-cyan-500/20"
        />
        <div className="w-24 h-24 rounded-full bg-zinc-900 border border-cyan-500/40 flex items-center justify-center shadow-lg shadow-cyan-500/10">
          <motion.div
            animate={{
              rotate: [0, 15, -15, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="text-cyan-400 font-sans font-bold text-center text-3xl"
          >
            ☎
          </motion.div>
        </div>
      </div>

      <motion.p 
        className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-1"
        animate={{ opacity: [1, 0.5, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        Ringing...
      </motion.p>
      
      <h2 className="text-2xl font-black tracking-tight text-center mb-1 text-zinc-100">
        {receiverName}
      </h2>
      
      <p className="text-zinc-500 text-xs font-mono mb-6">
        {receiverEmail}
      </p>

      {/* Countdown Progress Indicator */}
      <div className="w-full max-w-xs bg-zinc-900 border border-zinc-800 p-3.5 rounded-xl mb-8">
        <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
          <motion.div 
            className="bg-cyan-400 h-1.5 rounded-full"
            initial={{ width: "100%" }}
            animate={{ width: `${(timeLeft / timeoutSeconds) * 100}%` }}
            transition={{ duration: 1, ease: "linear" }}
          />
        </div>
        <p className="text-center text-[10.5px] text-zinc-400 font-mono mt-2">
          Secretary takes over in {timeLeft}s
        </p>
      </div>

      {/* Decline action */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onCancel}
          id="btn-cancel-outgoing"
          className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-all hover:scale-105 shadow-lg shadow-rose-950/40 active:scale-95 cursor-pointer"
        >
          <PhoneOff className="w-6 h-6 text-white" />
        </button>
        <span className="text-[11px] text-rose-400 font-mono">Cancel Call</span>
      </div>
    </div>
  );
}
