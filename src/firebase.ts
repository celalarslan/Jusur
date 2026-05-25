import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  addDoc,
  getDoc,
  getDocs,
  onSnapshot, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import { CallDocument, CallLogDocument, SecretaryProfile, VoicemailDocument } from "./types";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// If firebaseConfig contains firestoreDatabaseId, use it; otherwise default is standard
export const db = getFirestore(app);
export const auth = getAuth(app);

const GOOGLE_OAUTH_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
  (firebaseConfig as { googleOAuthClientId?: string }).googleOAuthClientId ||
  "";
const GOOGLE_SIGN_IN_SCOPES = [
  "openid",
  "email",
  "profile"
].join(" ");
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/meetings.space.created"
].join(" ");

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

// Variables for managing the access token in memory safely
let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Error Handling Requirements from firebase-integration skill
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error Detailed Details:", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Authentication Helpers
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const emailPasswordSignIn = async (
  email: string,
  password: string,
  displayName?: string,
  mode: "signin" | "signup" = "signin"
): Promise<{ user: User; accessToken: null }> => {
  try {
    isSigningIn = true;
    cachedAccessToken = null;
    let credential;
    if (mode === "signup") {
      credential = await createUserWithEmailAndPassword(auth, email, password);
    } else {
      credential = await signInWithEmailAndPassword(auth, email, password);
    }

    if (displayName && credential.user.displayName !== displayName) {
      await updateProfile(credential.user, { displayName });
    }

    return { user: credential.user, accessToken: null };
  } finally {
    isSigningIn = false;
  }
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;

    await ensureGoogleIdentityServices();
    const accessToken = await requestGoogleAccessToken(GOOGLE_SIGN_IN_SCOPES);
    const credential = GoogleAuthProvider.credential(null, accessToken);
    const result = await signInWithCredential(auth, credential);
    if (!result.user) {
      throw new Error("Google sign-in completed without a Firebase user.");
    }
    cachedAccessToken = accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Google OAuth SignIn Error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const requestGoogleWorkspaceAccess = async (): Promise<string> => {
  await ensureGoogleIdentityServices();
  const accessToken = await requestGoogleAccessToken(GOOGLE_WORKSPACE_SCOPES);
  cachedAccessToken = accessToken;
  return accessToken;
};

function ensureGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-google-identity-services]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Identity Services script failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentityServices = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services script failed to load."));
    document.head.appendChild(script);
  });
}

function requestGoogleAccessToken(scope: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_OAUTH_CLIENT_ID) {
      reject(new Error("Google OAuth client ID is missing. Set VITE_GOOGLE_OAUTH_CLIENT_ID after creating a Web OAuth client in Google Cloud."));
      return;
    }

    const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope,
      prompt: "consent",
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (!response.access_token) {
          reject(new Error("Google did not return an access token."));
          return;
        }
        resolve(response.access_token);
      }
    });

    if (!tokenClient) {
      reject(new Error("Google Identity Services is unavailable."));
      return;
    }

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export const saveNotificationToken = async (token: string, platform: "web" | "android" = "web"): Promise<void> => {
  const currentUser = auth.currentUser;
  if (!currentUser?.email) {
    throw new Error("Cannot register notifications before signing in.");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenId = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  await setDoc(doc(db, "notificationTokens", tokenId), {
    token,
    platform,
    ownerEmail: currentUser.email,
    userId: currentUser.uid,
    updatedAt: Timestamp.now()
  }, { merge: true });
};

export const registerPublicUser = async (currentUser: User): Promise<void> => {
  if (!currentUser.email) return;

  await setDoc(doc(db, "publicUsers", currentUser.email), {
    email: currentUser.email,
    displayName: currentUser.displayName || currentUser.email.split("@")[0],
    photoURL: currentUser.photoURL || "",
    uid: currentUser.uid,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

export const fetchRegisteredUserEmails = async (): Promise<Set<string>> => {
  try {
    const snap = await getDocs(collection(db, "publicUsers"));
    return new Set(snap.docs.map((docSnap) => String(docSnap.data().email || docSnap.id).toLowerCase()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, "publicUsers");
    return new Set();
  }
};

const profileDocIdFromEmail = (email: string) => email.trim();

export const saveSecretaryProfile = async (profile: Omit<SecretaryProfile, "ownerEmail">): Promise<void> => {
  const currentUser = auth.currentUser;
  if (!currentUser?.email) {
    throw new Error("Cannot save secretary profile before signing in.");
  }

  const ownerEmail = currentUser.email;
  await setDoc(doc(db, "secretaryProfiles", profileDocIdFromEmail(ownerEmail)), {
    ...profile,
    ownerEmail,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

export const fetchSecretaryProfile = async (ownerEmail: string): Promise<SecretaryProfile | null> => {
  const normalizedEmail = profileDocIdFromEmail(ownerEmail);
  if (!normalizedEmail) return null;

  try {
    const docSnap = await getDoc(doc(db, "secretaryProfiles", normalizedEmail));
    if (!docSnap.exists()) return null;
    return docSnap.data() as SecretaryProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `secretaryProfiles/${normalizedEmail}`);
    return null;
  }
};

// Firestore Methods with Mandatory handleFirestoreError Wrapping

// Create a new signaling Call document
export const createCallDoc = async (callData: Omit<CallDocument, "id" | "timestamp">): Promise<string> => {
  const pathOfCol = "calls";
  try {
    const docRef = await addDoc(collection(db, pathOfCol), {
      ...callData,
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathOfCol);
    return "";
  }
};

export const createCallLogDoc = async (logData: Omit<CallLogDocument, "id" | "timestamp">): Promise<string> => {
  const pathOfCol = "callLogs";
  try {
    const docRef = await addDoc(collection(db, pathOfCol), {
      ...logData,
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathOfCol);
    return "";
  }
};

export const updateCallLogDoc = async (logId: string, updates: Partial<Omit<CallLogDocument, "id" | "timestamp">>): Promise<void> => {
  const pathOfDoc = `callLogs/${logId}`;
  try {
    await updateDoc(doc(db, "callLogs", logId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, pathOfDoc);
  }
};

export const fetchCallLogs = async (email: string): Promise<CallLogDocument[]> => {
  const pathOfCol = "callLogs";
  try {
    const outgoingQ = query(
      collection(db, "callLogs"),
      where("callerEmail", "==", email),
      orderBy("timestamp", "desc")
    );
    const incomingQ = query(
      collection(db, "callLogs"),
      where("receiverEmail", "==", email),
      orderBy("timestamp", "desc")
    );
    const [outgoingSnap, incomingSnap] = await Promise.all([getDocs(outgoingQ), getDocs(incomingQ)]);
    const byId = new Map<string, CallLogDocument>();
    outgoingSnap.forEach((docSnap) => byId.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), direction: "outgoing" } as CallLogDocument));
    incomingSnap.forEach((docSnap) => byId.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), direction: "incoming" } as CallLogDocument));
    return Array.from(byId.values()).sort((a, b) => {
      const aTime = a.timestamp?.toMillis?.() || 0;
      const bTime = b.timestamp?.toMillis?.() || 0;
      return bTime - aTime;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, pathOfCol);
    return [];
  }
};

// Update an existing Call document
export const updateCallDoc = async (callId: string, updates: Partial<Omit<CallDocument, "id" | "timestamp">>): Promise<void> => {
  const pathOfDoc = `calls/${callId}`;
  try {
    const docRef = doc(db, "calls", callId);
    await updateDoc(docRef, updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, pathOfDoc);
  }
};

// Listen to calls where current user is receiver
export const listenIncomingCalls = (receiverEmail: string, onUpdate: (calls: CallDocument[]) => void, onError: (err: any) => void) => {
  const pathForQuery = "calls";
  const q = query(
    collection(db, "calls"),
    where("receiverEmail", "==", receiverEmail),
    where("status", "==", "ringing")
  );

  return onSnapshot(q, (snapshot) => {
    const list: CallDocument[] = [];
    snapshot.forEach((docSnap) => {
      list.push({ id: docSnap.id, ...docSnap.data() } as CallDocument);
    });
    onUpdate(list);
  }, (error) => {
    try {
      handleFirestoreError(error, OperationType.GET, pathForQuery);
    } catch (e) {
      onError(e);
    }
  });
};

// Listen to a single call's updates (for the caller side)
export const listenSingleCall = (callId: string, onUpdate: (call: CallDocument | null) => void, onError: (err: any) => void) => {
  const pathForDoc = `calls/${callId}`;
  const docRef = doc(db, "calls", callId);

  return onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      onUpdate({ id: docSnap.id, ...docSnap.data() } as CallDocument);
    } else {
      onUpdate(null);
    }
  }, (error) => {
    try {
      handleFirestoreError(error, OperationType.GET, pathForDoc);
    } catch (e) {
      onError(e);
    }
  });
};

// Delete a call doc
export const deleteCallDoc = async (callId: string): Promise<void> => {
  const pathOfDoc = `calls/${callId}`;
  try {
    await deleteDoc(doc(db, "calls", callId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, pathOfDoc);
  }
};

// Create a Voicemail entry
export const createVoicemailDoc = async (voicemailData: Omit<VoicemailDocument, "id" | "timestamp">): Promise<string> => {
  const pathOfCol = "voicemails";
  try {
    const docRef = await addDoc(collection(db, pathOfCol), {
      ...voicemailData,
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathOfCol);
    return "";
  }
};

// Fetch voicemails for receiver
export const fetchVoicemails = async (receiverEmail: string): Promise<VoicemailDocument[]> => {
  const pathOfCol = "voicemails";
  try {
    const q = query(
      collection(db, "voicemails"),
      where("receiverEmail", "==", receiverEmail),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    const voicemails: VoicemailDocument[] = [];
    snap.forEach((docDoc) => {
      voicemails.push({ id: docDoc.id, ...docDoc.data() } as VoicemailDocument);
    });
    return voicemails;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, pathOfCol);
    return [];
  }
};
