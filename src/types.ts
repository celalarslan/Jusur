export interface Contact {
  resourceName: string;
  name: string;
  email: string;
  photoUrl?: string;
  isRegistered?: boolean;
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
  conferenceId?: string;
  participants?: string[];
  invitedParticipants?: string[];
  messages?: CallMessage[];
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

export interface CallMessage {
  id: string;
  senderEmail: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface CallLogDocument {
  id: string;
  callerId: string;
  callerName: string;
  callerEmail: string;
  receiverEmail: string;
  receiverName?: string;
  mode: "audio" | "video";
  direction?: "outgoing" | "incoming";
  status: "ringing" | "answered" | "missed" | "ended" | "secretary";
  timestamp: any;
  endedAt?: any;
}

export interface SecretaryProfile {
  ownerEmail: string;
  representsName: string;
  responseLanguage: string;
  voiceName: "Kore" | "Puck" | "Aoede" | "Fenrir";
  instructions: string;
}
