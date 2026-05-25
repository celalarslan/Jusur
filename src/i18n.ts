type LocaleKey = "en" | "tr";

const messages = {
  en: {
    appTag: "Jusur",
    contactInput: "Email, phone, or contact",
    audio: "Audio",
    video: "Video",
    yourLanguage: "Your language",
    translateTo: "Translate to",
    voice: "Voice",
    female: "Female",
    male: "Male",
    chats: "Chats",
    readyContacts: "ready contacts",
    sync: "Sync",
    noContacts: "No contacts yet",
    noContactsHint: "Use the search box above or sync your address book.",
    settings: "Settings",
    settingsHint: "Profile, inbox, sync and security",
    callDefaults: "Call defaults",
    secretaryInbox: "Secretary inbox",
    serviceStatus: "Service status",
    enableCallAlerts: "Enable call alerts",
    callAlertsEnabled: "Call alerts enabled",
    signOut: "Sign out"
  },
  tr: {
    appTag: "Jusur",
    contactInput: "E-posta, telefon veya kişi",
    audio: "Sesli",
    video: "Video",
    yourLanguage: "Senin dilin",
    translateTo: "Çeviri dili",
    voice: "Ses",
    female: "Kadın",
    male: "Erkek",
    chats: "Aramalar",
    readyContacts: "hazır kişi",
    sync: "Eşitle",
    noContacts: "Henüz kişi yok",
    noContactsHint: "Yukarıdan kişi gir veya rehberini eşitle.",
    settings: "Ayarlar",
    settingsHint: "Profil, bildirim, eşitleme ve güvenlik",
    callDefaults: "Arama varsayılanları",
    secretaryInbox: "Sekreter kutusu",
    serviceStatus: "Servis durumu",
    enableCallAlerts: "Arama bildirimlerini aç",
    callAlertsEnabled: "Arama bildirimleri açık",
    signOut: "Çıkış yap"
  }
} as const;

export function getBrowserLocale(): LocaleKey {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("tr")) {
    return "tr";
  }
  return "en";
}

export function createTranslator(locale: LocaleKey) {
  return (key: keyof typeof messages.en) => messages[locale][key] || messages.en[key];
}
