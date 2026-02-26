# F1X Backend — Deployment Guide

Step-by-step guide to set up Firebase, deploy the backend, and connect the Chrome extension.

---

## Prerequisites

- **Node.js 22+** — [download](https://nodejs.org/)
- **Firebase CLI** — install globally:
  ```bash
  npm install -g firebase-tools
  ```
- **Google account** with access to [Firebase Console](https://console.firebase.google.com)

---

## 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add project** → name it `f1x-backend` (or your preferred name)
3. Disable Google Analytics (not needed) → **Create project**
4. Once created, go to **Build → Firestore Database**
5. Click **Create database** → choose **Start in production mode** → select a region (e.g. `us-central1`) → **Enable**

> [!IMPORTANT]
> The region you select for Firestore will also be where Cloud Functions deploy by default. Choose a region close to your users. `us-central1` is the default and most cost-effective.

---

## 2. Upgrade to Blaze Plan

Cloud Functions require the **Blaze (pay-as-you-go)** plan.

1. In Firebase Console → click the **Spark** plan badge (bottom left)
2. Select **Upgrade to Blaze**
3. Link a billing account (you won't be charged unless you exceed free tier limits)

**Free tier includes:** 2M Cloud Function invocations/month, 50K Firestore reads/day, 20K writes/day.

---

## 3. Authenticate Firebase CLI

```bash
firebase login
```

This opens a browser for Google account authentication. After logging in, verify:

```bash
firebase projects:list
```

You should see `f1x-backend` in the list.

---

## 4. Update Project ID

If your Firebase project ID differs from `f1x-backend`, update these files:

**`.firebaserc`** — change the project ID:

```json
{
  "projects": {
    "default": "YOUR_PROJECT_ID"
  }
}
```

**`extension/js/api.js`** line 9 — update the backend URL:

```js
const BACKEND_BASE = "https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net";
```

**`extension/manifest.json`** — update host_permissions:

```json
"host_permissions": [
  "https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/*"
]
```

---

## 5. Install Dependencies

```bash
cd functions
npm install
cd ..
```

---

## 6. Test Locally (Optional but Recommended)

Start the Firebase emulators to test everything locally before deploying:

```bash
firebase emulators:start --only functions,firestore
```

This starts:

- **Functions emulator** at `http://127.0.0.1:5001`
- **Firestore emulator** at `http://127.0.0.1:8080`
- **Emulator UI** at `http://127.0.0.1:4000`

### Test HTTP endpoints

```bash
# Should return [] (empty — no data cached yet)
curl http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1/getMeetings?year=2026
```

### Trigger scheduled functions manually

Open the Emulator UI at `http://127.0.0.1:4000` → **Functions** tab → click the trigger button next to `refreshMeetings`. Then check the **Firestore** tab — you should see a `f1_cache/meetings_2026` document.

### Test with the extension

Temporarily change `BACKEND_BASE` in `extension/js/api.js` to:

```js
const BACKEND_BASE = "http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1";
```

Load the extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → select `extension/` folder) and open a new tab. Verify widgets load.

> [!WARNING]
> Remember to revert `BACKEND_BASE` to the production URL before deploying the extension.

---

## 7. Deploy to Firebase

```bash
# Deploy everything (functions + firestore rules)
firebase deploy

# Or deploy only functions
firebase deploy --only functions

# Or deploy only firestore rules
firebase deploy --only firestore:rules
```

After deployment, the CLI will print your function URLs:

```
✔  functions[getMeetings]: http trigger initialized
   → https://us-central1-f1x-backend.cloudfunctions.net/getMeetings
✔  functions[refreshMeetings]: scheduled function initialized
...
```

### Verify deployment

```bash
# Test a deployed endpoint
curl https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/getMeetings?year=2026
```

First call may return `[]` since scheduled jobs haven't run yet. Wait a few minutes for the schedulers to trigger, or manually trigger them from the Firebase Console.

---

## 8. Seed Initial Data

After first deploy, scheduled jobs will start running automatically. To populate data immediately without waiting:

1. Go to **Firebase Console → Functions** → find `refreshMeetings`
2. Click the three-dot menu → **Run function** (or trigger via CLI)

Or use the Firebase CLI:

```bash
# Trigger all refresh jobs to seed the cache
firebase functions:shell
# In the shell:
> refreshMeetings()
> refreshSessions()
> refreshStandings()
> refreshLiveData()
```

Verify in **Firebase Console → Firestore** that documents appear under the `f1_cache` collection.

---

## 9. Load the Extension

1. Update `BACKEND_BASE` in `extension/js/api.js` to your production URL
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `extension/` folder
5. Open a new tab — the F1 dashboard should load with data from your backend

---

## Monitoring & Troubleshooting

### View function logs

```bash
firebase functions:log
```

Or in Firebase Console → **Functions → Logs**.

### Common issues

| Issue                        | Solution                                                               |
| ---------------------------- | ---------------------------------------------------------------------- |
| `[]` returned from endpoints | Scheduled jobs haven't run yet. Seed data manually (step 8)            |
| CORS errors in extension     | Verify `host_permissions` in `manifest.json` matches your function URL |
| 429 from extension           | IP rate limit hit (60 req/min). Wait a minute or adjust in `config.js` |
| 429 in function logs         | Upstream API rate limit. The retry logic handles this automatically    |
| Functions not triggering     | Check Cloud Scheduler in GCP Console → verify schedules are active     |

### Useful commands

```bash
firebase emulators:start    # Local testing
firebase deploy              # Deploy all
firebase functions:log       # View logs
firebase functions:shell     # Manually trigger functions
firebase firestore:delete --all-collections  # Reset Firestore (⚠️ destructive)
```
