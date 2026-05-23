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
  Video
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Contact, CallDocument, VoicemailDocument } from "./types";
import { 
  googleSignIn, 
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

export default function App() {
  // Authentication states
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [appLoading, setAppLoading] = useState(true);
  const [manualDialInput, setManualDialInput] = useState("");

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
    if (user && accessToken) {
      loadGoogleContactsAndVoicemails();
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

  const loadGoogleContactsAndVoicemails = async () => {
    if (!accessToken || !user || !user.email) return;
    setIsLoadingContacts(true);
    setIsLoadingVoicemails(true);
    
    try {
      // Load Google Contacts
      const contactList = await fetchGoogleContacts(accessToken);
      setContacts(contactList);

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
    try {
      const result = await googleSignIn();
      if (result) {
        setTokenAndLoad(result.accessToken, result.user);
      }
    } catch (e) {
      console.error("Google Auth SignIn Failure:", e);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const setTokenAndLoad = (token: string, currentUser: FirebaseUser) => {
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
  const handleInitiateCall = async (contact: Contact) => {
    if (!accessToken || !user || !user.email) return;
    
    setReceiverName(contact.name);
    setReceiverEmail(contact.email);
    setDialState("calling");

    try {
      console.log("Requesting backend Google Meet rest API space creation...");
      const meetRes = await fetch("/api/meet/create-space", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });

      if (!meetRes.ok) {
        throw new Error("Could not construct Google Meet room. API quota limit or token expired.");
      }

      const { meetingUri } = await meetRes.json();
      console.log("Ad-hoc Google Meet space created successfully:", meetingUri);

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

  const handleManualDialCall = () => {
    const input = manualDialInput.trim();
    if (!input) return;
    const isEmail = input.includes("@");
    const manualContact: Contact = {
      name: isEmail ? input.split("@")[0] : `Special Dial`,
      email: isEmail ? input : `${input}@manual-connect.com`,
      resourceName: `keypad-dial-${Date.now()}`
    };
    handleInitiateCall(manualContact);
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
          <p className="text-[12px] font-semibold text-zinc-400 tracking-wide mb-8 bg-white/5 py-1 px-3.5 rounded-full inline-block border border-white/5">
            Voice Translation & Call Assistant
          </p>

          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            id="btn-google-sign-in"
            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:via-indigo-505 hover:to-indigo-600 text-white py-4 px-6 rounded-2xl font-bold text-sm transition-all active:scale-[0.97] shadow-xl shadow-blue-500/10 hover:shadow-blue-500/25 cursor-pointer disabled:opacity-50"
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
            <span>Access Operator Terminal</span>
          </button>
        </div>
      </div>
    );
  }

  // B: Main Application Interface (Signed-In Workspace)
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex flex-col relative overflow-hidden">
      
      {/* Dynamic Background Mesh Accents */}
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] rounded-full bg-blue-500/5 blur-[120px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-amber-500/5 blur-[100px] animate-pulse pointer-events-none" />

      {/* 1. Bento Header Block */}
      <header className="mx-4 mt-4 px-6 py-4 bg-neutral-900/50 backdrop-blur-md border border-white/5 rounded-2xl shadow-2xl flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center">
            <Logo className="w-14 h-8" />
          </div>
          <div className="h-6 w-[1px] bg-white/10 hidden sm:block" />
          <div>
            <h2 className="text-base font-black tracking-tight flex items-center gap-2">
              <span className="font-display tracking-tight text-white">JUSUR</span>
              <span className="text-[8px] font-mono tracking-widest uppercase bg-blue-950/60 text-blue-400 font-black px-2.5 py-0.5 rounded-full border border-blue-900/50">Operator Core</span>
            </h2>
            <p className="text-[9px] text-zinc-500 font-mono hidden sm:block">Bridging connections seamlessly via voice translation</p>
          </div>
        </div>

        {/* User profile actions */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col text-right">
            <span className="text-xs font-black text-zinc-200">{user.displayName || "Google Operator"}</span>
            <span className="text-[10px] text-zinc-500 font-mono">{user.email}</span>
          </div>

          {user.photoURL ? (
            <img 
              referrerPolicy="no-referrer"
              src={user.photoURL} 
              alt={user.displayName || ""} 
              className="w-8 h-8 rounded-full border border-violet-500/30 hidden sm:block shadow-sm"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 hidden sm:block">
              <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
            </div>
          )}

          <button
            onClick={handleLogout}
            id="btn-sign-out"
            className="p-2 rounded-xl bg-zinc-950/80 hover:bg-rose-950/20 border border-zinc-850 hover:border-rose-900/30 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Log out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. Main content container: Multi-Column Bento Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch min-h-0">
        
        {/* Left Bento: Google Contacts Card */}
        <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 p-4 rounded-2xl flex flex-col h-[700px] overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div>
              <h3 className="font-black text-sm text-zinc-100 font-display">PHONEBOOK</h3>
              <p className="text-[10px] text-zinc-500">Google Contacts list</p>
            </div>
            <button
              onClick={loadGoogleContactsAndVoicemails}
              id="btn-reload-contacts"
              className="text-[10px] font-mono text-violet-400 hover:text-violet-350 font-bold px-2 py-0.5 roundedbg-zinc-950 border border-zinc-800 transition-all cursor-pointer"
            >
              Sync
            </button>
          </div>

          {/* Search Contacts Bar */}
          <div className="relative mb-3 shrink-0">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts..."
              id="input-contact-search"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-xs placeholder-zinc-600 outline-none focus:border-violet-500/30 transition-all text-zinc-100"
            />
          </div>

          {/* Contacts Rows */}
          <div className="flex-grow overflow-y-auto space-y-2 pr-1 min-h-0">
            {isLoadingContacts ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-2">
                <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                <span className="text-[10px] font-mono uppercase tracking-wider">Loading...</span>
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                <p className="text-zinc-500 text-xs font-semibold">No connections found.</p>
                <p className="text-[10px] text-zinc-650 mt-1 leading-relaxed">Ensure connections have emails registered in Google Contacts.</p>
              </div>
            ) : (
              filteredContacts.map((contact) => (
                <div 
                  key={contact.resourceName}
                  className="p-2.5 bg-zinc-950/40 border border-zinc-850/60 rounded-xl flex items-center justify-between gap-3 hover:border-zinc-800 hover:bg-zinc-950/80 transition-all group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {contact.photoUrl ? (
                      <img 
                        referrerPolicy="no-referrer"
                        src={contact.photoUrl} 
                        alt={contact.name} 
                        className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-violet-950/40 border border-violet-900/30 text-violet-400 flex items-center justify-center font-black font-mono text-xs select-none shrink-0 uppercase">
                        {contact.name[0] || "?"}
                      </div>
                    )}
                    <div className="min-w-0 leading-tight">
                      <h4 className="font-extrabold text-xs text-zinc-200 truncate">{contact.name}</h4>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">{contact.email}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleInitiateCall(contact)}
                    id={`btn-call-${contact.name.replace(/\s+/g, "-").toLowerCase()}`}
                    className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-zinc-950 text-[10px] font-black transition-all border border-emerald-500/20 active:scale-95 cursor-pointer shadow"
                  >
                    <Phone className="w-2.5 h-2.5" />
                    <span>Call</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>        {/* Center Bento: Interactive Calling Cockpit */}
        <div className="lg:col-span-6 bg-neutral-900/40 backdrop-blur-lg border border-white/5 rounded-2xl h-[700px] relative overflow-hidden flex flex-col p-6 shadow-2xl shadow-black/80">
          
          {/* Dialer States Nested Rendering */}
          {dialState === "idle" && (
            <div className="flex-grow flex flex-col justify-between h-full relative z-10">
              {/* Upper Line: System operational diagnostics */}
              <div className="flex justify-between items-center bg-neutral-950/80 border border-white/5 p-3.5 rounded-xl w-full shrink-0 shadow-inner">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  <span className="text-blue-400 text-[10px] font-mono tracking-widest uppercase font-black">Line Operational</span>
                </div>
                <div className="text-[9.5px] text-zinc-500 font-mono flex items-center gap-2.5">
                  <span className="text-zinc-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/10 font-bold">JUSUR-CORE v3.1</span>
                  <span>•</span>
                  <span>SSL TERMINATED</span>
                </div>
              </div>

              {/* Center Area: Launcher digits and keys */}
              <div className="my-auto py-6 flex flex-col items-center justify-center">
                <div className="p-3 bg-gradient-to-tr from-blue-500/10 to-transparent rounded-full border border-blue-500/10 mb-2 shadow-inner">
                  <PhoneCall className="w-5 h-5 text-blue-400 animate-pulse" />
                </div>
                <span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase mb-1 font-black">Digital Bridging Console</span>
                <p className="text-zinc-400 text-xs text-center px-4 max-w-sm mb-6 leading-relaxed">Select a peer from your Google contacts, or input any destination email below to initiate translation.</p>
                
                <div className="w-full max-w-sm relative shrink-0">
                  <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-blue-500/10 to-amber-500/10 blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200" />
                  <input 
                    type="text" 
                    value={manualDialInput}
                    onChange={(e) => setManualDialInput(e.target.value)}
                    placeholder="Enter email to bridge..."
                    className="w-full bg-neutral-950/90 border border-white/5 rounded-2xl px-5 py-4 text-center font-extrabold text-zinc-200 placeholder-zinc-700 outline-none focus:border-blue-500/30 text-sm transition-all shadow-inner font-mono"
                  />
                  {manualDialInput && (
                    <button 
                      onClick={() => setManualDialInput("")}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-rose-400 font-mono text-[9px] font-black px-2 py-1 hover:bg-rose-950/20 rounded border border-transparent hover:border-rose-900/20 transition-all cursor-pointer"
                    >
                      CLEAR
                    </button>
                  )}
                </div>

                {/* Keypad Digits formatted extremely premium */}
                <div className="grid grid-cols-3 gap-3.5 mt-7 max-w-[250px] mx-auto shrink-0">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeypadPress(key)}
                      className="w-12 h-12 rounded-2xl bg-neutral-900/80 border border-white/5 text-zinc-300 font-display font-bold text-sm hover:text-white hover:bg-neutral-800 hover:border-blue-500/20 active:scale-90 transition-all flex items-center justify-center cursor-pointer select-none shadow"
                    >
                      {key}
                    </button>
                  ))}
                </div>

                {/* Dial Button with gorgeous gold/blue glow ring indicator */}
                <div className="relative mt-7 shrink-0">
                  {manualDialInput.trim() && (
                    <div className="absolute -inset-1.5 rounded-full bg-gradient-to-r from-blue-500 to-amber-500 opacity-60 blur animate-pulse" />
                  )}
                  <button
                    onClick={handleManualDialCall}
                    disabled={!manualDialInput.trim()}
                    className="relative w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 border border-white/10 disabled:from-neutral-900 disabled:to-neutral-950 disabled:border-white/5 disabled:text-zinc-700 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl cursor-pointer"
                    title="Bridge Voice Connection"
                  >
                    <Phone className={`w-5 h-5 ${manualDialInput.trim() ? "text-white fill-white animate-bounce" : "text-zinc-650"}`} />
                  </button>
                </div>
              </div>

              {/* Lower diagnostics */}
              <div className="text-center font-mono text-[9px] text-zinc-600 tracking-wider shrink-0 mt-auto leading-relaxed">
                SESSION OPERATOR INTERFACE ID • {user.uid.slice(0, 10).toUpperCase()} • JUSUR ACTIVE UNIT
              </div>
            </div>
          )}

          {/* Active Dialer overlay in progress */}
          {dialState === "calling" && (
            <DialerOverlay
              receiverName={receiverName}
              receiverEmail={receiverEmail}
              status={outgoingCall?.status || "ringing"}
              onCancel={handleCancelOutgoing}
              timeoutSeconds={15}
            />
          )}

          {/* Active voice record secretary */}
          {dialState === "secretary" && outgoingCall && (
            <SecretaryOverlay
              call={outgoingCall}
              onFinish={handleFinishSecretary}
            />
          )}

          {/* Active in-app video/voice translator call */}
          {dialState === "active_call" && outgoingCall && (
            <ActiveCallScreen
              call={outgoingCall}
              onHangUp={handleFinishSecretary}
              currentUserEmail={user.email || ""}
            />
          )}

        </div>

        {/* Right Bento: Secretary Inbox & Activity log Feed */}
        <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 p-4 rounded-2xl flex flex-col h-[700px] overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <Voicemail className="w-4 h-4 text-violet-400" />
              <h3 className="font-black text-sm text-zinc-100 font-display">SECRETARY INBOX</h3>
            </div>
            <button
              onClick={reloadVoicemails}
              id="btn-refresh-voicemails"
              className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200 border border-zinc-800 cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {/* Dynamic Records Feed */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
            {isLoadingVoicemails ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-2">
                <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                <span className="text-[10px] font-mono">Loading Inbox...</span>
              </div>
            ) : (
              <VoicemailsList voicemails={voicemails} />
            )}
          </div>

          <div className="mt-3 p-3 border border-dashed border-violet-500/20 rounded-xl bg-violet-950/5 shrink-0">
            <h4 className="text-[10px] font-mono font-bold uppercase text-violet-400 flex items-center gap-1.5 mb-1">
              <Sparkles className="w-3 h-3" />
              Verbal Intent Loop
            </h4>
            <p className="text-[10.5px] text-zinc-500 leading-normal">
              Outgoing calls establish a real-time signal. If unanswered within 15 seconds, your designated AI secretary collects speech inputs of what they want, distills intentions, maps them, and formats logs here.
            </p>
          </div>
        </div>

      </main>

      {/* 3. Global Full-Screen Overlays (Notification interrupts) */}
      <AnimatePresence>
        {incomingCall && (
          <IncomingOverlay
            incomingCall={incomingCall}
            onAccept={handleAcceptIncoming}
            onDecline={handleDeclineIncoming}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
