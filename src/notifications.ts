import { getMessaging, getToken, isSupported } from "firebase/messaging";
import firebaseConfig from "../firebase-applet-config.json";
import { saveNotificationToken } from "./firebase";

export async function enableIncomingCallNotifications(): Promise<string> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("This browser does not support web push notifications.");
  }

  const supported = await isSupported();
  if (!supported) {
    throw new Error("Firebase Messaging is not supported in this browser.");
  }

  const vapidKey = (firebaseConfig as { fcmVapidKey?: string }).fcmVapidKey;
  if (!vapidKey) {
    throw new Error("Firebase Web Push key is missing. Add fcmVapidKey to firebase-applet-config.json.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const messaging = getMessaging();
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration
  });

  if (!token) {
    throw new Error("Firebase Messaging did not return a device token.");
  }

  await saveNotificationToken(token);
  return token;
}
