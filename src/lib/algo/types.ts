// Algo Device Types
export type AlgoDeviceType = "8301" | "8180g2" | "8198" | "8128" | "8138" | "other";
export type AlgoAuthMethod = "standard" | "basic" | "none";

export interface AlgoDevice {
  id: string;
  name: string;
  type: AlgoDeviceType;
  ipAddress: string;
  authMethod: AlgoAuthMethod;
  apiPassword: string;
  ownerEmail: string; // User who owns this device
  zone: string | null; // Zone ID this device is assigned to, or null if unassigned
  volume: number; // Default/initial volume
  maxVolume?: number; // Maximum volume this speaker can reach (0-100, default 100)
  isOnline: boolean;
  authValid?: boolean; // true = auth works, false = wrong password/auth
  lastSeen: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // For paging devices (8301): IDs of linked speakers to auto-enable/disable
  linkedSpeakerIds?: string[];
  // Multi-input routing: which input channel this speaker listens to
  inputAssignment?: "medical" | "fire" | "allCall" | null;
}

// Algo API Response Types
export interface AlgoAboutResponse {
  "Product Name": string;
  "Firmware Version": string;
  "MAC Address": string;
  "Hardware Info"?: string;
  "Manufacturer Certificate"?: string;
}

export interface AlgoStatusResponse {
  "Device Name": string;
  "SIP Registration": string;
  "Call Status": string;
  "Provisioning Status"?: string;
  MAC: string;
  IPv4: string;
  IPv6?: string;
  "Switch Port ID"?: string;
  "Date / Time": string;
  "Current Action": string;
  "Multicast Mode": string;
  Volume: string;
  "Relay Input Status"?: string;
  Temperature?: string;
}

export interface AlgoToneListResponse {
  tonelist: string[];
}

export interface AlgoSettingResponse {
  [key: string]: string;
}

// API Request Types
export interface AlgoToneStartRequest {
  path: string;
  loop: boolean;
  mcast?: boolean;
  playback?: boolean;
  state?: {
    mode: "sender";
    address: string;
    port: string;
    type: "rtp" | "poly";
    group?: number;
  };
}

export interface AlgoCallStartRequest {
  extension: string;
  tone?: string;
  interval?: string;
  maxdur?: string;
}

export interface AlgoDoorControlRequest {
  doorid: "netdc1" | "local";
  duration?: string;
}

export interface AlgoStrobeStartRequest {
  pattern: number;
  color1: "red" | "blue" | "green" | "amber";
  color2?: "red" | "blue" | "green" | "amber";
  ledlvl: string;
}

// Multicast Configuration
export interface AlgoMulticastConfig {
  mode: "sender" | "receiver";
  address: string;
  port: string;
  type: "rtp" | "poly";
  group?: number;
}

// Zone Type
export interface Zone {
  id: string;
  name: string;
  color: string;
  deviceIds: string[];
  ownerEmail: string; // User who owns this zone
  slug?: string;
  defaultVolume?: number;
  createdAt: Date;
  updatedAt?: Date;
}

// Zone Routing Configuration (stored separately)
export interface ZoneRouting {
  id: string; // same as zone id
  zoneId: string;
  fire: boolean;
  medical: boolean;
  allCall: boolean;
  updatedAt?: Date;
}

// Audio File Type
export interface AudioFile {
  id: string;
  name: string;
  filename: string;
  storageUrl: string;
  duration: number;
  fileSize: number;
  uploadedBy: string;
  ownerEmail: string; // User who owns this audio file
  createdAt: Date;
}

// Distribution Log Type
export interface DistributionLog {
  id: string;
  audioFileId: string;
  audioFileName: string;
  targetDevices: string[];
  targetZones: string[];
  triggeredBy: string;
  status: "success" | "partial" | "failed";
  results: Array<{
    deviceId: string;
    deviceName: string;
    success: boolean;
    error?: string;
  }>;
  createdAt: Date;
}

// Multi-Input Channel Type
export type InputChannelType = "medical" | "fire" | "allCall";

export interface InputChannel {
  type: InputChannelType;
  deviceId: string | null; // Which audio input device to use
  isActive: boolean; // Is this channel currently receiving audio
  audioLevel: number; // Current audio level (0-100)
}

// PoE-Controlled Device Types
export type PoEDeviceMode = "always_on" | "auto" | "always_off";
export type PoESwitchType = "netgear_gs308ep" | "other";

export interface PoESwitch {
  id: string;
  name: string;
  type: PoESwitchType;
  ipAddress: string;
  password: string;
  ownerEmail: string; // User who owns this switch
  isOnline: boolean;
  lastSeen: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PoEDevice {
  id: string;
  name: string;
  switchId: string; // Which PoE switch controls this device
  portNumber: number; // Physical port number (1-8)
  mode: PoEDeviceMode; // always_on, auto, always_off
  ownerEmail: string; // User who owns this device
  zone: string | null; // Zone assignment (like speakers)
  linkedPagingDeviceIds?: string[]; // IDs of paging devices (8301) that control this PoE device
  inputAssignment?: InputChannelType | null; // Which input channel triggers this (medical/fire/allCall)
  isEnabled: boolean; // Current power state
  isOnline: boolean; // Is the switch reachable
  lastToggled: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Recording Metadata (stored in Firestore for fast access)
export interface Recording {
  id: string;
  userId: string; // User ID who made the recording
  userEmail: string; // User email (for display)
  filename: string; // Original filename (e.g., recording-2026-02-02_10-30-45-AM.webm)
  storageUrl: string; // Firebase Storage download URL
  storagePath: string; // Storage path (e.g., recordings/{userId}/{filename})
  size: number; // File size in bytes
  duration?: number; // Duration in seconds (if available)
  mimeType: string; // e.g., audio/webm;codecs=opus
  timestamp: Date; // When the recording was created (PST)
  dateKey: string; // Date key for grouping (e.g., "2026-02-02")
  createdAt: Date; // Firestore timestamp
}
