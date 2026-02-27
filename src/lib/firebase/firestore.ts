import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  type DocumentData,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";
import type { AlgoDevice, Zone, AudioFile, DistributionLog, ZoneRouting, PoESwitch, PoEDevice, Recording } from "@/lib/algo/types";

// ============ Devices ============

const devicesCollection = collection(db, "devices");

export async function getDevices(ownerEmail?: string): Promise<AlgoDevice[]> {
  let q = query(devicesCollection, orderBy("createdAt", "desc"));

  // Filter by owner if provided
  if (ownerEmail) {
    q = query(devicesCollection, where("ownerEmail", "==", ownerEmail), orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as AlgoDevice[];
}

export async function getDevice(id: string): Promise<AlgoDevice | null> {
  const docRef = doc(db, "devices", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as AlgoDevice;
}

export async function addDevice(device: Omit<AlgoDevice, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const now = Timestamp.now();
  const docRef = await addDoc(devicesCollection, {
    ...device,
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
}

export async function updateDevice(id: string, data: Partial<AlgoDevice>): Promise<void> {
  const docRef = doc(db, "devices", id);
  // Firebase doesn't allow undefined values - filter them out
  const cleanData: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  }
  await updateDoc(docRef, cleanData);
}

export async function deleteDevice(id: string): Promise<void> {
  const docRef = doc(db, "devices", id);
  await deleteDoc(docRef);
}

// ============ Zones ============

const zonesCollection = collection(db, "zones");

export async function getZones(ownerEmail?: string): Promise<Zone[]> {
  let q = query(zonesCollection, orderBy("createdAt", "desc"));

  // Filter by owner if provided
  if (ownerEmail) {
    q = query(zonesCollection, where("ownerEmail", "==", ownerEmail), orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as Zone[];
}

export async function getZone(id: string): Promise<Zone | null> {
  const docRef = doc(db, "zones", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as Zone;
}

export async function addZone(zone: Omit<Zone, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const now = Timestamp.now();
  const docRef = await addDoc(zonesCollection, {
    ...zone,
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
}

export async function updateZone(id: string, data: Partial<Zone>): Promise<void> {
  const docRef = doc(db, "zones", id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteZone(id: string): Promise<void> {
  const docRef = doc(db, "zones", id);
  await deleteDoc(docRef);

  // Also delete the routing configuration
  const routingRef = doc(db, "zoneRouting", id);
  try {
    await deleteDoc(routingRef);
  } catch (error) {
    // Routing doc might not exist, that's okay
    console.log("No routing config to delete for zone:", id);
  }
}

// ============ Zone Routing ============

const zoneRoutingCollection = collection(db, "zoneRouting");

export async function getZoneRouting(zoneId: string): Promise<ZoneRouting | null> {
  const docRef = doc(db, "zoneRouting", zoneId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as ZoneRouting;
}

export async function getAllZoneRouting(): Promise<Record<string, ZoneRouting>> {
  const snapshot = await getDocs(zoneRoutingCollection);
  const routing: Record<string, ZoneRouting> = {};
  snapshot.docs.forEach((doc) => {
    routing[doc.id] = { id: doc.id, ...convertTimestamps(doc.data()) } as ZoneRouting;
  });
  return routing;
}

/**
 * Get zone routing only for zones owned by a specific user.
 * Prevents cross-user data leakage — routing is scoped to the user's own zones.
 */
export async function getUserZoneRouting(ownerEmail: string): Promise<Record<string, ZoneRouting>> {
  const userZones = await getZones(ownerEmail);
  if (userZones.length === 0) return {};

  const routing: Record<string, ZoneRouting> = {};
  await Promise.all(
    userZones.map(async (zone) => {
      const docRef = doc(db, "zoneRouting", zone.id);
      const snapshot = await getDoc(docRef);
      if (snapshot.exists()) {
        routing[zone.id] = { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as ZoneRouting;
      }
    })
  );
  return routing;
}

export async function setZoneRouting(zoneId: string, routing: Omit<ZoneRouting, "id" | "updatedAt">): Promise<void> {
  const docRef = doc(db, "zoneRouting", zoneId);
  await setDoc(docRef, {
    ...routing,
    zoneId,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

// ============ Audio Files ============

const audioFilesCollection = collection(db, "audioFiles");

export async function getAudioFiles(ownerEmail?: string): Promise<AudioFile[]> {
  let q = query(audioFilesCollection, orderBy("createdAt", "desc"));

  // Filter by owner if provided
  if (ownerEmail) {
    q = query(audioFilesCollection, where("ownerEmail", "==", ownerEmail), orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as AudioFile[];
}

export async function getAudioFile(id: string): Promise<AudioFile | null> {
  const docRef = doc(db, "audioFiles", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as AudioFile;
}

export async function addAudioFile(audioFile: Omit<AudioFile, "id" | "createdAt">): Promise<string> {
  const docRef = await addDoc(audioFilesCollection, {
    ...audioFile,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function deleteAudioFile(id: string): Promise<void> {
  const docRef = doc(db, "audioFiles", id);
  await deleteDoc(docRef);
}

// ============ Distribution Logs ============

const distributionLogsCollection = collection(db, "distributionLogs");

export async function getDistributionLogs(limit = 50): Promise<DistributionLog[]> {
  const q = query(distributionLogsCollection, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.slice(0, limit).map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as DistributionLog[];
}

export async function addDistributionLog(log: Omit<DistributionLog, "id" | "createdAt">): Promise<string> {
  const docRef = await addDoc(distributionLogsCollection, {
    ...log,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

// ============ PoE Switches ============

const poeSwitchesCollection = collection(db, "poeSwitches");

export async function getPoESwitches(ownerEmail?: string): Promise<PoESwitch[]> {
  let q = query(poeSwitchesCollection, orderBy("createdAt", "desc"));

  // Filter by owner if provided
  if (ownerEmail) {
    q = query(poeSwitchesCollection, where("ownerEmail", "==", ownerEmail), orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as PoESwitch[];
}

export async function getPoESwitch(id: string): Promise<PoESwitch | null> {
  const docRef = doc(db, "poeSwitches", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as PoESwitch;
}

export async function addPoESwitch(poeSwitch: Omit<PoESwitch, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const now = Timestamp.now();
  const docRef = await addDoc(poeSwitchesCollection, {
    ...poeSwitch,
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
}

export async function updatePoESwitch(id: string, data: Partial<PoESwitch>): Promise<void> {
  const docRef = doc(db, "poeSwitches", id);
  const cleanData: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  }
  await updateDoc(docRef, cleanData);
}

export async function deletePoESwitch(id: string): Promise<void> {
  const docRef = doc(db, "poeSwitches", id);
  await deleteDoc(docRef);
}

// ============ PoE Devices ============

const poeDevicesCollection = collection(db, "poeDevices");

export async function getPoEDevices(ownerEmail?: string): Promise<PoEDevice[]> {
  let q = query(poeDevicesCollection, orderBy("createdAt", "desc"));

  // Filter by owner if provided
  if (ownerEmail) {
    q = query(poeDevicesCollection, where("ownerEmail", "==", ownerEmail), orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as PoEDevice[];
}

export async function getPoEDevice(id: string): Promise<PoEDevice | null> {
  const docRef = doc(db, "poeDevices", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as PoEDevice;
}

export async function addPoEDevice(poeDevice: Omit<PoEDevice, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const now = Timestamp.now();
  const docRef = await addDoc(poeDevicesCollection, {
    ...poeDevice,
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
}

export async function updatePoEDevice(id: string, data: Partial<PoEDevice>): Promise<void> {
  const docRef = doc(db, "poeDevices", id);
  const cleanData: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  }
  await updateDoc(docRef, cleanData);
}

export async function deletePoEDevice(id: string): Promise<void> {
  const docRef = doc(db, "poeDevices", id);
  await deleteDoc(docRef);
}

// ============ Recordings ============

const recordingsCollection = collection(db, "recordings");

export async function getRecordings(userId?: string): Promise<Recording[]> {
  let q = query(recordingsCollection, orderBy("createdAt", "desc"));

  // Filter by user if provided
  if (userId) {
    q = query(recordingsCollection, where("userId", "==", userId), orderBy("createdAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as Recording[];
}

export async function getRecording(id: string): Promise<Recording | null> {
  const docRef = doc(db, "recordings", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as Recording;
}

export async function addRecording(recording: Omit<Recording, "id" | "createdAt"> & { sessionId?: string }): Promise<string> {
  const now = Timestamp.now();

  // Use sessionId as document ID if provided (deterministic, allows retries)
  if (recording.sessionId) {
    const docRef = doc(db, "recordings", recording.sessionId);
    await setDoc(docRef, {
      ...recording,
      createdAt: now,
    }, { merge: true }); // merge: true prevents overwriting if already exists
    return docRef.id;
  }

  // Fallback to auto-generated ID
  const docRef = await addDoc(recordingsCollection, {
    ...recording,
    createdAt: now,
  });
  return docRef.id;
}

export async function deleteRecording(id: string): Promise<void> {
  const docRef = doc(db, "recordings", id);
  await deleteDoc(docRef);
}

// Get recordings grouped by date key
export async function getRecordingsByDateKey(userId: string, dateKey: string): Promise<Recording[]> {
  const q = query(
    recordingsCollection,
    where("userId", "==", userId),
    where("dateKey", "==", dateKey),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as Recording[];
}

// Get all recordings for a specific date range
export async function getRecordingsByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<Recording[]> {
  const q = query(
    recordingsCollection,
    where("userId", "==", userId),
    where("timestamp", ">=", Timestamp.fromDate(startDate)),
    where("timestamp", "<=", Timestamp.fromDate(endDate)),
    orderBy("timestamp", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as Recording[];
}

// Get all unique date keys for a user (for folder organization)
export async function getRecordingDateKeys(userId: string): Promise<string[]> {
  const q = query(
    recordingsCollection,
    where("userId", "==", userId),
    orderBy("dateKey", "desc")
  );

  const snapshot = await getDocs(q);
  const dateKeys = new Set<string>();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.dateKey) {
      dateKeys.add(data.dateKey);
    }
  });

  return Array.from(dateKeys);
}

// ============ Activity Logs ============

const logsCollection = collection(db, "logs");

export interface ActivityLogEntry {
  id?: string;
  timestamp: string;
  dateKey: string;
  type: "audio_detected" | "audio_silent" | "speakers_enabled" | "speakers_disabled" | "volume_change" | "system";
  message: string;
  userId: string;
  userEmail?: string | null;
  audioLevel?: number | null;
  audioThreshold?: number | null;
  speakersEnabled?: boolean | null;
  volume?: number | null;
  recordingUrl?: string | null;
  createdAt?: Date;
}

export async function addActivityLog(
  logEntry: Omit<ActivityLogEntry, "id" | "createdAt">
): Promise<string> {
  const docRef = await addDoc(logsCollection, {
    ...logEntry,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getActivityLogsByDate(
  userId: string,
  dateKey: string
): Promise<ActivityLogEntry[]> {
  const q = query(
    logsCollection,
    where("userId", "==", userId),
    where("dateKey", "==", dateKey),
    orderBy("createdAt", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as ActivityLogEntry[];
}

export async function deleteActivityLogsByDate(
  userId: string,
  dateKey: string
): Promise<void> {
  const q = query(
    logsCollection,
    where("userId", "==", userId),
    where("dateKey", "==", dateKey)
  );
  const snapshot = await getDocs(q);

  const batchSize = 500;
  for (let i = 0; i < snapshot.docs.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = snapshot.docs.slice(i, i + batchSize);
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// ============ Helpers ============

function convertTimestamps(data: DocumentData): DocumentData {
  const result = { ...data };
  for (const key in result) {
    if (result[key] instanceof Timestamp) {
      result[key] = result[key].toDate();
    }
  }
  return result;
}
