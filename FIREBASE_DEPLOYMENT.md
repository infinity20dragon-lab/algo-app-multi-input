# Firebase Deployment Instructions

## Deploying Firestore Security Rules

The Firestore security rules have been created in `firestore.rules` and configured in `firebase.json`.

### Prerequisites
1. Install Firebase CLI if not already installed:
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Initialize Firebase in the project (if not already done):
   ```bash
   firebase init
   ```
   - Select "Firestore" when prompted
   - Accept the default `firestore.rules` file
   - Skip the indexes file (press Enter)

### Deploy Rules to Firebase
To deploy only the Firestore rules without deploying functions or hosting:

```bash
firebase deploy --only firestore:rules
```

### Verify Deployment
After deployment, you can verify the rules in the Firebase Console:
1. Go to https://console.firebase.google.com
2. Select your project
3. Navigate to Firestore Database → Rules
4. You should see the rules from `firestore.rules` applied

### Security Rules Overview
The current rules allow authenticated users to:
- Read and write to all collections (devices, zones, zoneRouting, audioFiles, distributionLogs)
- This is suitable for internal fire station use
- Consider tightening these rules if the app will be exposed to untrusted users

### Testing Rules Locally
You can test rules locally using the Firebase Emulator:
```bash
firebase emulators:start --only firestore
```

Then update your Firebase config to point to the emulator:
```typescript
import { connectFirestoreEmulator } from "firebase/firestore";
connectFirestoreEmulator(db, 'localhost', 8080);
```
