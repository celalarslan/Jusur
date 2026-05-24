import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jusur.call",
  appName: "Jusur",
  webDir: "dist",
  server: {
    url: "https://j-call-734750832655.europe-west1.run.app",
    cleartext: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    }
  }
};

export default config;
