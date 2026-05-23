import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut 
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
  serverTimestamp
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import { CallDocument, VoicemailDocument } from "./types";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// If firebaseConfig contains firestoreDatabaseId, use it; otherwise default is standard
export const db = getFirestore(app);
export const auth = getAuth(app);

// Authentication scopes required
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/contacts.readonly");
provider.addScope("https://www.googleapis.com/auth/meetings.space.created");
provider.addScope("https://www.googleapis.com/auth/userinfo.profile");
provider.addScope("https://www.googleapis.com/auth/userinfo.email");

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
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Try to check if token exists or clear it. 
        // Note: Firebase Auth tokens don't persist bearer tokens, 
        // so if there's no cached token, user must sign in.
        // We can let the user click sign in to refresh the access token.
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to extract OAuth accessor token from registration credentials.");
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Google OAuth SignIn Error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
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
