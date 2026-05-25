import { registerPlugin } from "@capacitor/core";
import { Contact } from "./types";

interface JusurNativePlugin {
  getContacts(): Promise<{ contacts: Contact[] }>;
  openNotificationSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  openFullScreenIntentSettings(): Promise<void>;
}

const JusurNative = registerPlugin<JusurNativePlugin>("JusurNative");

export async function fetchNativeContacts(): Promise<Contact[]> {
  const result = await JusurNative.getContacts();
  return result.contacts || [];
}

export function openNativeNotificationSettings() {
  return JusurNative.openNotificationSettings();
}

export function openNativeBatterySettings() {
  return JusurNative.openBatterySettings();
}

export function openNativeFullScreenIntentSettings() {
  return JusurNative.openFullScreenIntentSettings();
}
