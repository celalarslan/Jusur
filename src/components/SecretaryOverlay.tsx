import React, { useState, useEffect, useRef } from "react";
import { Mic, Square, Send, PhoneOff, User, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import { ChatMessage, CallDocument } from "../types";
import { createVoicemailDoc, updateCallDoc, deleteCallDoc } from "../firebase";

interface SecretaryOverlayProps {
  call: CallDocument;
  onFinish: () => void;
}

export function SecretaryOverlay({ call, onFinish }: SecretaryOverlayProps) {
  const assistantLocale = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("tr") ? "tr-TR" : "en-US";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [typedMessage, setTypedMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [intentSummary, setIntentSummary] = useState("No details recorded yet.");
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const audioPlayingRef = useRef<HTMLAudioElement | null>(null);

  // Auto scroll chat list
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Trigger initial greeting voice with text
  useEffect(() => {
    const receiverName = call.receiverEmail.split("@")[0];
    const greeting = assistantLocale.startsWith("tr")
      ? `Merhaba, ben ${receiverName} için çalışan Jusur yapay zeka sekreteriyim. Şu anda müsait değil. Mesajınızı alabilirim; adınızı ve arama nedeninizi söyler misiniz?`
      : `Hello, I am ${receiverName}'s Jusur AI secretary. They are currently unavailable. I can take a message; what is your name and why are you calling?`;
    
    setMessages([{
      role: "assistant",
      content: greeting,
      timestamp: Date.now()
    }]);

    speakResponse(greeting, null);

    // Update firestore status to note AI Secretary is active
    updateCallDoc(call.id, { status: "ai_secretary_active" });

    return () => {
      // Cleanup any ongoing synthesis
      window.speechSynthesis?.cancel();
      if (audioPlayingRef.current) {
        audioPlayingRef.current.pause();
      }
    };
  }, [assistantLocale, call.id, call.receiverEmail]);

  // Browser Text-To-Speech / Audio player helper
  const speakResponse = (text: string, extAudioBase64: string | null) => {
    // Stop any physical playing audio
    if (audioPlayingRef.current) {
      audioPlayingRef.current.pause();
    }
    window.speechSynthesis?.cancel();
    fallbackTTS(text);
  };

  const fallbackTTS = (text: string) => {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = assistantLocale;
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const exactLocale = assistantLocale.toLowerCase();
        const baseLocale = exactLocale.split("-")[0];
        utterance.voice =
          voices.find((voice) => voice.lang.toLowerCase() === exactLocale && /google|premium|enhanced|natural/i.test(voice.name)) ||
          voices.find((voice) => voice.lang.toLowerCase() === exactLocale) ||
          voices.find((voice) => voice.lang.toLowerCase().startsWith(baseLocale)) ||
          voices[0];
      }
      utterance.rate = assistantLocale.startsWith("tr") ? 1.08 : 1.04;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn("SpeechSynthesis API not supported on this browser.");
    }
  };

  // Convert client blob to Base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Microphone management
  const startRecording = async () => {
    audioChunksRef.current = [];
    setErrorStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await handleAudioSubmit(audioBlob);
        
        // Stop all track streams
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("Microphone access denied:", err);
      setErrorStatus("Could not access microphone. Try typing standard messages below.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Process text message submit
  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim() || isProcessing) return;

    const userText = typedMessage.trim();
    setTypedMessage("");

    // Append user text to feed
    setMessages(prev => [...prev, { role: "user", content: userText, timestamp: Date.now() }]);
    await processAgentTurn(null, userText);
  };

  // Process audio message submit
  const handleAudioSubmit = async (blob: Blob) => {
    if (isProcessing) return;

    // Append audio placeholder content
    setMessages(prev => [...prev, { role: "user", content: "[Audio Message Recorded]", timestamp: Date.now() }]);
    
    try {
      const base64Audio = await blobToBase64(blob);
      await processAgentTurn(base64Audio, null);
    } catch (err) {
      console.error("Audio processing failure:", err);
      setErrorStatus("Audio upload or encoding failed. Let's try typing.");
    }
  };

  // Core API communicator
  const processAgentTurn = async (base64Audio: string | null, textContent: string | null) => {
    setIsProcessing(true);
    setErrorStatus(null);

    // Clean preceding history
    const apiHistory = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    try {
      const res = await fetch("/api/secretary/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerAudio: base64Audio,
          callerText: textContent,
          receiverName: call.receiverEmail.split("@")[0],
          history: apiHistory,
          responseLanguage: assistantLocale.startsWith("tr") ? "Turkish" : "English"
        })
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(errorText || "API response failed");
      }

      const data = await res.json();
      
      // Update dialogue states
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.speakText,
        timestamp: Date.now()
      }]);

      if (data.currentIntentSummary) {
        setIntentSummary(data.currentIntentSummary);
      }

      speakResponse(data.speakText, data.audioBase64);

    } catch (err: any) {
      console.error("Secretary API turn failure:", err);
      setErrorStatus("Agent encountered a processing bug. You can type more or submit the voicemail.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Submit and Save Voicemail 
  const handleSubmitVoicemail = async () => {
    // Generate concatenated full dialog digest
    const transcript = messages
      .map(m => `${m.role === "user" ? "Caller" : "Secretary"}: ${m.content}`)
      .join("\n");

    try {
      await createVoicemailDoc({
        callerId: call.callerId,
        callerName: call.callerName,
        callerEmail: call.callerEmail,
        receiverEmail: call.receiverEmail,
        audioTranscript: transcript,
        aiSummary: intentSummary
      });

      // Clear the call signalling document
      await deleteCallDoc(call.id);
      onFinish();
    } catch (firebaseErr) {
      console.error("Failed to commit final voicemail to firestore:", firebaseErr);
      // Still finish as backup
      onFinish();
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-950 font-sans text-zinc-100 rounded-2xl border border-zinc-800 overflow-hidden">
      
      {/* Header bar */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-800 bg-zinc-900/90 shadow-md shadow-black/10 shrink-0">
        <div>
          <span className="text-violet-400 text-[10px] font-mono tracking-wider uppercase font-extrabold">AI Receptionist Active</span>
          <h1 className="text-sm font-black tracking-tight text-zinc-100">AI Secretary Call Cockpit</h1>
        </div>
        <button
          onClick={handleSubmitVoicemail}
          id="btn-hang-up-voicemail"
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer shadow-lg shadow-rose-950/40"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span>Hang Up & Save</span>
        </button>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        
        {/* Left column: AI Receptionist visualization orb and prompt actions */}
        <div className="w-full lg:w-[44%] flex flex-col items-center justify-between p-4 border-b lg:border-b-0 lg:border-r border-zinc-800 bg-zinc-950/90 shrink-0 lg:shrink">
          
          {/* Animated visualizer */}
          <div className="flex flex-col items-center gap-3 my-auto">
            <div className="relative flex justify-center items-center w-36 h-36">
              
              {/* Outer pulsing layer */}
              <motion.div
                animate={{
                  scale: isRecording ? [1, 1.25, 1] : [1, 1.1, 1],
                  opacity: isRecording ? [0.6, 0.2, 0.6] : [0.4, 0.1, 0.4]
                }}
                transition={{
                  duration: isRecording ? 1.2 : 3,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className={`absolute inset-0 rounded-full ${isRecording ? "bg-rose-500/20" : isProcessing ? "bg-cyan-500/20" : "bg-violet-500/20"}`}
              />

              <motion.div
                animate={{
                  scale: isRecording ? [1, 1.1, 1] : [1, 1.05, 1],
                  rotate: isProcessing ? [0, 360] : 0
                }}
                transition={{
                  duration: isProcessing ? 6 : 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className={`w-24 h-24 rounded-full flex items-center justify-center border-2 shadow-2xl transition-colors duration-500 ${
                  isRecording 
                    ? "bg-zinc-900 border-rose-500 shadow-rose-500/20" 
                    : isProcessing 
                    ? "bg-zinc-900 border-cyan-500 shadow-cyan-500/20" 
                    : "bg-zinc-900 border-violet-500 shadow-violet-500/20"
                }`}
              >
                {isRecording ? (
                  <div className="flex items-center gap-1 justify-center">
                    <span className="w-2 h-5 bg-rose-500 rounded-full animate-bounce delay-75" />
                    <span className="w-2 h-8 bg-rose-400 rounded-full animate-bounce delay-150" />
                    <span className="w-2 h-5 bg-rose-500 rounded-full animate-bounce delay-200" />
                  </div>
                ) : isProcessing ? (
                  <div className="text-cyan-400 font-mono text-[10px] text-center animate-pulse tracking-widest uppercase">
                    Reading...
                  </div>
                ) : (
                  <div className="flex items-center gap-1 justify-center">
                    <span className="w-1.5 h-3 bg-violet-500 rounded-full animate-pulse delay-75" />
                    <span className="w-1.5 h-6 bg-violet-400 rounded-full animate-pulse delay-150" />
                    <span className="w-1.5 h-3 bg-violet-500 rounded-full animate-pulse delay-200" />
                  </div>
                )}
              </motion.div>
            </div>
            
            <p className="text-xs text-zinc-400 text-center max-w-xs px-2 leading-relaxed">
              {isRecording 
                ? "Listening... Speak naturally to record intent. Click Stop when done." 
                : isProcessing 
                ? "AI Assistant is analyzing audio..." 
                : "Press the microphone below to talk to the AI Secretary."}
            </p>
          </div>

          {/* Action Trigger Pad */}
          <div className="flex flex-col items-center gap-2 w-full max-w-xs mt-auto shrink-0">
            {errorStatus && (
              <div className="w-full text-center p-2 rounded-lg bg-rose-950/40 text-[10px] text-rose-400 border border-rose-900/30 font-mono">
                {errorStatus}
              </div>
            )}

            {!isRecording ? (
              <button
                onClick={startRecording}
                disabled={isProcessing}
                id="btn-mic-start"
                className="w-full py-2.5 px-4 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-bold text-white transition-all hover:scale-[1.01] shadow-lg shadow-violet-500/10 cursor-pointer active:scale-95 text-xs"
              >
                <Mic className="w-4 h-4" />
                <span>Start Talking</span>
              </button>
            ) : (
              <button
                onClick={stopRecording}
                id="btn-mic-stop"
                className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 flex items-center justify-center gap-2 font-bold text-white transition-all hover:scale-[1.01] shadow-lg shadow-rose-600/20 cursor-pointer active:scale-95 animate-pulse text-xs"
              >
                <Square className="w-4 h-4" />
                <span>Stop & Send Voice</span>
              </button>
            )}
          </div>
        </div>

        {/* Right column: Interactive Conversational Screen + Realtime Intent Summary */}
        <div className="flex-1 flex flex-col bg-zinc-900/30 overflow-hidden min-h-0">
          
          {/* Summary Box */}
          <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
            <h3 className="text-[10px] font-mono font-black tracking-widest text-violet-400 uppercase mb-0.5">Live Intent Digest</h3>
            <p className="text-[11px] text-zinc-300 italic line-clamp-2 leading-tight">
              {intentSummary || "Awaiting caller input details..."}
            </p>
          </div>

          {/* Message List */}
          <div className="flex-grow overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {messages.map((m, index) => (
              <div 
                key={index} 
                className={`flex gap-2 max-w-[85%] ${m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border text-[10px] ${
                  m.role === "user" 
                    ? "bg-zinc-800 border-violet-500/30 text-violet-300" 
                    : "bg-zinc-950 border-emerald-500/30 text-emerald-300"
                }`}>
                  {m.role === "user" ? <User className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                </div>
                
                <div className={`p-3 rounded-xl shadow-sm text-xs leading-relaxed ${
                  m.role === "user" 
                    ? "bg-violet-950/40 border border-violet-700/30 text-violet-100 rounded-tr-none" 
                    : "bg-zinc-950/80 border border-zinc-800 text-zinc-100 rounded-tl-none"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Type message drawer */}
          <form 
            onSubmit={handleTextSubmit} 
            className="p-2.5 bg-zinc-900 border-t border-zinc-800 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={typedMessage}
              onChange={(e) => setTypedMessage(e.target.value)}
              placeholder="Type message directly..."
              disabled={isProcessing}
              id="input-text-msg"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500/40 transition-colors"
            />
            <button
              type="submit"
              disabled={!typedMessage.trim() || isProcessing}
              id="btn-send-text"
              className="p-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600 outline-none transition-colors cursor-pointer text-white"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
