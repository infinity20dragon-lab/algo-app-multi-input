# Multi-Input Routing System

## Overview
The multi-input routing system allows you to monitor **3 separate audio inputs simultaneously** (Medical, Fire, All Call) and route audio to specific speakers based on which input is active.

---

## How It Works

### Architecture
```
3 Audio Inputs → OBS (noise reduction) → Virtual Devices → App → Assigned Speakers
```

**Key Concept**: Only ONE input will be active at any given time (dispatch controls which input is used manually).

---

## Setup Guide

### 1. Hardware Requirements

**Multi-Input Audio Interface** (3+ channels):
- Scarlett 4i4 or higher
- MOTU M4
- Focusrite Clarett
- Any interface with 3+ inputs

**Physical Connections**:
```
Medical Input (70V line) → Interface Channel 1
Fire Input (70V line) → Interface Channel 2
All Call Input (70V line) → Interface Channel 3
```

### 2. OBS Configuration (Optional but Recommended)

**For clean audio with noise reduction on all 3 inputs:**

1. **Add 3 Audio Input Capture Sources**:
   ```
   Source 1: "Medical" → Interface Channel 1
   Source 2: "Fire" → Interface Channel 2
   Source 3: "All Call" → Interface Channel 3
   ```

2. **Add Filters to EACH Source**:
   - Noise Suppression (RNNoise)
   - Noise Gate (Close: -32dB, Open: -26dB)

3. **Audio Monitoring & Output**:

   **Option A - VoiceMeeter (Windows)**:
   ```
   OBS Source 1 → Audio Monitoring → VAIO1
   OBS Source 2 → Audio Monitoring → VAIO2
   OBS Source 3 → Audio Monitoring → VAIO3

   In VoiceMeeter Banana:
   - VAIO strip 1 → Route to Output (B1 enabled)
   - VAIO strip 2 → Route to Output (B1 enabled)
   - VAIO strip 3 → Route to Output (B1 enabled)
   ```

   **Option B - BlackHole (Mac)**:
   ```
   Use BlackHole 16ch (multi-channel)
   OBS Source 1 → Channels 1-2
   OBS Source 2 → Channels 3-4
   OBS Source 3 → Channels 5-6

   Create Multi-Output Device:
   - BlackHole 16ch
   - Your physical output (for monitoring)
   ```

### 3. App Configuration

**Step 1: Assign Speakers to Input Channels**
1. Go to **Multi-Input Routing** page
2. Scroll to **Unassigned Speakers** section
3. Click button to assign each speaker to:
   - 🏥 Medical
   - 🔥 Fire
   - 📢 All Call

**Example Assignment**:
```
Kitchen Speaker → Medical
Apparatus Bay → Fire
All Speakers → All Call
Office → Medical
Living Quarters → Fire
```

**Step 2: Select Audio Input Devices**
1. For each channel (Medical, Fire, All Call):
2. Select the corresponding input device:
   - Medical → VAIO1 (or BlackHole Ch 1-2)
   - Fire → VAIO2 (or BlackHole Ch 3-4)
   - All Call → VAIO3 (or BlackHole Ch 5-6)

**Step 3: Configure Audio Settings**
- **Detection Threshold**: -40dB (adjust based on background noise)
- **Input Gain**: 1.0x - 3.0x (adjust if inputs are too quiet)

**Step 4: Start Monitoring**
1. Click **Start Monitoring**
2. All 3 inputs are now being monitored simultaneously
3. When audio is detected on any input, assigned speakers activate automatically

---

## Usage

### Normal Operation

```
┌─────────────────────────────────────────────────────────────┐
│              ALL 3 INPUTS MONITORED                         │
│  Medical: Silent | Fire: Silent | All Call: Silent          │
│  Speakers: All at -45dB (idle)                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              MEDICAL CALL COMES IN                          │
│  Medical: ACTIVE 🔥 | Fire: Silent | All Call: Silent      │
│  → Kitchen & Office speakers activate                       │
│  → Paging device mode 1 (transmitting)                     │
│  → Volume ramps to target                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              MEDICAL CALL ENDS                              │
│  Medical: Silent | Fire: Silent | All Call: Silent         │
│  → Kitchen & Office speakers mute to -45dB                  │
│  → Paging device mode 0 (off)                              │
└─────────────────────────────────────────────────────────────┘
```

### Switching Between Inputs

**Only ONE input is active at a time** (dispatch controls):

```
Scenario: Fire call comes in AFTER medical call ends

Medical Call:
- Medical input active
- Kitchen & Office speakers playing
- Fire & All Call inputs silent

Medical call ends → 2 seconds of silence

Fire Call:
- Fire input active
- Apparatus Bay & Living Quarters speakers playing
- Medical & All Call inputs silent
```

---

## Features

### ✅ Simultaneous Monitoring
- App monitors all 3 inputs at the same time
- No need to switch between inputs manually
- Detects which input has audio automatically

### ✅ Per-Speaker Assignment
- Each speaker can be assigned to one input type
- Flexible routing (different zones for different call types)
- Easy reassignment from UI

### ✅ Real-Time Detection
- Audio level meters for each input
- Visual indication when input is active
- Instant speaker activation

### ✅ OBS Noise Reduction
- Clean audio on all 3 inputs
- No static or buzzing
- Professional sound quality

### ✅ Auto Recording (Per Channel)
- Records audio from each channel independently
- Filenames include channel type (medical-timestamp.opus, fire-timestamp.opus)
- Saved to Firebase Storage in multi-input-recordings folder
- Silence delay prevents premature recording stop
- Opus/WebM format (widely supported, high quality, small file size)

### ✅ No Priority System Needed
- Dispatch controls which input is used
- Only ONE input active at a time
- Humans prevent simultaneous inputs

---

## Auto Recording Feature

### How It Works
Each input channel can independently record audio when active:

```
Medical Call:
- Audio detected on Medical input
- Recording starts: medical-2026-01-20T14-30-45.opus
- Speakers activate
- Call ends → 2 second silence delay
- Recording stops and uploads to Firebase Storage
```

### Recording Settings
- **Enable/Disable**: Toggle auto recording on/off
- **Silence Delay**: 0.5s to 5s (default: 2s)
  - Prevents recording from stopping during brief pauses
  - Ensures full call is captured

### Storage Location
```
Firebase Storage Path:
multi-input-recordings/
  ├── {user-id}/
      ├── medical-2026-01-20T14-30-45.opus
      ├── fire-2026-01-20T15-45-12.opus
      ├── allCall-2026-01-20T16-20-33.opus
      └── ...
```

### File Naming Convention
```
{channel-type}-{timestamp}.{extension}

Examples:
- medical-2026-01-20T14-30-45.opus (audio/webm;codecs=opus)
- fire-2026-01-20T15-45-12.webm (audio/webm)
- allCall-2026-01-20T16-20-33.m4a (audio/mp4)
```

**Format Notes**:
- Browser automatically selects best supported format
- Opus is preferred (high quality, small files, universal support)
- All formats play on modern browsers and phones

### Benefits
- **Separate recordings per call type**: Easy to categorize and review
- **No manual intervention**: Automatically starts/stops
- **High quality**: Opus/WebM format, excellent audio quality
- **Small file size**: Efficient compression
- **Searchable**: Filename includes channel type and timestamp
- **Cloud storage**: Access recordings from anywhere

---

## Configuration Examples

### Example 1: Zone-Based Routing
```
Medical Input:
- Kitchen Speaker
- Office Speaker
- Living Quarters

Fire Input:
- Apparatus Bay
- All exterior speakers

All Call Input:
- Every speaker in the station
```

### Example 2: Speaker-Type Routing
```
Medical Input:
- Indoor speakers only

Fire Input:
- High-volume speakers (apparatus bay, exterior)

All Call Input:
- All speakers (emergency broadcast)
```

---

## Troubleshooting

### No audio detected on any input
- **Check**: Are input devices selected for each channel?
- **Check**: Is audio interface connected and recognized?
- **Check**: Is threshold too high? Try lowering to -50dB

### Audio detected but speakers don't activate
- **Check**: Are speakers assigned to the active input channel?
- **Check**: Is paging device online and working?
- **Check**: Are speakers in receiver mode (mode 2)?

### Audio on wrong speakers
- **Check**: Speaker assignments (may be assigned to wrong input)
- **Solution**: Reassign speakers to correct input channel

### OBS routing not working
- **Windows**: Make sure VAIO strips have B1/A1 enabled in VoiceMeeter
- **Mac**: Check Multi-Output Device includes both BlackHole and physical output
- **Both**: Verify OBS Audio Monitoring is set to correct output device

### Multiple inputs active at once
- **This shouldn't happen** - Only one input should be active at a time
- **If it does**: Check if detection threshold is too low
- **Solution**: Increase threshold or add more aggressive noise gating in OBS

### Recordings not saving
- **Check**: Is auto recording enabled?
- **Check**: Is user authenticated (logged in)?
- **Check**: Does Firebase Storage have proper permissions?
- **Solution**: Check browser console for upload errors

### Recording files are empty or very small
- **Check**: Is the input device actually capturing audio?
- **Check**: Audio level meters should show activity when recording
- **Solution**: Test input device with regular Audio Input page first

### Can't distinguish between channel recordings
- **Good news**: Filename includes channel type!
- medical-timestamp.opus = Medical call
- fire-timestamp.opus = Fire call
- allCall-timestamp.opus = All Call

---

## Technical Details

### Input Detection Logic
```typescript
// For each channel, check audio level every frame
const audioLevel = getAudioLevel(channel.analyser);
const db = 20 * Math.log10(audioLevel / 255);

// Input is active if above threshold
const isActive = db > threshold && audioLevel > 5;

// When input becomes active, activate assigned speakers
if (isActive && !wasActiveBefore) {
  activateSpeakersForChannel(channel.type);
}
```

### Speaker Activation Flow
```typescript
1. Set paging device to mode 1 (transmitter)
2. Set assigned speakers to mode 2 (receiver)
3. Ramp speaker volumes to target
   - If global volume enabled: Use global volume
   - If individual volume: Use each speaker's maxVolume
```

### Speaker Deactivation Flow
```typescript
1. Set assigned speakers to -45dB (idle)
2. Set paging device to mode 0 (off)
3. Speakers stay in mode 2 (ready for next audio)
```

---

## Database Schema

### AlgoDevice (Updated)
```typescript
interface AlgoDevice {
  // ... existing fields
  inputAssignment?: "medical" | "fire" | "allCall" | null;
}
```

**Storage**: Firebase Firestore `devices` collection

**Example Document**:
```json
{
  "id": "speaker-kitchen-1",
  "name": "Kitchen Speaker",
  "type": "8180g2",
  "zone": "zone-kitchen-id",
  "inputAssignment": "medical"
}
```

---

## API Endpoints Used

### Set Multicast Mode
```
POST /api/algo/speakers/mcast
Body: { speakers: [...], mode: 0 | 1 | 2 }
```

### Set Volume
```
POST /api/algo/speakers/volume
Body: { speakers: [...], volume: 0-100 }
```

---

## Benefits vs Single Input

| Feature | Single Input (Live Page) | Multi-Input Routing |
|---------|-------------------------|---------------------|
| **Inputs** | 1 | 3 simultaneous |
| **Speaker Targeting** | Zone-based | Input-based + Zone |
| **Call Types** | All calls same | Medical, Fire, All Call |
| **Switching** | Manual zone selection | Automatic based on input |
| **Use Case** | General announcements | Emergency dispatch routing |

---

## Future Enhancements (Ideas)

- [ ] Recording per input type (separate MP3s for medical vs fire)
- [ ] Activity log showing which input was used
- [ ] Statistics (medical calls per day, fire calls, etc.)
- [ ] Email alerts when specific inputs are used
- [ ] Voice announcements ("Medical call incoming")
- [ ] Integration with CAD systems

---

## Boss Will Love This! 🔥

**Before**: One input, manual zone switching, all calls treated the same

**After**:
- 3 inputs monitored simultaneously
- Medical calls go to medical areas
- Fire calls go to apparatus bay
- All Call broadcasts station-wide
- Clean audio (OBS noise reduction on all inputs)
- **Auto recording per channel** (medical-timestamp.opus, fire-timestamp.opus)
- **Searchable recordings** with channel metadata
- No manual switching needed
- Professional dispatch system

**The Magic**: Dispatch controls which input to use → App automatically routes to correct speakers → Firefighters hear only relevant calls → Recordings saved with call type!

**Bonus for Boss**:
- "Show me all medical calls from last week" → Search for medical-2026-01-*
- "Play the fire call from yesterday at 3pm" → fire-2026-01-19T15-*
- Separate recordings = easy auditing and review!
- Recordings play on all devices (Chrome, Firefox, Safari, iOS, Android)
