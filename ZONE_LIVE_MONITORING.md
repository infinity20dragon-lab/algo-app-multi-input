# Zone-Based Live Audio Monitoring

## Overview
The zone-based live monitoring feature allows you to dynamically control which zones (and their assigned speakers) receive live audio broadcasts - without stopping the audio monitoring.

## How It Works

### Architecture
1. **One Paging Device (8301)** - Captures and broadcasts audio via multicast
2. **Multiple Speakers** - Each speaker can be individually enabled/disabled
3. **Zone Organization** - Speakers are organized into zones (e.g., Apparatus Bay, Kitchen, Office)

### Zone Control Flow
```
User selects zones → System finds speakers in those zones → Speakers are enabled/disabled
```

Even though the paging device broadcasts to all speakers, only the **enabled** speakers will actually play audio.

## Usage Guide

### Starting Live Monitoring with Zones

1. **Go to Audio Input page**
2. **Enable Zone Selection** - Toggle the switch in the "Zone Selection" card
3. **Select zones** - Check the zones you want to broadcast to
   - You can select multiple zones
   - Use "Select All Zones" for station-wide broadcasts
4. **Start Monitoring** - Click "Start Monitoring"
5. Audio will only play in the selected zones

### Dynamic Zone Switching (While Live)

**This is the killer feature!** You can change zones WITHOUT stopping monitoring:

1. **Monitoring is active** - Audio is being captured and broadcast
2. **Change zone selection** - Check/uncheck different zones
3. **Instant transition**:
   - Speakers in deselected zones: Volume → 0, Multicast → none
   - Speakers in newly selected zones: Enabled, Volume applied
4. **Audio continues** - No interruption to the monitoring

### Example Scenarios

#### Scenario 1: Fire Call - Start with All Zones
```
1. Start monitoring with "All Zones" selected
2. Fire call comes in → All station speakers active
3. Call is resolved
```

#### Scenario 2: Medical Call - Switch to Specific Zone
```
1. Monitoring active with "Apparatus Bay" selected
2. Medical call comes in → Need kitchen staff
3. Uncheck "Apparatus Bay", check "Kitchen"
4. Apparatus Bay speakers go silent immediately
5. Kitchen speakers activate immediately
6. No need to stop/restart monitoring
```

#### Scenario 3: Expanding Coverage
```
1. Monitoring active with "Kitchen" selected
2. Need to alert more areas
3. Also check "Office" and "Living Quarters"
4. Those zones activate while Kitchen stays on
5. All selected zones now receive audio
```

## Technical Details

### What Happens During Zone Switch

When you change zone selection while monitoring is active:

```javascript
// 1. Calculate which speakers are in selected zones
const devicesInZones = devices.filter(d => selectedZones.includes(d.zone));

// 2. Disable speakers NOT in selected zones
for (speakerNotInZone) {
  setVolume(speaker, 0);
  setMulticast(speaker, 'none');
}

// 3. Enable speakers IN selected zones
for (speakerInZone) {
  setVolume(speaker, configuredVolume);
  setMulticast(speaker, 'enabled');
}
```

### Benefits

1. **No Audio Interruption** - Monitoring continues without restart
2. **Instant Response** - Zone changes take effect immediately
3. **Flexible Control** - Can target 1 zone or all zones
4. **Visual Feedback** - See exactly which zones and speakers are active
5. **Zone Color Coding** - Devices show their zone in the zone's color

## UI Features

### Zone Selection Card
- **Toggle Switch** - Enable/disable zone mode
- **Zone List** - All zones with speaker counts
- **Select All** - Quick toggle for all zones
- **Active Summary** - Shows how many zones/speakers are active
- **Color Indicators** - Each zone shows its configured color

### Target Devices Card
- **Zone Mode Active** - Shows "Controlled by zone selection"
- **Zone Names** - Each device shows its zone (in zone color)
- **Disabled State** - Device selection disabled when using zones
- **Auto-Update** - Selection updates automatically with zone changes

## Best Practices

1. **Pre-configure zones** - Set up your zones in the Station Zones page first
2. **Assign all speakers** - Make sure every speaker is assigned to a zone
3. **Use zone mode by default** - It's much faster than selecting individual devices
4. **Test before deployment** - Try switching zones while monitoring to ensure smooth operation
5. **Use descriptive zone names** - "Apparatus Bay" is better than "Zone 1"

## Troubleshooting

### Zone selection not showing
- **Cause**: No zones configured
- **Solution**: Go to Station Zones page and create zones

### Speakers not responding to zone changes
- **Cause**: Speakers not assigned to zones
- **Solution**: Assign speakers to zones in Station Zones page

### Zone mode toggle doesn't work
- **Cause**: No zones exist
- **Solution**: Create at least one zone first

### Individual device selection grayed out
- **Cause**: Zone mode is active
- **Solution**: This is expected - toggle off zone mode to manually select devices

## Technical Notes

- Zone selection persists in React state only (not saved between sessions)
- Device assignment to zones is stored in Firebase
- Dynamic switching uses the `controlSingleSpeaker` API
- All operations are logged to console for debugging
- Compatible with both Global Volume and Individual Volume modes
- Works with volume ramping (day/night mode)
