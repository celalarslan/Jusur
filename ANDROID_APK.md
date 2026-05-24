# Android APK Build

The Android app is built with Capacitor.

## What this APK does

- Opens the production Jusur Cloud Run app inside a native Android shell.
- Registers a native Firebase Cloud Messaging token.
- Sends Android tokens to Firestore with `platform: "android"`.
- Shows high-priority full-screen incoming call notifications from data-only FCM messages.

## Package

```txt
com.jusur.call
```

## GitHub Actions build

1. Push to `main`.
2. Open GitHub repository > Actions.
3. Open `Android Debug APK`.
4. Download the `jusur-debug-apk` artifact.
5. Install `app-debug.apk` on an Android phone.

## Local build

Requires Android Studio or:

- JDK 17+
- Android SDK
- Android build tools

```bash
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

APK output:

```txt
android/app/build/outputs/apk/debug/app-debug.apk
```

## Required app setup on phone

1. Install APK.
2. Open Jusur.
3. Sign in.
4. Open Settings.
5. Tap `Enable call alerts`.
6. Allow notifications.

Android may still require notification/full-screen intent permission depending on Android version and manufacturer settings.
