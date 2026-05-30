import React, { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { 
  User as FirebaseUser 
} from "firebase/auth";
import { 
  Phone, 
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Search, 
  Sparkles, 
  Trash2,
  User as UserIcon, 
  LogOut, 
  Voicemail, 
  PhoneCall,
  UserPlus,
  History,
  Loader2,
  Video,
  MessageCircle,
  Settings,
  Languages,
  SlidersHorizontal,
  ChevronLeft,
  Bell,
  ShieldCheck,
  Download
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Contact, CallDocument, CallLogDocument, VoicemailDocument } from "./types";
import { 
  googleSignIn, 
  emailPasswordSignIn,
  requestGoogleWorkspaceAccess,
  initAuth, 
  logout, 
  getCurrentIdToken,
  createCallDoc, 
  createCallLogDoc,
  updateCallDoc, 
  updateCallLogDoc,
  deleteCallLogDoc,
  deleteCallDoc, 
  listenIncomingCalls, 
  listenSingleCall,
  fetchVoicemails,
  deleteVoicemailDoc,
  saveSecretaryProfile,
  fetchCallLogs,
  fetchRegisteredUserEmails,
  registerPublicUser
} from "./firebase";
import { fetchGoogleContacts } from "./contacts";
import { enableIncomingCallNotifications } from "./notifications";
import { createTranslator, getBrowserLocale } from "./i18n";
import {
  fetchNativeContacts,
  openNativeBatterySettings,
  openNativeFullScreenIntentSettings,
  openNativeNotificationSettings
} from "./native";

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

const ANDROID_APK_URL = "https://github.com/celalarslan/Jusur/releases/download/android-release/Jusur-Android-Release.apk";
const CALL_RING_SECONDS = 45;

const QUICK_LANGUAGES = [
  { value: "auto", label: "Auto" },
  { value: "Turkish (Türkçe)", label: "Türkçe" },
  { value: "English", label: "English" },
  { value: "Arabic (العربية)", label: "Arabic" },
  { value: "Spanish (Español)", label: "Spanish" },
  { value: "French (Français)", label: "French" },
  { value: "German (Deutsch)", label: "German" }
];

type AppToast = {
  tone: "info" | "success" | "warning" | "error";
  message: string;
};

const getContactLibraryKey = (email: string) => `jusur_contact_library_${email.toLowerCase()}`;

const mergeContactLists = (...lists: Contact[][]) => {
  const byEmail = new Map<string, Contact>();
  lists.flat().forEach((contact) => {
    const email = contact.email.trim().toLowerCase();
    if (!email) return;
    const existing = byEmail.get(email);
    byEmail.set(email, {
      ...contact,
      ...existing,
      email,
      name: existing?.name || contact.name || email.split("@")[0],
      resourceName: existing?.resourceName || contact.resourceName || `contact-${email}`
    });
  });
  return Array.from(byEmail.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const getCallLogMeta = (log: CallLogDocument) => {
  if (log.status === "missed") {
    return {
      Icon: PhoneOff,
      label: "Missed",
      tone: "bg-rose-500/10 border-rose-300/20 text-rose-200"
    };
  }
  if (log.status === "secretary") {
    return {
      Icon: Voicemail,
      label: "Secretary",
      tone: "bg-violet-400/12 border-violet-300/25 text-violet-100"
    };
  }
  if (log.direction === "incoming") {
    return {
      Icon: PhoneIncoming,
      label: "Incoming",
      tone: "bg-cyan-300/10 border-cyan-300/20 text-cyan-100"
    };
  }
  return {
    Icon: PhoneOutgoing,
    label: "Outgoing",
    tone: "bg-emerald-300/10 border-emerald-300/20 text-emerald-100"
  };
};

export default function App() {
  const locale = getBrowserLocale();
  const t = createTranslator(locale);
  const isNativeApp = Capacitor.isNativePlatform();
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
  const [secretaryRepresentsName, setSecretaryRepresentsName] = useState("");
  const [secretaryLanguage, setSecretaryLanguage] = useState("Turkish");
  const [secretaryVoice, setSecretaryVoice] = useState<"Kore" | "Puck" | "Aoede" | "Fenrir">("Kore");
  const [secretaryInstructions, setSecretaryInstructions] = useState(
    "Arayanı kısa ve nazik karşıla. Kimin aradığını, telefon/e-posta bilgisini ve arama nedenini öğren. Acilse açıkça belirtmesini iste. Uygun bir dille mesajı ileteceğini söyle."
  );
  const [secretaryProfileStatus, setSecretaryProfileStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notificationStatus, setNotificationStatus] = useState<"idle" | "enabling" | "enabled" | "error">("idle");
  const [toast, setToast] = useState<AppToast | null>(null);

  // Phonebook contacts
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  // Voicemails state
  const [voicemails, setVoicemails] = useState<VoicemailDocument[]>([]);
  const [isLoadingVoicemails, setIsLoadingVoicemails] = useState(false);
  const [callLogs, setCallLogs] = useState<CallLogDocument[]>([]);
  const [isLoadingCallLogs, setIsLoadingCallLogs] = useState(false);
  const [registeredEmails, setRegisteredEmails] = useState<Set<string>>(new Set());
  const [permissionStatus, setPermissionStatus] = useState<"idle" | "requesting" | "ready" | "error">("idle");

  // Active Outgoing Call (Dialer) states
  const [dialState, setDialState] = useState<"idle" | "calling" | "secretary" | "active_call">("idle");
  const [outgoingCall, setOutgoingCall] = useState<CallDocument | null>(null);
  const [outgoingCallLogId, setOutgoingCallLogId] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [receiverEmail, setReceiverEmail] = useState("");

  // Active Incoming Call states
  const [incomingCall, setIncomingCall] = useState<CallDocument | null>(null);

  // Timers and Listeners Refs
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const singleCallUnsubscribeRef = useRef<(() => void) | null>(null);
  const incomingCallsUnsubscribeRef = useRef<(() => void) | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (message: string, tone: AppToast["tone"] = "info") => {
    setToast({ message, tone });
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (isNativeApp && authMode === "google") {
      setAuthMode("email");
    }
  }, [authMode, isNativeApp]);

  useEffect(() => {
    if (user && !secretaryRepresentsName.trim()) {
      setSecretaryRepresentsName(user.displayName || user.email?.split("@")[0] || "Jusur user");
    }
  }, [secretaryRepresentsName, user]);

  const getStoredContactLibrary = () => {
    if (!user?.email || typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(getContactLibraryKey(user.email));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Contact[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const saveStoredContactLibrary = (library: Contact[]) => {
    if (!user?.email || typeof localStorage === "undefined") return;
    localStorage.setItem(getContactLibraryKey(user.email), JSON.stringify(library));
  };

  useEffect(() => {
    if (user && isNativeApp && localStorage.getItem("jusur_media_permissions_checked") !== "1") {
      requestCallPermissions();
    }
  }, [isNativeApp, user]);

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
      registerPublicUser(user).catch((error) => console.warn("Public user registration failed:", error));
      loadGoogleContactsAndVoicemails(false);
      loadRegisteredUsersAndCallLogs();
      setupIncomingCallListener();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        enableIncomingCallNotifications()
          .then(() => setNotificationStatus("enabled"))
          .catch((error) => console.warn("Notification token refresh failed:", error));
      }
    } else {
      // Clear data if logged out
      setContacts([]);
      setCallLogs([]);
      setRegisteredEmails(new Set());
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
      const storedContacts = getStoredContactLibrary();
      if (isNativeApp) {
        const nativeContacts = await fetchNativeContacts();
        setContacts(markRegisteredContacts(mergeContactLists(storedContacts, nativeContacts)));
      } else if (!tokenForGoogleApis && allowGooglePrompt) {
        tokenForGoogleApis = await requestGoogleWorkspaceAccess();
        setAccessToken(tokenForGoogleApis);
      } else if (tokenForGoogleApis) {
        const contactList = await fetchGoogleContacts(tokenForGoogleApis);
        setContacts(markRegisteredContacts(mergeContactLists(storedContacts, contactList)));
      } else {
        setContacts(markRegisteredContacts(storedContacts));
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

  const markRegisteredContacts = (contactList: Contact[], registry = registeredEmails) =>
    contactList.map((contact) => ({
      ...contact,
      isRegistered: registry.has(contact.email.toLowerCase())
    }));

  const loadRegisteredUsersAndCallLogs = async () => {
    if (!user?.email) return;
    setIsLoadingCallLogs(true);
    try {
      const [registry, logs] = await Promise.all([
        fetchRegisteredUserEmails(),
        fetchCallLogs(user.email)
      ]);
      setRegisteredEmails(registry);
      setContacts((previous) => markRegisteredContacts(previous, registry));
      setCallLogs(logs);
    } catch (error) {
      console.error("Failed loading registered users or call logs:", error);
    } finally {
      setIsLoadingCallLogs(false);
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

  const handleDeleteVoicemail = async (voicemailId: string) => {
    const previousVoicemails = voicemails;
    setVoicemails((current) => current.filter((voicemail) => voicemail.id !== voicemailId));
    try {
      await deleteVoicemailDoc(voicemailId);
      showToast("Secretary message deleted.", "success");
    } catch (error) {
      console.error("Failed deleting voicemail:", error);
      setVoicemails(previousVoicemails);
      showToast("Could not delete the secretary message.", "error");
    }
  };

  const handleDeleteCallLog = async (logId: string) => {
    const previousCallLogs = callLogs;
    setCallLogs((current) => current.filter((log) => log.id !== logId));
    try {
      await deleteCallLogDoc(logId);
      showToast("Call history item deleted.", "success");
    } catch (error) {
      console.error("Failed deleting call log:", error);
      setCallLogs(previousCallLogs);
      showToast("Could not delete the call history item.", "error");
    }
  };

  const requestCallPermissions = async () => {
    setPermissionStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionStatus("ready");
      localStorage.setItem("jusur_media_permissions_checked", "1");
    } catch (error) {
      console.error("Media permission request failed:", error);
      setPermissionStatus("error");
      showToast("Camera/microphone permission is required for calls.", "warning");
    }
  };

  const openNativeSettings = async (type: "notifications" | "battery" | "fullscreen") => {
    try {
      if (type === "notifications") await openNativeNotificationSettings();
      if (type === "battery") await openNativeBatterySettings();
      if (type === "fullscreen") await openNativeFullScreenIntentSettings();
    } catch (error) {
      console.error("Native settings could not be opened:", error);
      showToast("Could not open Android settings automatically.", "warning");
    }
  };

  // 3. Authenticate Google Client
  const handleLogin = async () => {
    if (isNativeApp) {
      setAuthError("Cloud login is disabled in the Android APK for now. Use email sign in.");
      setAuthMode("email");
      return;
    }

    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setTokenAndLoad(result.accessToken, result.user);
      }
    } catch (e) {
      console.error("Google Auth SignIn Failure:", e);
      setAuthError("Cloud login is blocked by origin settings. Use email login for local testing.");
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
        setAuthError("Email login is not enabled yet for this app.");
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

  const handleEnableNotifications = async () => {
    setNotificationStatus("enabling");
    try {
      await enableIncomingCallNotifications();
      setNotificationStatus("enabled");
    } catch (error) {
      console.error("Notification registration failed:", error);
      setNotificationStatus("error");
      showToast(error instanceof Error ? error.message : "Could not enable notifications.", "error");
    }
  };

  const handleSaveSecretaryProfile = async () => {
    setSecretaryProfileStatus("saving");
    try {
      await saveSecretaryProfile({
        representsName: secretaryRepresentsName.trim() || user?.displayName || user?.email?.split("@")[0] || "Jusur user",
        responseLanguage: secretaryLanguage,
        voiceName: secretaryVoice,
        instructions: secretaryInstructions.trim()
      });
      setSecretaryProfileStatus("saved");
    } catch (error) {
      console.error("Secretary profile save failed:", error);
      setSecretaryProfileStatus("error");
      showToast(error instanceof Error ? error.message : "Could not save secretary profile.", "error");
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
      const callLogId = await createCallLogDoc({
        callerId: user.uid,
        callerName: user.displayName || user.email.split("@")[0],
        callerEmail: user.email,
        receiverEmail: contact.email,
        receiverName: contact.name,
        mode,
        direction: "outgoing",
        status: "ringing"
      });
      setOutgoingCallLogId(callLogId);

      const callDocId = await createCallDoc({
        callerId: user.uid,
        callerName: user.displayName || user.email.split("@")[0],
        callerEmail: user.email,
        receiverEmail: contact.email,
        meetUri: meetingUri,
        status: "ringing"
      });

      getCurrentIdToken().then((idToken) => fetch("/api/notify/incoming-call", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ callId: callDocId })
      })).catch((notifyError) => {
        console.warn("Incoming call push notification failed:", notifyError);
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
      subscribeToOutgoingCall(callDocId, meetingUri, contact.name, callLogId);

      // Set up 15-second timeout for AI Secretary activation
      setupSecretaryCallTimeout(callDocId, callLogId);

    } catch (err: any) {
      console.error("Calling origin step failure:", err);
      showToast(`Call failed: ${err.message || "Please check your account connection and try again."}`, "error");
      setDialState("idle");
    }
  };

  const subscribeToOutgoingCall = (callId: string, meetUri: string, targetName: string, callLogId?: string) => {
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
          if (callLogId) {
            updateCallLogDoc(callLogId, { status: "answered" }).catch((error) => console.warn("Call log update failed:", error));
          }
          
          setOutgoingCall(callDoc);
          setDialState("active_call");
        } else if (callDoc.status === "missed" || callDoc.status === "ended") {
          console.log("Call was declined or missed by the recipient.");
          if (callLogId) {
            updateCallLogDoc(callLogId, { status: callDoc.status }).catch((error) => console.warn("Call log update failed:", error));
          }
          handleCancelOutgoing();
          showToast(`${targetName} is busy or declined the call.`, "warning");
        }
      },
      (error) => {
        console.error("Single call listening error:", error);
      }
    );
  };

  // 15 seconds timer to switch calling to AI Secretary
  const setupSecretaryCallTimeout = (callId: string, callLogId?: string) => {
    clearSecretaryTimeout();
    timeoutRef.current = setTimeout(async () => {
      console.log("No answer in 15 seconds. Upgrading call status to AI Secretary...");
      try {
        await updateCallDoc(callId, { status: "ai_secretary_active" });
        if (callLogId) {
          await updateCallLogDoc(callLogId, { status: "secretary" });
        }
        setDialState("secretary");
      } catch (e) {
        console.error("Error activating secretary state in firestore:", e);
        setDialState("secretary");
      }
    }, CALL_RING_SECONDS * 1000);
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
        if (outgoingCallLogId) {
          await updateCallLogDoc(outgoingCallLogId, { status: "ended" });
        }
        await deleteCallDoc(outgoingCall.id);
      } catch (e) {
        console.error("Cleanup call failure:", e);
      }
    }

    setDialState("idle");
    setOutgoingCall(null);
    setOutgoingCallLogId(null);
    loadRegisteredUsersAndCallLogs();
  };

  // 6. Handle Incoming Call state selections (Receiver flow)
  const handleAcceptIncoming = async () => {
    if (!incomingCall) return;
    const callId = incomingCall.id;
    try {
      console.log("Accepting incoming call, updating Firestore...");
      await updateCallDoc(callId, { status: "answered" });
      await createCallLogDoc({
        callerId: incomingCall.callerId,
        callerName: incomingCall.callerName,
        callerEmail: incomingCall.callerEmail,
        receiverEmail: incomingCall.receiverEmail,
        receiverName: user?.displayName || user?.email?.split("@")[0] || "Jusur user",
        mode: callMode,
        direction: "incoming",
        status: "answered"
      });
      
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
      await createCallLogDoc({
        callerId: incomingCall.callerId,
        callerName: incomingCall.callerName,
        callerEmail: incomingCall.callerEmail,
        receiverEmail: incomingCall.receiverEmail,
        receiverName: user?.displayName || user?.email?.split("@")[0] || "Jusur user",
        mode: callMode,
        direction: "incoming",
        status: "missed"
      });
      setIncomingCall(null);
    } catch (e) {
      console.error("Decline call error:", e);
    }
  };

  // Clear session after finishing secretary voicemail recording
  const handleFinishSecretary = () => {
    if (outgoingCallLogId && dialState === "active_call") {
      updateCallLogDoc(outgoingCallLogId, { status: "ended" }).catch((error) => console.warn("Call log finish update failed:", error));
    }
    setDialState("idle");
    setOutgoingCall(null);
    setOutgoingCallLogId(null);
    reloadVoicemails(); // Refresh local list to render newly left voicemail!
    loadRegisteredUsersAndCallLogs();
  };

  const handleKeypadPress = (val: string) => {
    setManualDialInput((prev) => prev + val);
  };

  const handleManualDialCall = (mode: "audio" | "video" = "video") => {
    const input = manualDialInput.trim();
    if (!input) return;
    const isEmail = input.includes("@");
    if (isEmail && registeredEmails.size > 0 && !registeredEmails.has(input.toLowerCase())) {
      showToast("This email is not registered on Jusur yet.", "warning");
      return;
    }
    const manualContact: Contact = {
      name: isEmail ? input.split("@")[0] : `Special Dial`,
      email: isEmail ? input : `${input}@manual-connect.com`,
      resourceName: `keypad-dial-${Date.now()}`,
      isRegistered: isEmail ? registeredEmails.has(input.toLowerCase()) : false
    };
    handleInitiateCall(manualContact, mode);
  };

  const handleSaveManualContact = () => {
    const email = manualDialInput.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      showToast("Enter an email address to add a contact.", "warning");
      return;
    }

    const nextContact: Contact = {
      name: email.split("@")[0],
      email,
      resourceName: `manual-contact-${email}`,
      isRegistered: registeredEmails.has(email)
    };
    const nextStoredLibrary = mergeContactLists(getStoredContactLibrary(), [nextContact]);
    saveStoredContactLibrary(nextStoredLibrary);
    setContacts((previous) => markRegisteredContacts(mergeContactLists(previous, nextStoredLibrary)));
    setSearchQuery("");
    showToast("Contact added to your library.", "success");
  };

  // Filter contacts by search query
  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const visibleContacts = activePanel === "home" ? filteredContacts.slice(0, 8) : filteredContacts;
  const visibleCallLogs = activePanel === "home" ? callLogs.slice(0, 4) : [];

  // App loading spinner
  if (appLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-100 font-sans">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin mb-3.5" />
        <p className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase">Initializing Operator Line...</p>
      </div>
    );
  }

  // A: Standard Authentication Screen
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

          <div className={`grid ${isNativeApp ? "grid-cols-1" : "grid-cols-2"} gap-2 mb-4 rounded-2xl bg-black/40 border border-white/10 p-1`}>
            <button
              type="button"
              onClick={() => setAuthMode("email")}
              className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${authMode === "email" ? "bg-cyan-400 text-slate-950" : "text-zinc-400 hover:text-white"}`}
            >
              Email
            </button>
            {!isNativeApp && (
              <button
                type="button"
                onClick={() => setAuthMode("google")}
                className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${authMode === "google" ? "bg-cyan-400 text-slate-950" : "text-zinc-400 hover:text-white"}`}
              >
                Cloud
              </button>
            )}
          </div>

          {isNativeApp && (
            <p className="mb-4 text-[11px] leading-relaxed text-cyan-100 bg-cyan-400/10 border border-cyan-300/15 rounded-2xl p-3">
              Android app uses email accounts. Cloud sign-in will be added later.
            </p>
          )}

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
                  ? "Choose any password with at least 6 characters. This creates your Jusur account."
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
                <UserIcon className="w-4 h-4 shrink-0" />
              )}
              <span>Connect cloud account</span>
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
              {!isNativeApp && (
                <a
                  href={ANDROID_APK_URL}
                  className="h-10 w-10 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-100 flex items-center justify-center active:scale-95 transition"
                  title="Download Android APK"
                  aria-label="Download Android APK"
                >
                  <Download className="w-4 h-4" />
                </a>
              )}
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
                      onChange={(e) => {
                        setManualDialInput(e.target.value);
                        setSearchQuery(e.target.value);
                      }}
                      placeholder={t("contactInput")}
                      className="w-full h-14 rounded-2xl border border-white/10 bg-slate-950/80 pl-11 pr-14 text-[15px] font-bold text-white placeholder:text-slate-600 outline-none focus:border-cyan-300/40"
                    />
                    <button
                      type="button"
                      onClick={handleSaveManualContact}
                      disabled={!manualDialInput.includes("@")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl border border-cyan-300/15 bg-cyan-300/10 text-cyan-100 flex items-center justify-center disabled:opacity-35 active:scale-95 transition"
                      title="Add contact"
                      aria-label="Add contact"
                    >
                      <UserPlus className="w-4 h-4" />
                    </button>
                  </div>

                  {activePanel === "home" && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <button
                        type="button"
                        onClick={() => handleManualDialCall("audio")}
                        disabled={!manualDialInput.trim()}
                        className="h-16 rounded-2xl bg-gradient-to-br from-emerald-300 to-cyan-300 text-slate-950 font-black flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[0.98] transition shadow-[0_0_28px_rgba(45,212,191,0.22)]"
                      >
                        <Phone className="w-5 h-5" />
                        <span>{t("audio")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualDialCall("video")}
                        disabled={!manualDialInput.trim()}
                        className="h-16 rounded-2xl bg-gradient-to-br from-fuchsia-400 to-blue-400 text-white font-black flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[0.98] transition shadow-[0_0_28px_rgba(96,165,250,0.24)]"
                      >
                        <Video className="w-5 h-5" />
                        <span>{t("video")}</span>
                      </button>
                    </div>
                  )}
                </div>

                {activePanel === "home" && (
                <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-cyan-300/10 bg-white/[0.04] p-3">
                    <Languages className="w-4 h-4 text-cyan-200 mb-2" />
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">{t("yourLanguage")}</label>
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
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">{t("translateTo")}</label>
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
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">{t("voice")}</label>
                    <select
                      value={preferredVoice}
                      onChange={(e) => setPreferredVoice(e.target.value as "Aoede" | "Fenrir")}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    >
                      <option value="Aoede">{t("female")}</option>
                      <option value="Fenrir">{t("male")}</option>
                    </select>
                  </div>
                </div>

                </>
                )}

                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-black tracking-tight">{activePanel === "contacts" ? "Contacts" : "Signal List"}</h2>
                    <p className="text-[11px] text-slate-500 font-semibold">
                      {activePanel === "home" ? `${visibleCallLogs.length} recent · ${filteredContacts.length} contacts` : `${filteredContacts.length} ${t("readyContacts")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadGoogleContactsAndVoicemails(true)}
                    className="h-9 px-3 rounded-full border border-cyan-300/15 bg-cyan-300/10 text-cyan-100 text-[11px] font-black active:scale-95 transition"
                  >
                    {t("sync")}
                  </button>
                </div>

                <div className="space-y-2">
                  {isLoadingContacts || (activePanel === "home" && isLoadingCallLogs) ? (
                    <div className="h-40 flex items-center justify-center text-cyan-200">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : filteredContacts.length === 0 && visibleCallLogs.length === 0 ? (
                    <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-7 text-center">
                      <PhoneCall className="w-8 h-8 text-cyan-200/60 mx-auto mb-3" />
                      <p className="text-sm font-black">{t("noContacts")}</p>
                      <p className="text-xs text-slate-500 mt-1">{t("noContactsHint")}</p>
                    </div>
                  ) : (
                    <>
                    {visibleCallLogs.map((log) => {
                      const otherName = log.direction === "incoming" ? log.callerName : (log.receiverName || log.receiverEmail);
                      const otherEmail = log.direction === "incoming" ? log.callerEmail : log.receiverEmail;
                      const formattedDate = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : "";
                      const callMeta = getCallLogMeta(log);
                      const CallIcon = callMeta.Icon;
                      const callContact: Contact = {
                        name: otherName,
                        email: otherEmail,
                        resourceName: `call-log-contact-${log.id}`,
                        isRegistered: registeredEmails.has(otherEmail.toLowerCase())
                      };
                      return (
                        <div key={`log-${log.id}`} className="rounded-[18px] border border-white/8 bg-slate-950/55 px-3 py-2 flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${callMeta.tone}`}>
                            <CallIcon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-black truncate">{otherName}</h3>
                            <p className="text-[10px] text-slate-500 truncate">{callMeta.label} · {log.mode} · {formattedDate.split(",")[0]}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleInitiateCall(callContact, log.mode)}
                            disabled={!callContact.isRegistered}
                            className="h-9 w-9 rounded-2xl bg-emerald-300 text-slate-950 flex items-center justify-center active:scale-95 transition disabled:opacity-35"
                            title="Call back"
                          >
                            <Phone className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                    {visibleContacts.map((contact) => (
                      <div
                        key={contact.resourceName}
                        className={`rounded-[18px] border px-3 py-2.5 flex items-center gap-3 transition ${
                          contact.isRegistered
                            ? "border-cyan-300/20 bg-white/[0.07]"
                            : "border-white/5 bg-white/[0.025] opacity-55 grayscale"
                        }`}
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
                          <p className="text-[11px] text-slate-500 truncate">
                            {contact.email} {contact.isRegistered ? "· Jusur" : "· not joined"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleInitiateCall(contact, "audio")}
                          disabled={!contact.isRegistered}
                          className="h-10 w-10 rounded-2xl bg-emerald-300 text-slate-950 flex items-center justify-center active:scale-95 transition"
                          title="Audio call"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateCall(contact, "video")}
                          disabled={!contact.isRegistered}
                          className="h-10 w-10 rounded-2xl bg-blue-400 text-white flex items-center justify-center active:scale-95 transition"
                          title="Video call"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    </>
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
                    <h2 className="text-xl font-black tracking-tight">{t("settings")}</h2>
                    <p className="text-xs text-slate-500">{t("settingsHint")}</p>
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

                {!isNativeApp && (
                  <a
                    href={ANDROID_APK_URL}
                    className="rounded-[26px] border border-emerald-300/20 bg-emerald-300/10 p-4 flex items-center justify-between gap-3 active:scale-[0.99] transition"
                  >
                    <div className="min-w-0">
                      <p className="font-black text-emerald-100">Android APK</p>
                      <p className="text-xs text-emerald-100/60 truncate">Jusur-Android.apk</p>
                    </div>
                    <Download className="w-5 h-5 text-emerald-100 shrink-0" />
                  </a>
                )}

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-cyan-100 font-black text-sm">
                    <SlidersHorizontal className="w-4 h-4" />
                    {t("callDefaults")}
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
                    <button type="button" onClick={() => setPreferredVoice("Aoede")} className={`h-12 rounded-2xl border text-xs font-black ${preferredVoice === "Aoede" ? "bg-cyan-300 text-slate-950 border-cyan-300" : "bg-slate-950 border-white/10 text-slate-300"}`}>{t("female")}</button>
                    <button type="button" onClick={() => setPreferredVoice("Fenrir")} className={`h-12 rounded-2xl border text-xs font-black ${preferredVoice === "Fenrir" ? "bg-violet-300 text-slate-950 border-violet-300" : "bg-slate-950 border-white/10 text-slate-300"}`}>{t("male")}</button>
                  </div>
                </div>

                <div className="rounded-[26px] border border-cyan-300/15 bg-cyan-300/[0.045] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-cyan-100 font-black text-sm">
                    <Video className="w-4 h-4" />
                    Camera & microphone
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    Android asks once at runtime. Allow both permissions here before the first real call.
                  </p>
                  <button
                    type="button"
                    onClick={requestCallPermissions}
                    disabled={permissionStatus === "requesting" || permissionStatus === "ready"}
                    className="w-full h-12 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {permissionStatus === "requesting" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    {permissionStatus === "ready" ? "Camera and mic ready" : "Allow camera and mic"}
                  </button>
                  {isNativeApp && (
                    <div className="grid grid-cols-3 gap-2">
                      <button type="button" onClick={() => openNativeSettings("notifications")} className="h-10 rounded-2xl border border-white/10 bg-slate-950 text-[10px] font-black text-slate-300">Alerts</button>
                      <button type="button" onClick={() => openNativeSettings("fullscreen")} className="h-10 rounded-2xl border border-white/10 bg-slate-950 text-[10px] font-black text-slate-300">Full screen</button>
                      <button type="button" onClick={() => openNativeSettings("battery")} className="h-10 rounded-2xl border border-white/10 bg-slate-950 text-[10px] font-black text-slate-300">Battery</button>
                    </div>
                  )}
                </div>

                <div className="rounded-[26px] border border-violet-300/15 bg-violet-300/[0.055] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-violet-100 font-black text-sm">
                    <Voicemail className="w-4 h-4" />
                    AI Secretary behavior
                  </div>
                  <input
                    value={secretaryRepresentsName}
                    onChange={(event) => setSecretaryRepresentsName(event.target.value)}
                    placeholder="Who does the secretary represent?"
                    className="w-full h-12 rounded-2xl bg-slate-950 border border-white/10 px-3 text-xs font-bold outline-none focus:border-violet-300/40"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={secretaryLanguage}
                      onChange={(event) => setSecretaryLanguage(event.target.value)}
                      className="h-12 rounded-2xl bg-slate-950 border border-white/10 px-3 text-xs font-bold outline-none"
                    >
                      <option value="Turkish">Türkçe</option>
                      <option value="English">English</option>
                      <option value="Arabic">Arabic</option>
                      <option value="French">French</option>
                      <option value="German">German</option>
                    </select>
                    <select
                      value={secretaryVoice}
                      onChange={(event) => setSecretaryVoice(event.target.value as "Kore" | "Puck" | "Aoede" | "Fenrir")}
                      className="h-12 rounded-2xl bg-slate-950 border border-white/10 px-3 text-xs font-bold outline-none"
                    >
                      <option value="Kore">Natural female</option>
                      <option value="Puck">Natural male</option>
                      <option value="Aoede">Bright female</option>
                      <option value="Fenrir">Deep male</option>
                    </select>
                  </div>
                  <textarea
                    value={secretaryInstructions}
                    onChange={(event) => setSecretaryInstructions(event.target.value)}
                    rows={5}
                    placeholder="How should the AI secretary behave, what should it say, what should it collect?"
                    className="w-full rounded-2xl bg-slate-950 border border-white/10 px-3 py-3 text-xs font-semibold leading-relaxed outline-none resize-none focus:border-violet-300/40"
                  />
                  <button
                    type="button"
                    onClick={handleSaveSecretaryProfile}
                    disabled={secretaryProfileStatus === "saving"}
                    className="w-full h-12 rounded-2xl bg-violet-300 text-slate-950 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {secretaryProfileStatus === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {secretaryProfileStatus === "saved" ? "Secretary saved" : "Save AI secretary"}
                  </button>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-cyan-100 font-black text-sm">
                      <History className="w-4 h-4" />
                      Call history
                    </div>
                    <button type="button" onClick={loadRegisteredUsersAndCallLogs} className="text-[11px] font-black text-cyan-200">Refresh</button>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {isLoadingCallLogs ? (
                      <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-cyan-200" /></div>
                    ) : callLogs.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-slate-950 p-4 text-xs text-slate-500 font-semibold text-center">No calls yet</div>
                    ) : (
                      callLogs.map((log) => {
                        const otherName = log.direction === "incoming" ? log.callerName : (log.receiverName || log.receiverEmail);
                        const formattedDate = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : "";
                        const callMeta = getCallLogMeta(log);
                        const CallIcon = callMeta.Icon;
                        return (
                          <div key={log.id} className="rounded-2xl border border-white/10 bg-slate-950 p-3 flex items-center justify-between gap-3">
                            <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 border ${callMeta.tone}`}>
                              <CallIcon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-black truncate">{otherName}</p>
                              <p className="text-[10px] text-slate-500 truncate">{callMeta.label} · {log.mode} · {log.status}</p>
                            </div>
                            <span className="text-[9px] text-slate-600 shrink-0">{formattedDate.split(",")[0]}</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteCallLog(log.id)}
                              className="h-8 w-8 rounded-xl border border-rose-400/15 bg-rose-500/5 text-rose-200 flex items-center justify-center active:scale-95 transition"
                              title="Delete call history item"
                              aria-label="Delete call history item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-violet-100 font-black text-sm">
                      <Voicemail className="w-4 h-4" />
                      {t("secretaryInbox")}
                    </div>
                    <button type="button" onClick={reloadVoicemails} className="text-[11px] font-black text-cyan-200">Refresh</button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {isLoadingVoicemails ? (
                      <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-violet-200" /></div>
                    ) : (
                      <VoicemailsList voicemails={voicemails} onDelete={handleDeleteVoicemail} />
                    )}
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-100 font-black text-sm">
                    <ShieldCheck className="w-4 h-4" />
                    {t("serviceStatus")}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-400">
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Account sync: ready</span>
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Secure data: ready</span>
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Live voice: ready</span>
                    <span className="rounded-2xl bg-slate-950 border border-white/10 p-3">Call bridge: ready</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  disabled={notificationStatus === "enabling" || notificationStatus === "enabled"}
                  className="w-full h-13 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 font-black flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {notificationStatus === "enabling" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                  {notificationStatus === "enabled" ? t("callAlertsEnabled") : t("enableCallAlerts")}
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full h-13 rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200 font-black flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  {t("signOut")}
                </button>
              </div>
            )}

            {dialState === "calling" && (
              <DialerOverlay receiverName={receiverName} receiverEmail={receiverEmail} status={outgoingCall?.status || "ringing"} onCancel={handleCancelOutgoing} timeoutSeconds={CALL_RING_SECONDS} />
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
        {toast && (
          <motion.div
            key="app-toast"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            className={`fixed left-4 right-4 bottom-24 z-[120] mx-auto max-w-[390px] rounded-2xl border px-4 py-3 text-xs font-bold shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl ${
              toast.tone === "success"
                ? "border-emerald-300/25 bg-emerald-300/15 text-emerald-100"
                : toast.tone === "warning"
                  ? "border-amber-300/25 bg-amber-300/15 text-amber-100"
                  : toast.tone === "error"
                    ? "border-rose-300/25 bg-rose-500/15 text-rose-100"
                    : "border-cyan-300/25 bg-cyan-300/15 text-cyan-100"
            }`}
          >
            {toast.message}
          </motion.div>
        )}
        {incomingCall && (
          <IncomingOverlay incomingCall={incomingCall} onAccept={handleAcceptIncoming} onDecline={handleDeclineIncoming} />
        )}
      </AnimatePresence>
    </div>
  );
}
