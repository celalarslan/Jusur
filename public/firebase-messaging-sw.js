importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDNNE8y7R7cbNStbtJiyhwTSvZRo2oXlv0",
  authDomain: "j-call-prod.firebaseapp.com",
  projectId: "j-call-prod",
  storageBucket: "j-call-prod.firebasestorage.app",
  messagingSenderId: "734750832655",
  appId: "1:734750832655:web:9aa4880363aa0fb9884b7a"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Incoming Jusur call";
  const body = payload.notification?.body || "Tap to answer the call.";
  const url = payload.data?.url || "/";

  self.registration.showNotification(title, {
    body,
    icon: "/assets/Jusoor_icon-H-wa72S-.png",
    badge: "/assets/Jusoor_icon-H-wa72S-.png",
    data: { url },
    requireInteraction: true,
    tag: payload.data?.callId || "jusur-incoming-call"
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
