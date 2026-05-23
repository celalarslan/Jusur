import React from "react";

export function Logo({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 500 250"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Deep, glowing glass blue gradient */}
        <linearGradient id="blue-glass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="40%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>

        {/* Shiny metallic gold gradient */}
        <linearGradient id="metal-gold" x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="30%" stopColor="#fbbf24" />
          <stop offset="70%" stopColor="#ca8a04" />
          <stop offset="100%" stopColor="#854d0e" />
        </linearGradient>

        {/* Shiny silver / platinum gradient */}
        <linearGradient id="metal-chrome" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4b5563" />
          <stop offset="50%" stopColor="#f3f4f6" />
          <stop offset="100%" stopColor="#9ca3af" />
        </linearGradient>

        {/* Drop shadow / glow filter */}
        <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Silver Chrome Support Base Arc */}
      <path
        d="M 140 210 Q 280 220 480 145"
        stroke="url(#metal-chrome)"
        strokeWidth="11"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 140 213 Q 280 223 480 148"
        stroke="#ffffff"
        opacity="0.6"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Golden Suspension Bridge Main Arch */}
      <path
        d="M 175 160 Q 300 40 440 120"
        stroke="url(#metal-gold)"
        strokeWidth="16"
        strokeLinecap="round"
        fill="none"
        filter="url(#neon-glow)"
      />

      {/* Gold Arch highlight detail */}
      <path
        d="M 177 158 Q 300 43 438 122"
        stroke="#ffffff"
        strokeWidth="3"
        opacity="0.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Suspension Cables / Vertical Bars */}
      <line x1="225" y1="135" x2="225" y2="175" stroke="url(#metal-gold)" strokeWidth="4.5" />
      <line x1="265" y1="105" x2="265" y2="183" stroke="url(#metal-gold)" strokeWidth="4.5" />
      <line x1="310" y1="90"  x2="310" y2="187" stroke="url(#metal-gold)" strokeWidth="4.5" />
      <line x1="355" y1="90"  x2="355" y2="180" stroke="url(#metal-gold)" strokeWidth="4.5" />
      <line x1="400" y1="108" x2="400" y2="165" stroke="url(#metal-gold)" strokeWidth="4.5" />

      {/* Sweeping Blue Custom "J" and bridge-frame anchor */}
      <path
        d="M 180 50 Q 110 300 10 215 Q 15 160 50 170 C 50 170 85 190 105 200 C 120 205 160 120 180 50 Z"
        fill="url(#blue-glass)"
        filter="url(#neon-glow)"
      />

      {/* Glowing glass overlay accent to simulate 3D glossy highlight */}
      <path
        d="M 175 52 Q 112 295 12 212"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.65"
        fill="none"
      />

      {/* Small floating gold dot detail on the J anchor */}
      <circle cx="178" cy="48" r="9" fill="url(#metal-gold)" filter="url(#neon-glow)" />
      <circle cx="178" cy="48" r="3.5" fill="#ffffff" />
    </svg>
  );
}
