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

## GitHub Actions debug build

1. Push to `main`.
2. Open GitHub repository > Actions.
3. Open `Android Debug APK`.
4. Download the `jusur-android-apk` artifact, or use the stable release asset:

```txt
https://github.com/celalarslan/Jusur/releases/download/android-latest/Jusur-Android.apk
```

## GitHub Actions signed release build

Use this for controlled distribution because it keeps Android updates stable across versions.

Create these GitHub repository secrets:

```txt
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Generate a private keystore locally:

```bash
keytool -genkeypair \
  -v \
  -keystore jusur-release.keystore \
  -alias jusur \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

base64 -i jusur-release.keystore | pbcopy
```

Put the copied base64 text into `ANDROID_KEYSTORE_BASE64`. Keep the keystore file and passwords private.

Then open GitHub Actions > `Android Release APK` > `Run workflow`.

The stable signed APK URL will be:

```txt
https://github.com/celalarslan/Jusur/releases/download/android-release/Jusur-Android-Release.apk
```

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

The app settings screen includes shortcuts for notification, full-screen call, and battery settings on Android.
