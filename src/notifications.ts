import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import firebaseConfig from "../firebase-applet-config.json";
import { saveNotificationToken } from "./firebase";

export async function enableIncomingCallNotifications(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") {
      throw new Error("Notification permission was not granted.");
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      PushNotifications.addListener("registration", async (token) => {
        try {
          await saveNotificationToken(token.value, "android");
          if (!settled) {
            settled = true;
            resolve(token.value);
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      });

      PushNotifications.addListener("registrationError", (error) => {
        if (!settled) {
          settled = true;
          reject(new Error(error.error || "Android push registration failed."));
        }
      });

      PushNotifications.register();
    });
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("This browser does not support web push notifications.");
  }

  const supported = await isSupported();
  if (!supported) {
    throw new Error("Incoming call alerts are not supported in this browser.");
  }

  const vapidKey = (firebaseConfig as { fcmVapidKey?: string }).fcmVapidKey;
  if (!vapidKey) {
    throw new Error("Incoming call alerts are not configured yet.");
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
    throw new Error("This device could not register for incoming call alerts.");
  }

  await saveNotificationToken(token, "web");
  return token;
}
