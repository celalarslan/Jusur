import React, { useState, useEffect, useRef } from "react";
import { 
  User as FirebaseUser 
} from "firebase/auth";
import { 
  Phone, 
  Search, 
  Trash2, 
  Sparkles, 
  User as UserIcon, 
  LogOut, 
  Voicemail, 
  PhoneCall,
  Loader2,
  Video,
  MessageCircle,
  Settings,
  Languages,
  SlidersHorizontal,
  ChevronLeft,
  Bell,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Contact, CallDocument, VoicemailDocument } from "./types";
import { 
  googleSignIn, 
  emailPasswordSignIn,
  requestGoogleWorkspaceAccess,
  initAuth, 
  logout, 
  createCallDoc, 
  updateCallDoc, 
  deleteCallDoc, 
  listenIncomingCalls, 
  listenSingleCall,
  fetchVoicemails
} from "./firebase";
import { fetchGoogleContacts } from "./contacts";

// Modular sub components
import { IncomingOverlay } from "./components/IncomingOverlay";
import { DialerOverlay } from "./components/DialerOverlay";
import { SecretaryOverlay } from "./components/SecretaryOverlay";
import { VoicemailsList } from "./components/VoicemailsList";
import { ActiveCallScreen } from "./components/ActiveCallScreen";
import { Logo } from "./components/Logo";

const LOCAL_DEMO_MODE =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  new URLSearchParams(window.location.search).has("demo");

const LOCAL_DEMO_USER = {
  uid: "local-demo-user",
  email: "demo@jusur.local",
  displayName: "Local Demo",
  photoURL: null
} as FirebaseUser;

const QUICK_LANGUAGES = [
  { value: "auto", label: "Auto" },
  { value: "Turkish (Türkçe)", label: "Türkçe" },
  { value: "English", label: "English" },
  { value: "Arabic (العربية)", label: "Arabic" },
  { value: "Spanish (Español)", label: "Spanish" },
  { value: "French (Français)", label: "French" },
  { value: "German (Deutsch)", label: "German" }
];

export default function App() {
  // Authentication states
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<"email" | "google">("email");
  const [emailAuthMode, setEmailAuthMode] = useState<"signup" | "signin">("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [appLoading, setAppLoading] = useState(true);
  const [manualDialInput, setManualDialInput] = useState("");
  const [activePanel, setActivePanel] = useState<"home" | "contacts" | "settings">("home");
  const [callMode, setCallMode] = useState<"audio" | "video">("video");
  const [myLanguage, setMyLanguage] = useState("auto");
  const [partnerLanguage, setPartnerLanguage] = useState("Turkish (Türkçe)");
  const [preferredVoice, setPreferredVoice] = useState<"Aoede" | "Fenrir">("Aoede");

  // Phonebook contacts
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  // Voicemails state
  const [voicemails, setVoicemails] = useState<VoicemailDocument[]>([]);
  const [isLoadingVoicemails, setIsLoadingVoicemails] = useState(false);

  // Active Outgoing Call (Dialer) states
  const [dialState, setDialState] = useState<"idle" | "calling" | "secretary" | "active_call">("idle");
  const [outgoingCall, setOutgoingCall] = useState<CallDocument | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [receiverEmail, setReceiverEmail] = useState("");

  // Active Incoming Call states
  const [incomingCall, setIncomingCall] = useState<CallDocument | null>(null);

  // Timers and Listeners Refs
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const singleCallUnsubscribeRef = useRef<(() => void) | null>(null);
  const incomingCallsUnsubscribeRef = useRef<(() => void) | null>(null);

  // 1. Listen for Authentication state changes
  useEffect(() => {
    if (LOCAL_DEMO_MODE) {
      setUser(LOCAL_DEMO_USER);
      setAccessToken(null);
      setNeedsAuth(false);
      setAppLoading(false);
      return;
    }

    const unsub = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
        setNeedsAuth(false);
        setAppLoading(false);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
        setAppLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // 2. Fetch Contacts and Voicemails when authenticated
  useEffect(() => {
    if (LOCAL_DEMO_MODE && user) {
      setContacts([
        {
          resourceName: "local-demo-contact",
          name: "Jusur Demo Peer",
          email: "peer@jusur.local"
        }
      ]);
      setVoicemails([]);
      return;
    }

    if (user) {
      loadGoogleContactsAndVoicemails(false);
      setupIncomingCallListener();
    } else {
      // Clear data if logged out
      setContacts([]);
      setVoicemails([]);
      if (incomingCallsUnsubscribeRef.current) {
        incomingCallsUnsubscribeRef.current();
        incomingCallsUnsubscribeRef.current = null;
      }
    }
  }, [user, accessToken]);

  const loadGoogleContactsAndVoicemails = async (allowGooglePrompt = true) => {
    if (!user || !user.email) return;
    setIsLoadingContacts(true);
    setIsLoadingVoicemails(true);
    
    try {
      let tokenForGoogleApis = accessToken;
      if (!tokenForGoogleApis && allowGooglePrompt) {
        tokenForGoogleApis = await requestGoogleWorkspaceAccess();
        setAccessToken(tokenForGoogleApis);
      }

      if (tokenForGoogleApis) {
        const contactList = await fetchGoogleContacts(tokenForGoogleApis);
        setContacts(contactList);
      } else {
        setContacts([]);
      }

      // Load historic Voicemails left for current user email
      const records = await fetchVoicemails(user.email);
      setVoicemails(records);
    } catch (e) {
      console.error("Failed loading user profiles or inbox voicemail:", e);
    } finally {
      setIsLoadingContacts(false);
      setIsLoadingVoicemails(false);
    }
  };

  // Quick refresh helper for the voicemails inbox
  const reloadVoicemails = async () => {
    if (!user || !user.email) return;
    setIsLoadingVoicemails(true);
    try {
      const records = await fetchVoicemails(user.email);
      setVoicemails(records);
    } catch (e) {
      console.error("Failed loading voicemails:", e);
    } finally {
      setIsLoadingVoicemails(false);
    }
  };

  // 3. Authenticate Google Client
  const handleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setTokenAndLoad(result.accessToken, result.user);
      }
    } catch (e) {
      console.error("Google Auth SignIn Failure:", e);
      setAuthError("Google login is blocked by OAuth origin settings. Use email login for local testing.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || authPassword.length < 6) {
      setAuthError("Enter an email and a password with at least 6 characters.");
      return;
    }

    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await emailPasswordSignIn(authEmail.trim(), authPassword, authName.trim() || undefined, emailAuthMode);
      setTokenAndLoad(result.accessToken, result.user);
    } catch (error: any) {
      console.error("Email login failure:", error);
      if (error?.code === "auth/operation-not-allowed") {
        setAuthError("Email login is not enabled yet in Firebase Authentication.");
      } else if (error?.code === "auth/email-already-in-use") {
        setAuthError("This email already has an account. Switch to Sign in.");
      } else if (error?.code === "auth/invalid-credential" || error?.code === "auth/user-not-found") {
        setAuthError("No account found for this email/password. Switch to Create account.");
      } else {
        setAuthError(error?.message || "Email login failed.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const setTokenAndLoad = (token: string | null, currentUser: FirebaseUser) => {
    setAccessToken(token);
    setUser(currentUser);
    setNeedsAuth(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      setNeedsAuth(true);
    } catch (e) {
      console.error("Logoff failed:", e);
    }
  };

  // 4. Real-time Incoming Call Listener
  const setupIncomingCallListener = () => {
    if (!user?.email) return;
    
    if (incomingCallsUnsubscribeRef.current) {
      incomingCallsUnsubscribeRef.current();
    }

    incomingCallsUnsubscribeRef.current = listenIncomingCalls(
      user.email,
      (incomingCalls) => {
        if (incomingCalls.length > 0) {
          // Trigger first incoming call
          setIncomingCall(incomingCalls[0]);
        } else {
          setIncomingCall(null);
        }
      },
      (error) => {
        console.error("Incoming calls collection mapping listener error:", error);
      }
    );
  };

  // 5. Place Outgoing Call
  const handleInitiateCall = async (contact: Contact, mode: "audio" | "video" = "video") => {
    if (!user || !user.email) return;
    
    setCallMode(mode);
    setReceiverName(contact.name);
    setReceiverEmail(contact.email);
    setDialState("calling");

    try {
      if (LOCAL_DEMO_MODE) {
        const demoCall: CallDocument = {
          id: `local-demo-${Date.now()}`,
          callerId: user.uid,
          callerName: user.displayName || "Local Demo",
          callerEmail: user.email,
          receiverEmail: contact.email,
          meetUri: "jusur://local-demo",
          status: "answered",
          timestamp: null
        };
        setOutgoingCall(demoCall);
        setDialState("active_call");
        return;
      }

      let meetingUri = `jusur://internal/${Date.now()}`;
      if (accessToken) {
        console.log("Requesting backend Google Meet rest API space creation...");
        try {
          const meetRes = await fetch("/api/meet/create-space", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            }
          });

          if (meetRes.ok) {
            const meetData = await meetRes.json();
            meetingUri = meetData.meetingUri;
            console.log("Ad-hoc Google Meet space created successfully:", meetingUri);
          } else {
            const details = await meetRes.json().catch(() => ({}));
            console.warn("Google Meet space creation skipped; falling back to in-app WebRTC signaling.", details);
          }
        } catch (meetError) {
          console.warn("Google Meet space creation failed; falling back to in-app WebRTC signaling.", meetError);
        }
      }

      // Create Call signaling document with 'ringing' status
      const callDocId = await createCallDoc({
        callerId: user.uid,
        callerName: user.displayName || user.email.split("@")[0],
        callerEmail: user.email,
        receiverEmail: contact.email,
        meetUri: meetingUri,
        status: "ringing"
      });

      // Save call state locally
      const initialCallObj: CallDocument = {
        id: callDocId,
        callerId: user.uid,
        callerName: user.displayName || user.email.split("@")[0],
        callerEmail: user.email,
        receiverEmail: contact.email,
        meetUri: meetingUri,
        status: "ringing",
        timestamp: null
      };
      setOutgoingCall(initialCallObj);

      // Listen for updates on this single call doc
      subscribeToOutgoingCall(callDocId, meetingUri, contact.name);

      // Set up 15-second timeout for AI Secretary activation
      setupSecretaryCallTimeout(callDocId, initialCallObj);

    } catch (err: any) {
      console.error("Calling origin step failure:", err);
      alert(`Call failed: ${err.message || "Please make sure your Google token details are valid."}`);
      setDialState("idle");
    }
  };

  const subscribeToOutgoingCall = (callId: string, meetUri: string, targetName: string) => {
    if (singleCallUnsubscribeRef.current) {
      singleCallUnsubscribeRef.current();
    }

    singleCallUnsubscribeRef.current = listenSingleCall(
      callId,
      (callDoc) => {
        if (!callDoc) {
          // Caller was deleted, end call
          handleCancelOutgoing();
          return;
        }

        setOutgoingCall(callDoc);

        if (callDoc.status === "answered") {
          console.log("Receiver answered call! Transitioning to Active Call Screen...");
          clearSecretaryTimeout();
          
          setOutgoingCall(callDoc);
          setDialState("active_call");
        } else if (callDoc.status === "missed" || callDoc.status === "ended") {
          console.log("Call was declined or missed by the recipient.");
          handleCancelOutgoing();
          alert(`${targetName} is busy or declined the call.`);
        }
      },
      (error) => {
        console.error("Single call listening error:", error);
      }
    );
  };

  // 15 seconds timer to switch calling to AI Secretary
  const setupSecretaryCallTimeout = (callId: string, callDoc: CallDocument) => {
    clearSecretaryTimeout();
    timeoutRef.current = setTimeout(async () => {
      console.log("No answer in 15 seconds. Upgrading call status to AI Secretary...");
      try {
        await updateCallDoc(callId, { status: "ai_secretary_active" });
        setDialState("secretary");
      } catch (e) {
        console.error("Error activating secretary state in firestore:", e);
        setDialState("secretary");
      }
    }, 15000);
  };

  const clearSecretaryTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Hang up/Cancel outgoing ringing call before answer/AI
  const handleCancelOutgoing = async () => {
    clearSecretaryTimeout();
    
    if (singleCallUnsubscribeRef.current) {
      singleCallUnsubscribeRef.current();
      singleCallUnsubscribeRef.current = null;
    }

    if (outgoingCall) {
      try {
        await updateCallDoc(outgoingCall.id, { status: "ended" });
        await deleteCallDoc(outgoingCall.id);
      } catch (e) {
        console.error("Cleanup call failure:", e);
      }
    }

    setDialState("idle");
    setOutgoingCall(null);
  };

  // 6. Handle Incoming Call state selections (Receiver flow)
  const handleAcceptIncoming = async () => {
    if (!incomingCall) return;
    const callId = incomingCall.id;
    try {
      console.log("Accepting incoming call, updating Firestore...");
      await updateCallDoc(callId, { status: "answered" });
      
      setReceiverName(incomingCall.callerName);
      setReceiverEmail(incomingCall.callerEmail);
      setOutgoingCall(incomingCall);
      setDialState("active_call");

      // Receiver listens to caller hung-ups
      if (singleCallUnsubscribeRef.current) {
        singleCallUnsubscribeRef.current();
      }
      singleCallUnsubscribeRef.current = listenSingleCall(
        callId,
        (callDoc) => {
          if (!callDoc || callDoc.status === "ended") {
            console.log("Call was terminated by remote party.");
            handleFinishSecretary();
          } else {
            setOutgoingCall(callDoc);
          }
        },
        (error) => console.error("Receiver call trace error:", error)
      );

      setIncomingCall(null);
    } catch (e) {
      console.error("Accept call error:", e);
    }
  };

  const handleDeclineIncoming = async () => {
    if (!incomingCall) return;
    try {
      console.log("Declining incoming call, updating status...");
      await updateCallDoc(incomingCall.id, { status: "missed" });
      setIncomingCall(null);
    } catch (e) {
      console.error("Decline call error:", e);
    }
  };

  // Clear session after finishing secretary voicemail recording
  const handleFinishSecretary = () => {
    setDialState("idle");
    setOutgoingCall(null);
    reloadVoicemails(); // Refresh local list to render newly left voicemail!
  };

  const handleKeypadPress = (val: string) => {
    setManualDialInput((prev) => prev + val);
  };

  const handleManualDialCall = (mode: "audio" | "video" = "video") => {
    const input = manualDialInput.trim();
    if (!input) return;
    const isEmail = input.includes("@");
    const manualContact: Contact = {
      name: isEmail ? input.split("@")[0] : `Special Dial`,
      email: isEmail ? input : `${input}@manual-connect.com`,
      resourceName: `keypad-dial-${Date.now()}`
    };
    handleInitiateCall(manualContact, mode);
  };

  // Filter contacts by search query
  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // App loading spinner
  if (appLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-100 font-sans">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin mb-3.5" />
        <p className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase">Initializing Operator Line...</p>
      </div>
    );
  }

  // A: Standard Authentication Screen (Needs Google SignIn)
  if (needsAuth || !user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-sans px-4 relative overflow-hidden">
        
        {/* Futuristic Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)] pointer-events-none" />

        {/* Ambient Vibrant Cosmic Mesh Accents */}
        <div className="absolute -top-40 -left-40 w-[650px] h-[650px] rounded-full bg-gradient-to-tr from-blue-600/30 to-cyan-500/20 blur-[140px] animate-pulse pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-[650px] h-[650px] rounded-full bg-gradient-to-br from-indigo-600/20 to-amber-500/15 blur-[150px] animate-pulse pointer-events-none animate-delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-blue-500/5 blur-[110px] pointer-events-none" />

        <div className="relative w-full max-w-sm bg-neutral-900/90 backdrop-blur-2xl border border-white/10 p-9 rounded-[32px] shadow-[0_0_60px_rgba(37,99,235,0.2)] text-center transition-all duration-500 hover:border-blue-500/20">
          
          {/* Active Glowing Ring Decoration around the logo */}
          <div className="relative inline-flex items-center justify-center p-1 rounded-3xl bg-gradient-to-tr from-blue-500 via-indigo-500 to-amber-400 mb-8 shadow-lg shadow-blue-500/20">
            <div className="absolute inset-[1px] bg-neutral-950 rounded-[22px] -z-10" />
            <div className="p-4 bg-black/90 rounded-[22px] border border-white/10 relative z-10 flex items-center justify-center shadow-inner">
              <Logo className="w-20 h-10" />
            </div>
            {/* Soft breathing halo behind */}
            <div className="absolute -inset-2 bg-gradient-to-tr from-blue-500 to-amber-500 opacity-30 blur-lg animate-pulse" />
          </div>

          <h1 className="text-4xl font-extrabold font-display tracking-tighter text-white mb-2 uppercase bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-zinc-100 to-amber-300">
            Jusur
          </h1>
          <p className="text-[12px] font-semibold text-zinc-400 tracking-wide mb-6 bg-white/5 py-1 px-3.5 rounded-full inline-block border border-white/5">
            Voice Translation & Call Assistant
          </p>

          <div className="grid grid-cols-2 gap-2 mb-4 rounded-2xl bg-black/40 border border-white/10 p-1">
            <button
              type="button"
              onClick={() => setAuthMode("email")}
              className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${authMode === "email" ? "bg-cyan-400 text-slate-950" : "text-zinc-400 hover:text-white"}`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("google")}
              className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${authMode === "google" ? "bg-cyan-400 text-slate-950" : "text-zinc-400 hover:text-white"}`}
            >
              Google
            </button>
          </div>

          {authMode === "email" ? (
            <form onSubmit={handleEmailLogin} className="space-y-3 text-left">
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-black/35 border border-white/10 p-1">
                <button
                  type="button"
                  onClick={() => setEmailAuthMode("signup")}
                  className={`py-2 rounded-xl text-[11px] font-black transition-all cursor-pointer ${emailAuthMode === "signup" ? "bg-emerald-300 text-slate-950" : "text-zinc-400 hover:text-white"}`}
                >
                  Create account
                </button>
                <button
                  type="button"
                  onClick={() => setEmailAuthMode("signin")}
                  className={`py-2 rounded-xl text-[11px] font-black transition-all cursor-pointer ${emailAuthMode === "signin" ? "bg-emerald-300 text-slate-950" : "text-zinc-400 hover:text-white"}`}
                >
                  Sign in
                </button>
              </div>
              <input
                type="text"
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
                placeholder="Display name"
                disabled={emailAuthMode === "signin"}
                className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-300/40"
              />
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Email address"
                className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-300/40"
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder={emailAuthMode === "signup" ? "Create a password" : "Password"}
                className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-300/40"
              />
              <p className="text-[10px] leading-relaxed text-zinc-500 px-1">
                {emailAuthMode === "signup"
                  ? "Choose any password with at least 6 characters. This creates a local Firebase account for testing."
                  : "Use the password you created for this email account."}
              </p>
              <button
                type="submit"
                disabled={isLoggingIn}
                id="btn-email-sign-in"
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-400 to-emerald-300 hover:from-cyan-300 hover:to-emerald-200 text-slate-950 py-4 px-6 rounded-2xl font-black text-sm transition-all active:scale-[0.97] shadow-xl shadow-cyan-500/10 cursor-pointer disabled:opacity-50"
              >
                {isLoggingIn && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{emailAuthMode === "signup" ? "Create and enter" : "Enter Jusur Core"}</span>
              </button>
            </form>
          ) : (
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              id="btn-google-sign-in"
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:via-indigo-500 hover:to-indigo-600 text-white py-4 px-6 rounded-2xl font-bold text-sm transition-all active:scale-[0.97] shadow-xl shadow-blue-500/10 hover:shadow-blue-500/25 cursor-pointer disabled:opacity-50"
            >
              {isLoggingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4 shrink-0 shadow-sm">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
              )}
              <span>Connect Google APIs</span>
            </button>
          )}

          {authError && (
            <p className="mt-3 text-[11px] leading-relaxed text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-xl p-3">
              {authError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // B: Mobile-first calling app shell
  return (
    <div className="min-h-screen bg-[#050609] text-neutral-100 font-sans relative overflow-hidden">
      <main className="relative z-10 min-h-screen flex justify-center px-3 py-3 sm:py-6">
        <div className="w-full max-w-[430px] min-h-[calc(100vh-24px)] sm:min-h-[860px] sm:max-h-[920px] rounded-[30px] sm:rounded-[38px] border border-cyan-300/15 bg-[#080b12]/95 shadow-[0_0_70px_rgba(34,211,238,0.14)] overflow-hidden relative flex flex-col">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_100%_22%,rgba(168,85,247,0.17),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] pointer-events-none" />

          <div className="relative z-10 flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-12 w-12 rounded-2xl border border-cyan-300/20 bg-black/35 flex items-center justify-center shadow-[0_0_24px_rgba(34,211,238,0.12)] shrink-0">
                <Logo className="w-9 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-200/60 font-black">Jusur</p>
                <h1 className="text-lg font-black tracking-tight truncate">{user.displayName || user.email?.split("@")[0] || "Operator"}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reloadVoicemails}
                className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 text-cyan-100 flex items-center justify-center active:scale-95 transition"
                title="Inbox"
              >
                <Bell className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActivePanel("settings")}
                className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 text-cyan-100 flex items-center justify-center active:scale-95 transition"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative z-10 px-5 pb-3 flex-1 min-h-0 overflow-y-auto">
            {dialState === "idle" && activePanel !== "settings" && (
              <div className="space-y-4 pb-24">
                <div className="rounded-[26px] border border-cyan-300/10 bg-black/30 p-4 shadow-inner">
                  <div className="relative">
                    <Search className="w-4 h-4 text-cyan-200/50 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={manualDialInput}
                      onChange={(e) => setManualDialInput(e.target.value)}
                      placeholder="Email, phone, or contact"
                      className="w-full h-14 rounded-2xl border border-white/10 bg-slate-950/80 pl-11 pr-4 text-[15px] font-bold text-white placeholder:text-slate-600 outline-none focus:border-cyan-300/40"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => handleManualDialCall("audio")}
                      disabled={!manualDialInput.trim()}
                      className="h-16 rounded-2xl bg-gradient-to-br from-emerald-300 to-cyan-300 text-slate-950 font-black flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[0.98] transition shadow-[0_0_28px_rgba(45,212,191,0.22)]"
                    >
                      <Phone className="w-5 h-5" />
                      <span>Audio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleManualDialCall("video")}
                      disabled={!manualDialInput.trim()}
                      className="h-16 rounded-2xl bg-gradient-to-br from-fuchsia-400 to-blue-400 text-white font-black flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[0.98] transition shadow-[0_0_28px_rgba(96,165,250,0.24)]"
                    >
                      <Video className="w-5 h-5" />
                      <span>Video</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-cyan-300/10 bg-white/[0.04] p-3">
                    <Languages className="w-4 h-4 text-cyan-200 mb-2" />
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Your language</label>
                    <select
                      value={myLanguage}
                      onChange={(e) => setMyLanguage(e.target.value)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    >
                      {QUICK_LANGUAGES.map((language) => (
                        <option key={language.value} value={language.value}>{language.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-2xl border border-cyan-300/10 bg-white/[0.04] p-3">
                    <MessageCircle className="w-4 h-4 text-violet-200 mb-2" />
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Translate to</label>
                    <select
                      value={partnerLanguage}
                      onChange={(e) => setPartnerLanguage(e.target.value)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    >
                      {QUICK_LANGUAGES.filter((language) => language.value !== "auto").map((language) => (
                        <option key={language.value} value={language.value}>{language.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-2xl border border-cyan-300/10 bg-white/[0.04] p-3">
                    <Sparkles className="w-4 h-4 text-amber-200 mb-2" />
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Voice</label>
                    <select
                      value={preferredVoice}
                      onChange={(e) => setPreferredVoice(e.target.value as "Aoede" | "Fenrir")}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    >
                      <option value="Aoede">Female</option>
                      <option value="Fenrir">Male</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-black tracking-tight">Chats</h2>
                    <p className="text-[11px] text-slate-500 font-semibold">{filteredContacts.length} ready contacts</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadGoogleContactsAndVoicemails(true)}
                    className="h-9 px-3 rounded-full border border-cyan-300/15 bg-cyan-300/10 text-cyan-100 text-[11px] font-black active:scale-95 transition"
                  >
                    Sync
                  </button>
                </div>

                <div className="space-y-2">
                  {isLoadingContacts ? (
                    <div className="h-40 flex items-center justify-center text-cyan-200">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-7 text-center">
                      <PhoneCall className="w-8 h-8 text-cyan-200/60 mx-auto mb-3" />
                      <p className="text-sm font-black">No contacts yet</p>
                      <p className="text-xs text-slate-500 mt-1">Use the search box above or sync Google Contacts.</p>
                    </div>
                  ) : (
                    filteredContacts.map((contact) => (
                      <div
                        key={contact.resourceName}
                        className="rounded-[24px] border border-white/10 bg-white/[0.045] p-3 flex items-center gap-3"
                      >
                        {contact.photoUrl ? (
                          <img referrerPolicy="no-referrer" src={contact.photoUrl} alt={contact.name} className="w-12 h-12 rounded-2xl object-cover shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-300/20 to-violet-400/20 border border-cyan-300/15 text-cyan-100 flex items-center justify-center font-black shrink-0">
                            {contact.name[0] || "?"}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-black truncate">{contact.name}</h3>
                          <p className="text-[11px] text-slate-500 truncate">{contact.email}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleInitiateCall(contact, "audio")}
                          className="h-10 w-10 rounded-2xl bg-emerald-300 text-slate-950 flex items-center justify-center active:scale-95 transition"
                          title="Audio call"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateCall(contact, "video")}
                          className="h-10 w-10 rounded-2xl bg-blue-400 text-white flex items-center justify-center active:scale-95 transition"
                          title="Video call"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activePanel === "settings" && dialState === "idle" && (
              <div className="space-y-4 pb-24">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActivePanel("home")}
                    className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center"
                    title="Back"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div>
                    <h2 className="text-xl font-black tracking-tight">Settings</h2>
                    <p className="text-xs text-slate-500">Profile, inbox, sync and security</p>
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4 flex items-center gap-3">
                  {user.photoURL ? (
                    <img referrerPolicy="no-referrer" src={user.photoURL} alt={user.displayName || ""} className="w-14 h-14 rounded-2xl object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-cyan-300/10 border border-cyan-300/20 flex items-center justify-center">
                      <UserIcon className="w-5 h-5 text-cyan-100" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-black truncate">{user.displayName || "Jusur User"}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-cyan-100 font-black text-sm">
                    <SlidersHorizontal className="w-4 h-4" />
                    Call defaults
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <select value={myLanguage} onChange={(e) => setMyLanguage(e.target.value)} className="h-12 rounded-2xl bg-slate-950 border border-white/10 px-3 text-xs font-bold outline-none">
                      {QUICK_LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
                    </select>
                    <select value={partnerLanguage} onChange={(e) => setPartnerLanguage(e.target.value)} className="h-12 rounded-2xl bg-slate-950 border border-white/10 px-3 text-xs font-bold outline-none">
                      {QUICK_LANGUAGES.filter((language) => language.value !== "auto").map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setPreferredVoice("Aoede")} className={`h-12 rounded-2xl border text-xs font-black ${preferredVoice === "Aoede" ? "bg-cyan-300 text-slate-950 border-cyan-300" : "bg-slate-950 border-white/10 text-slate-300"}`}>Female voice</button>
                    <button type="button" onClick={() => setPreferredVoice("Fenrir")} className={`h-12 rounded-2xl border text-xs font-black ${preferredVoice === "Fenrir" ? "bg-violet-300 text-slate-950 border-violet-300" : "bg-slate-950 border-white/10 text-slate-300"}`}>Male voice</button>
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-violet-100 font-black text-sm">
                      <Voicemail className="w-4 h-4" />
                      Secretary inbox
                    </div>
                    <button type="button" onClick={reloadVoicemails} className="text-[11px] font-black text-cyan-200">Refresh</button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {isLoadingVoicemails ? (
                      <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-violet-200" /></div>
                    ) : (
                      <VoicemailsList voicemails={voicemails} />
                    )}
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-100 font-black text-sm">
                    <ShieldCheck className="w-4 h-4" />
                    Service status
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-400">
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Firebase: j-call-prod</span>
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Firestore: eur3</span>
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Gemini Live: ready</span>
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Meet: Google token</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full h-13 rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200 font-black flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            )}

            {dialState === "calling" && (
              <DialerOverlay receiverName={receiverName} receiverEmail={receiverEmail} status={outgoingCall?.status || "ringing"} onCancel={handleCancelOutgoing} timeoutSeconds={15} />
            )}

            {dialState === "secretary" && outgoingCall && (
              <SecretaryOverlay call={outgoingCall} onFinish={handleFinishSecretary} />
            )}

            {dialState === "active_call" && outgoingCall && (
              <ActiveCallScreen
                call={outgoingCall}
                onHangUp={handleFinishSecretary}
                currentUserEmail={user.email || ""}
                initialMyLanguage={myLanguage}
                initialPartnerLanguage={partnerLanguage}
                initialVoice={preferredVoice}
                initialVideoEnabled={callMode === "video"}
              />
            )}
          </div>

          {dialState === "idle" && (
            <nav className="relative z-10 mx-5 mb-5 h-16 rounded-[26px] border border-white/10 bg-slate-950/85 backdrop-blur-xl flex items-center justify-around shadow-[0_0_34px_rgba(0,0,0,0.38)]">
              <button type="button" onClick={() => setActivePanel("home")} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${activePanel === "home" ? "bg-cyan-300 text-slate-950" : "text-slate-500"}`} title="Home">
                <MessageCircle className="w-5 h-5" />
              </button>
              <button type="button" onClick={() => setActivePanel("contacts")} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${activePanel === "contacts" ? "bg-cyan-300 text-slate-950" : "text-slate-500"}`} title="Contacts">
                <PhoneCall className="w-5 h-5" />
              </button>
              <button type="button" onClick={() => setActivePanel("settings")} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${activePanel === "settings" ? "bg-cyan-300 text-slate-950" : "text-slate-500"}`} title="Settings">
                <Settings className="w-5 h-5" />
              </button>
            </nav>
          )}
        </div>
      </main>

      <AnimatePresence>
        {incomingCall && (
          <IncomingOverlay incomingCall={incomingCall} onAccept={handleAcceptIncoming} onDecline={handleDeclineIncoming} />
        )}
      </AnimatePresence>
    </div>
  );
}
