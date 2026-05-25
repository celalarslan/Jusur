export interface Contact {
  resourceName: string;
  name: string;
  email: string;
  photoUrl?: string;
}

export interface CallDocument {
  id: string;
  callerId: string;
  callerName: string;
  callerEmail: string;
  receiverEmail: string;
  meetUri: string;
  status: "ringing" | "answered" | "missed" | "ai_secretary_active" | "ended";
  timestamp: any; // Firestore serverTimestamp
  callerSignal?: string;
  receiverSignal?: string;
}

export interface VoicemailDocument {
  id: string;
  callerId: string;
  callerName: string;
  callerEmail: string;
  receiverEmail: string;
  audioTranscript: string;
  aiSummary: string;
  secretaryProfile?: SecretaryProfile;
  timestamp: any;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface SecretaryProfile {
  ownerEmail: string;
  representsName: string;
  responseLanguage: string;
  voiceName: "Kore" | "Puck" | "Aoede" | "Fenrir";
  instructions: string;
}
