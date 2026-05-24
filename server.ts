import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { initializeApp as initializeAdminApp, getApps } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getMessaging as getAdminMessaging } from "firebase-admin/messaging";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Increase limit to handle base64 audio uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy initialiser for Gemini to prevent startup crashes if key is missing
let aiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return aiClient;
}

function getFirebaseAdmin() {
  if (!getApps().length) {
    initializeAdminApp();
  }
  return {
    db: getAdminFirestore(),
    messaging: getAdminMessaging()
  };
}

// 1. Google Meet space creation proxy
app.post("/api/meet/create-space", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header with Google Access Token" });
  }

  try {
    const meetRes = await fetch("https://meet.googleapis.com/v2/spaces", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        config: {
          accessType: "OPEN"
        }
      })
    });

    if (!meetRes.ok) {
      const errorData = await meetRes.json().catch(() => ({}));
      console.error("Google Meet API failure:", errorData);
      return res.status(meetRes.status).json({
        error: "Failed to create Google Meet space",
        details: errorData
      });
    }

    const data = await meetRes.json();
    return res.json({ meetingUri: data.meetingUri || `https://meet.google.com/${data.name}` });
  } catch (error) {
    console.error("Error creating Google Meet Space:", error);
    return res.status(500).json({ error: "Internal server error creating Google Meet space" });
  }
});

app.post("/api/notify/incoming-call", async (req, res) => {
  const { callId } = req.body || {};
  if (!callId) {
    return res.status(400).json({ error: "callId is required" });
  }

  try {
    const { db, messaging } = getFirebaseAdmin();
    const callSnap = await db.collection("calls").doc(String(callId)).get();
    if (!callSnap.exists) {
      return res.status(404).json({ error: "Call not found" });
    }

    const call = callSnap.data() || {};
    const receiverEmail = call.receiverEmail;
    if (!receiverEmail) {
      return res.status(400).json({ error: "Call is missing receiverEmail" });
    }

    const tokenSnap = await db
      .collection("notificationTokens")
      .where("ownerEmail", "==", receiverEmail)
      .get();

    const tokens = tokenSnap.docs
      .map((docSnap) => docSnap.data().token)
      .filter((token): token is string => typeof token === "string" && token.length > 0);

    if (tokens.length === 0) {
      console.log("Incoming call notification skipped: no registered token for", receiverEmail);
      return res.json({ sent: 0, reason: "No notification tokens registered for receiver." });
    }

    const origin = req.headers.origin || process.env.APP_URL || "https://j-call-734750832655.europe-west1.run.app";
    const callerName = call.callerName || call.callerEmail || "Jusur caller";
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: "Incoming Jusur call",
        body: `${callerName} is calling you`
      },
      data: {
        callId: String(callId),
        url: `${origin}/`
      },
      webpush: {
        fcmOptions: {
          link: `${origin}/`
        }
      }
    });

    console.log("Incoming call notification result:", {
      receiverEmail,
      tokenCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors: response.responses
        .filter((item) => !item.success)
        .map((item) => item.error?.message)
    });

    return res.json({
      sent: response.successCount,
      failed: response.failureCount
    });
  } catch (error: any) {
    console.error("Incoming call notification failed:", error);
    return res.status(500).json({ error: error.message || "Failed to send incoming call notification" });
  }
});

// 2. AI Secretary audio/text agent processor
app.post("/api/secretary/respond", async (req, res) => {
  const { callerAudio, callerText, receiverName, history } = req.body;
  
  if (!receiverName) {
    return res.status(400).json({ error: "receiverName is required" });
  }

  try {
    const ai = getGemini();
    
    // Prepare parts for the prompt contents
    const promptParts: any[] = [];

    // Base system / task instructions
    const systemInstruction = `
    You are an AI assistant/secretary for ${receiverName}. The caller is on the phone line but ${receiverName} is currently unavailable.
    Greet the caller briefly, ask what the call is about, and politely hold a short conversation to record their message or voicemail intent.
    Your spoken responses MUST be extremely concise (1-2 sentences), professional, natural, and direct.

    If you have gathered the details (e.g. they provided their name, email/contact, and details of why they are calling), summarize the intent and let them know you'll pass it along, then suggest they can hang up to register the voicemail.
    `;

    promptParts.push({ text: systemInstruction });

    // Include history context if available to maintain back-and-forth conversational state
    if (history && Array.isArray(history) && history.length > 0) {
      promptParts.push({ text: "--- PREVIOUS SPEAKING CONVERSATION LOG ---" });
      history.forEach((msg: any) => {
        promptParts.push({ text: `${msg.role === "user" ? "Caller" : "AI Secretary"}: ${msg.content}` });
      });
      promptParts.push({ text: "-----------------------------------------" });
    }

    // Capture caller action (either audio or text)
    if (callerAudio) {
      promptParts.push({
        text: "The caller has recorded this audio message. Transcribe and respond to it."
      });
      promptParts.push({
        inlineData: {
          mimeType: "audio/webm",
          data: callerAudio
        }
      });
    } else if (callerText) {
      promptParts.push({ text: `The caller typed/said: "${callerText}"` });
    } else {
      promptParts.push({ text: "This is the start of the call. Introduce yourself and ask how you can help." });
    }

    console.log("Calling Gemini API Secretary...");
    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: promptParts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            speakText: {
              type: Type.STRING,
              description: "The direct brief greeting or response to speak out loud back to the caller (1-2 sentences)."
            },
            currentIntentSummary: {
              type: Type.STRING,
              description: "A structured, summarized digest of the caller's identity, contact information, and reason for calling so far."
            }
          },
          required: ["speakText", "currentIntentSummary"]
        }
      }
    });

    const parsedResponse = JSON.parse(aiResponse.text || "{}");
    const speakText = parsedResponse.speakText || "Hello, how can I help you support?";
    const currentIntentSummary = parsedResponse.currentIntentSummary || "";

    // No ElevenLabs - keep configuration purely based on Google APIs and browser-native vocalization
    const audioBase64: string | null = null;

    return res.json({
      speakText,
      currentIntentSummary,
      audioBase64
    });

  } catch (error: any) {
    console.error("Error in AI Secretary responder:", error);
    return res.status(500).json({ error: error.message || "Failed to process audio with Gemini API" });
  }
});

// Create a separate WebSocket server for real-time translation
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (clientWs, req) => {
  console.log("Client connected to Translate Live WS");
  
  // Parse query parameters
  const urlObj = new URL(req.url || "", "http://localhost");
  const myLang = urlObj.searchParams.get("myLang") || "en";
  const partnerLang = urlObj.searchParams.get("partnerLang") || "es";
  const voice = urlObj.searchParams.get("voice") || "Aoede";
  
  // Set up system prompt
  const systemInstruction = `You are a real-time interpreter. Listen to the incoming audio. Instantly translate the speaker's words into the target language selected by the user. Output the translation as natural, conversational audio, and provide the exact text transcript.

Directions:
- The user's language is "${myLang}".
- The partner's language is "${partnerLang}".
- If you hear audio in "${myLang}", instantly translate it to "${partnerLang}".
- If you hear audio in "${partnerLang}", instantly translate it to "${myLang}".
- Translate as you listen. Be extremely conversational, clear, and direct.
- Do NOT output any ambient conversations or explanations. Only translate.`;

  let session: any = null;
  
  try {
    const ai = getGemini();
    console.log("Connecting to Gemini Live API...");
    
    session = await ai.live.connect({
      model: "gemini-live-2.5-flash-preview",
      callbacks: {
        onmessage: (message: any) => {
          // Send all server content and audio chunks to the client
          const parts = message.serverContent?.modelTurn?.parts;
          
          let audioBase64: string | null = null;
          let audioMimeType: string | null = null;
          let textTranscript: string | null = null;
          
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data) {
                audioBase64 = part.inlineData.data;
                audioMimeType = part.inlineData.mimeType || null;
              }
              if (part.text) {
                textTranscript = part.text;
              }
            }
          }
          
          // Fallback check for transcription fields
          const modelTranscript = message.serverContent?.modelTurn?.parts?.find((p: any) => p.text)?.text;
          const outputTranscript =
            message.serverContent?.outputTranscription?.text ||
            message.serverContent?.outputAudioTranscription?.text;
          const inputTranscript =
            message.serverContent?.inputTranscription?.text ||
            message.serverContent?.inputAudioTranscription?.text;
          
          const transcript = textTranscript || modelTranscript || outputTranscript;
          
          if (audioBase64 || transcript || inputTranscript || message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({
              audio: audioBase64,
              audioMimeType,
              transcript: transcript,
              inputTranscript: inputTranscript,
              interrupted: message.serverContent?.interrupted || false
            }));
          }
        },
        onclose: () => {
          console.log("Gemini Live session closed");
        },
        onerror: (err: any) => {
          console.error("Gemini Live session error:", err);
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
        },
        systemInstruction: systemInstruction,
        // Request transcription
        outputAudioTranscription: {},
        inputAudioTranscription: {}
      }
    });

    console.log("Gemini Live session successfully established");
  } catch (error) {
    console.error("Failed to connect to Gemini Live:", error);
    clientWs.send(JSON.stringify({ error: "Failed to initialize Gemini Live session" }));
    clientWs.close();
    return;
  }

  clientWs.on("message", (messageData) => {
    try {
      const dataStr = messageData.toString();
      const parsed = JSON.parse(dataStr);
      
      if (parsed.audio && session) {
        // Feed raw PCM 16kHz input to Gemini Live
        session.sendRealtimeInput({
          audio: {
            data: parsed.audio,
            mimeType: "audio/pcm;rate=16000"
          }
        });
      }
    } catch (err) {
      console.error("Error reading client WebSocket message:", err);
    }
  });

  clientWs.on("close", () => {
    console.log("Client Translate Live WS connection closed");
    if (session) {
      try {
        session.close();
      } catch (e) {
        console.error("Error closing Gemini session:", e);
      }
    }
  });
});

// Serve frontend with Vite dev middleware or standard production build
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Loading Vite dev middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static production files...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully operational on http://0.0.0.0:${PORT}`);
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/api/translate-live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });
}

startServer();
