# J-Call Cloud Run Deploy

Use Cloud Run for this project because the live interpreter uses WebSockets.

## 1. Open Cloud Shell

https://shell.cloud.google.com/?project=j-call-prod

## 2. Clone the repo

```bash
git clone https://github.com/celalarslan/Jusur.git
cd Jusur
```

If you deploy from a different branch, switch to it before continuing.

## 3. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  people.googleapis.com \
  meet.googleapis.com
```

## 4. Deploy

Replace `YOUR_GEMINI_API_KEY` with the Gemini key. Do not commit it.

For reliable WebRTC across mobile networks, add TURN credentials from a provider such as Metered, Twilio, Xirsys, or your own coturn server:

- `TURN_URLS`: comma-separated TURN URLs, for example `turn:global.turn.example.com:3478,turns:global.turn.example.com:5349`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

```bash
gcloud run deploy j-call \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 3000 \
  --clear-base-image \
  --set-env-vars GEMINI_API_KEY=YOUR_GEMINI_API_KEY,GOOGLE_CLOUD_PROJECT_NUMBER=734750832655,TURN_URLS=YOUR_TURN_URLS,TURN_USERNAME=YOUR_TURN_USERNAME,TURN_CREDENTIAL=YOUR_TURN_CREDENTIAL
```

When deployment finishes, Cloud Run prints a service URL like:

```txt
https://j-call-xxxxx-ew.a.run.app
```

## 5. Add the Cloud Run URL to Google/Firebase

Firebase Console:

```txt
Authentication > Settings > Authorized domains
```

Add the Cloud Run host only, without `https://`.

Google Cloud Console:

```txt
APIs & Services > Credentials > OAuth 2.0 Client IDs > J-Call Web
```

Add to Authorized JavaScript origins:

```txt
https://YOUR-CLOUD-RUN-HOST.a.run.app
```

Keep this redirect URI:

```txt
https://j-call-prod.firebaseapp.com/__/auth/handler
```

## 6. Test

Open the Cloud Run URL and test:

1. Email/password login
2. Google login
3. Contact sync
4. Audio call
5. Video call
6. Live translation
