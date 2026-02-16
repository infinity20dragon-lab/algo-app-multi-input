# User-Specific Device Isolation - Setup Guide

## ✅ What's Been Done

### 1. Types Updated
Added `ownerEmail` field to:
- ✅ `AlgoDevice`
- ✅ `PoESwitch`
- ✅ `PoEDevice`
- ✅ `Zone`
- ✅ `AudioFile`

### 2. Firestore Functions Updated
All `get*` functions now accept optional `ownerEmail` parameter:
- ✅ `getDevices(ownerEmail?)`
- ✅ `getZones(ownerEmail?)`
- ✅ `getAudioFiles(ownerEmail?)`
- ✅ `getPoESwitches(ownerEmail?)`
- ✅ `getPoEDevices(ownerEmail?)`

### 3. Pages Updated
- ✅ **Live page** (`/live`) - Filters all data by user email
- ✅ **Devices page** (`/devices`) - Filters devices, auto-adds ownerEmail on create

---

## 🔧 Remaining Pages to Update

### 1. PoE Devices Page (`/app/poe-devices/page.tsx`)

**What to do:**

```typescript
// 1. Import useAuth at top
import { useAuth } from "@/contexts/auth-context";

// 2. Get user
const { user } = useAuth();

// 3. Update loadData function
const loadData = async () => {
  const userEmail = user?.email || "";
  const [switchesData, devicesData, algoDevicesData] = await Promise.all([
    getPoESwitches(userEmail),  // ADD userEmail
    getPoEDevices(userEmail),   // ADD userEmail
    getDevices(userEmail),      // ADD userEmail
  ]);
  // ... rest
};

// 4. Add ownerEmail when creating switch
await addPoESwitch({
  name: switchFormData.name,
  type: switchFormData.type,
  ipAddress: switchFormData.ipAddress,
  password: switchFormData.password,
  ownerEmail: user?.email || "",  // ADD THIS LINE
  isOnline: false,
  lastSeen: null,
});

// 5. Add ownerEmail when creating device
await addPoEDevice({
  name: deviceFormData.name,
  switchId: deviceFormData.switchId,
  portNumber: deviceFormData.portNumber,
  mode: deviceFormData.mode,
  ownerEmail: user?.email || "",  // ADD THIS LINE
  zone: deviceFormData.zone,
  linkedPagingDeviceIds: deviceFormData.linkedPagingDeviceIds,
  inputAssignment: deviceFormData.inputAssignment,
  isEnabled: false,
  isOnline: false,
  lastToggled: null,
});
```

### 2. Zones Page (`/app/zones/page.tsx`)

**What to do:**

```typescript
// 1. Import useAuth
import { useAuth } from "@/contexts/auth-context";

// 2. Get user
const { user } = useAuth();

// 3. Update loadZones
const loadZones = async () => {
  const userEmail = user?.email || "";
  const data = await getZones(userEmail);  // ADD userEmail
  setZones(data);
};

// 4. Add ownerEmail when creating zone
await addZone({
  name: formData.name,
  color: formData.color,
  deviceIds: [],
  ownerEmail: user?.email || "",  // ADD THIS LINE
});
```

### 3. Distribute Page (`/app/distribute/page.tsx`)

**What to do:**

```typescript
// 1. Import useAuth (might already be there)
import { useAuth } from "@/contexts/auth-context";

// 2. Get user (might already be there)
const { user } = useAuth();

// 3. Update loadData
const loadData = async () => {
  const userEmail = user?.email || "";
  const [devicesData, audioData, zonesData] = await Promise.all([
    getDevices(userEmail),      // ADD userEmail
    getAudioFiles(userEmail),   // ADD userEmail
    getZones(userEmail),        // ADD userEmail
  ]);
  // ... rest
};
```

### 4. Audio Page (if you have one) (`/app/audio/page.tsx`)

Same pattern - add userEmail to all get* calls.

---

## 📝 Manual Firestore Migration

Since you're doing manual migration, go to Firebase Console and add `ownerEmail` to each document:

### For Devices Collection:
1. Firebase Console → Firestore → `devices`
2. Click each device
3. Add field: `ownerEmail` (string) = `"user@example.com"`
4. Save

### For PoE Switches Collection:
1. Firestore → `poeSwitches`
2. Add field: `ownerEmail` = `"user@example.com"`

### For PoE Devices Collection:
1. Firestore → `poeDevices`
2. Add field: `ownerEmail` = `"user@example.com"`
smfduser@smfd.org
### For Zones Collection:
1. Firestore → `zones`
2. Add field: `ownerEmail` = `"user@example.com"`

### For Audio Files Collection:
1. Firestore → `audioFiles`
2. Add field: `ownerEmail` = `"user@example.com"`

---

## 🔍 Firestore Index Required

When filtering by `ownerEmail` + `orderBy`, you'll need a composite index:

**Error you might see:**
```
The query requires an index. You can create it here: [link]
```

**To fix:**
1. Click the link in the error
2. Or go to Firebase Console → Firestore → Indexes
3. Create indexes for:
   - `devices`: `ownerEmail` (Ascending) + `createdAt` (Descending)
   - `poeSwitches`: `ownerEmail` (Ascending) + `createdAt` (Descending)
   - `poeDevices`: `ownerEmail` (Ascending) + `createdAt` (Descending)
   - `zones`: `ownerEmail` (Ascending) + `createdAt` (Descending)
   - `audioFiles`: `ownerEmail` (Ascending) + `createdAt` (Descending)

---

## ✅ Testing

### Test 1: User A sees only their devices
1. Login as `user-a@example.com`
2. Add a device
3. Logout

### Test 2: User B sees only their devices
1. Login as `user-b@example.com`
2. Should NOT see User A's device
3. Add a device

### Test 3: User A still sees only their devices
1. Login as `user-a@example.com`
2. Should NOT see User B's device
3. Should see their own device

---

## 🎯 What This Achieves

✅ **Privacy** - Users only see their own devices
✅ **Multi-tenant** - Support unlimited fire stations
✅ **No confusion** - Each station sees only their equipment
✅ **Admin control** - Admins can still control any user's session via Control Center

---

## ⚠️ Important Notes

1. **Existing devices without `ownerEmail` won't appear** until you manually add the field
2. **New devices automatically get owner** from current user
3. **Don't delete documents** - just add the `ownerEmail` field
4. **Composite indexes** may take a few minutes to build

---

Good luck! Once you've updated the remaining pages and added `ownerEmail` to Firestore, everything will be isolated per user! 🚀
