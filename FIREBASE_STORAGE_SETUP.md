# Firebase Storage Setup

## Security Rules Deployment

The Firebase Storage security rules have been created in `storage.rules`. You need to deploy them to secure your storage bucket.

### Option 1: Deploy via Firebase Console (Recommended for Quick Setup)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Storage** → **Rules** tab
4. Copy the contents of `storage.rules` file
5. Paste into the rules editor
6. Click **Publish**

### Option 2: Deploy via Firebase CLI

1. Install Firebase CLI if you haven't:
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Initialize Firebase in your project (if not already done):
   ```bash
   firebase init storage
   ```
   - Select your Firebase project
   - Accept the default storage rules file or specify `storage.rules`

4. Deploy the storage rules:
   ```bash
   firebase deploy --only storage
   ```

## What the Rules Do

The security rules in `storage.rules` provide:

### ✅ Secure Access
- **Authentication Required**: Only logged-in users can access storage
- **User Isolation**: Users can only access their own recordings
- **File Type Validation**: Only audio files (audio/\*, video/webm) are allowed
- **Size Limits**: Maximum 10MB per file

### 📁 Storage Paths

1. **`audio-recordings/{userId}/{filename}`**
   - Auto-recorded audio from monitoring system
   - Each user has their own folder
   - Users can read/write/delete only their own recordings

2. **`audio/{filename}`**
   - Shared audio library for distribution
   - All authenticated users can read
   - All authenticated users can upload
   - Used for pre-tone audio files

## How Recording Works

1. **Auto-Start**: When sustained audio is detected and speakers enable
2. **Auto-Stop**: When speakers disable (after 10s of silence)
3. **Auto-Upload**: Recording is uploaded to Firebase Storage
4. **Log Entry**: Recording URL is added to the activity log
5. **Playback**: Play recordings directly from the log viewer

## Storage Location

Your storage bucket is in **us-west1** (Oregon) for optimal performance with California users.

## Testing the Rules

After deploying, you can test by:

1. Start monitoring on the Live page
2. Trigger audio above threshold for 1+ second
3. Wait for speakers to disable
4. Check the Activity Log for the recording playback control
5. Click play to listen to the recorded audio

## Troubleshooting

### "Permission Denied" Error
- Ensure you're logged in (authenticated)
- Verify storage rules are deployed
- Check browser console for specific error messages

### Recording Not Saving
- Check browser console for upload errors
- Verify user authentication
- Ensure microphone permissions are granted
- Check Firebase Storage quota limits

### Can't Play Recording
- Verify the recording URL exists in the log
- Check Firebase Storage rules allow read access
- Ensure your browser supports WebM audio format

## Security Notes

⚠️ **Important**: Never use test mode rules in production:
```javascript
// ❌ NEVER use this in production:
allow read, write: if true;

// ✅ ALWAYS require authentication:
allow read, write: if request.auth != null;
```

The rules in `storage.rules` are production-ready and secure.
