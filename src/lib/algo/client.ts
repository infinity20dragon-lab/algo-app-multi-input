import crypto from "crypto";
import type {
  AlgoAuthMethod,
  AlgoAboutResponse,
  AlgoStatusResponse,
  AlgoToneListResponse,
  AlgoToneStartRequest,
} from "./types";

interface AlgoRequestConfig {
  deviceIp: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  uri: string;
  body?: object;
  password: string;
  authMethod: AlgoAuthMethod;
}

interface AlgoClientOptions {
  ipAddress: string;
  password: string;
  authMethod: AlgoAuthMethod;
  useHttps?: boolean;
}

/**
 * Generate HMAC-SHA256 authentication headers for Algo Standard auth
 */
function generateStandardAuthHeaders(
  method: string,
  uri: string,
  body: object | undefined,
  password: string
): HeadersInit {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomInt(100000, 999999999).toString();
  const headers: HeadersInit = {};

  let hmacInput: string;

  if (body) {
    const bodyString = JSON.stringify(body);
    const contentMd5 = crypto.createHash("md5").update(bodyString).digest("hex");
    hmacInput = `${method}:${uri}:${contentMd5}:application/json:${timestamp}:${nonce}`;
    headers["Content-Type"] = "application/json";
    headers["Content-MD5"] = contentMd5;
  } else {
    hmacInput = `${method}:${uri}:${timestamp}:${nonce}`;
  }

  const hmacKey = crypto
    .createHmac("sha256", password)
    .update(hmacInput)
    .digest("hex");

  headers["Authorization"] = `hmac admin:${nonce}:${hmacKey}`;
  headers["Date"] = new Date().toUTCString();

  return headers;
}

/**
 * Generate Basic authentication headers
 */
function generateBasicAuthHeaders(password: string): HeadersInit {
  const credentials = Buffer.from(`admin:${password}`).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/json",
  };
}

/**
 * Algo API Client - handles communication with Algo IP endpoints
 */
export class AlgoClient {
  private ipAddress: string;
  private password: string;
  private authMethod: AlgoAuthMethod;
  private baseUrl: string;

  constructor(options: AlgoClientOptions) {
    this.ipAddress = options.ipAddress;
    this.password = options.password;
    this.authMethod = options.authMethod;
    // Use HTTP by default to avoid self-signed cert issues
    const protocol = options.useHttps === true ? "https" : "http";
    this.baseUrl = `${protocol}://${this.ipAddress}`;
  }

  /**
   * Make an authenticated request to the Algo device
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    uri: string,
    body?: object
  ): Promise<T> {
    let headers: HeadersInit;

    switch (this.authMethod) {
      case "standard":
        headers = generateStandardAuthHeaders(method, uri, body, this.password);
        break;
      case "basic":
        headers = generateBasicAuthHeaders(this.password);
        break;
      case "none":
      default:
        headers = { "Content-Type": "application/json" };
        break;
    }

    const url = `${this.baseUrl}${uri}`;
    const options: RequestInit = {
      method,
      headers,
      // Skip SSL verification for self-signed certs (common on Algo devices)
      // Note: In production, you'd want proper SSL handling
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`Algo API error: ${response.status} ${response.statusText}`);
    }

    // Some endpoints return no content
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  // ============ Device Information ============

  /**
   * Get device About information
   */
  async getAbout(): Promise<AlgoAboutResponse> {
    return this.request<AlgoAboutResponse>("GET", "/api/info/about");
  }

  /**
   * Get device Status information
   */
  async getStatus(): Promise<AlgoStatusResponse> {
    return this.request<AlgoStatusResponse>("GET", "/api/info/status");
  }

  /**
   * Get list of tone files on the device
   */
  async getToneList(): Promise<AlgoToneListResponse> {
    return this.request<AlgoToneListResponse>("GET", "/api/info/tonelist");
  }

  /**
   * Get a specific setting value
   */
  async getSetting(parameterName: string): Promise<Record<string, string>> {
    return this.request<Record<string, string>>("GET", `/api/settings/${parameterName}`);
  }

  /**
   * Set a specific setting value
   */
  async setSetting(settings: Record<string, string>): Promise<void> {
    await this.request<void>("PUT", "/api/settings", settings);
  }

  // ============ Audio Control ============

  /**
   * Play a tone file
   */
  async playTone(options: AlgoToneStartRequest): Promise<void> {
    await this.request<void>("POST", "/api/controls/tone/start", options);
  }

  /**
   * Stop playing tone
   */
  async stopTone(): Promise<void> {
    await this.request<void>("POST", "/api/controls/tone/stop");
  }

  /**
   * Play test tone
   */
  async playTestTone(): Promise<void> {
    await this.request<void>("POST", "/api/controls/test/start");
  }

  /**
   * Loop test tone
   */
  async loopTestTone(): Promise<void> {
    await this.request<void>("POST", "/api/controls/test/loop");
  }

  /**
   * Stop test tone
   */
  async stopTestTone(): Promise<void> {
    await this.request<void>("POST", "/api/controls/test/stop");
  }

  /**
   * Get ambient noise level
   */
  async getNoiseLevel(): Promise<{ "audio.noise.level": string }> {
    return this.request<{ "audio.noise.level": string }>("GET", "/api/info/audio.noise.level");
  }

  /**
   * Set ambient noise level
   */
  async setNoiseLevel(level: string): Promise<void> {
    await this.request<void>("POST", "/api/controls/noise/update", { level });
  }

  // ============ Device Management ============

  /**
   * Reboot the device
   */
  async reboot(): Promise<void> {
    await this.request<void>("POST", "/api/controls/reboot");
  }

  /**
   * Restart main application process
   */
  async reload(): Promise<void> {
    await this.request<void>("POST", "/api/controls/reload");
  }

  /**
   * Check for firmware updates
   */
  async checkFirmware(): Promise<{ version: string }> {
    return this.request<{ version: string }>("POST", "/api/controls/upgrade/check");
  }

  /**
   * Restore factory defaults
   */
  async factoryReset(): Promise<void> {
    await this.request<void>("POST", "/api/settings/action/restore");
  }

  // ============ File Management ============

  /**
   * Get list of files in a folder
   */
  async getFileList(folder: string): Promise<{ filelist: string[] }> {
    return this.request<{ filelist: string[] }>("GET", `/api/files/${folder}`);
  }

  /**
   * Upload a file to the device
   */
  async uploadFile(folder: string, filename: string, data: Buffer): Promise<void> {
    const uri = `/api/files/${folder}/${filename}`;
    const url = `${this.baseUrl}${uri}`;

    let headers: HeadersInit;

    if (this.authMethod === "basic") {
      const credentials = Buffer.from(`admin:${this.password}`).toString("base64");
      headers = {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/octet-stream",
      };
    } else {
      // For standard auth with binary data, we need different HMAC calculation
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = crypto.randomInt(100000, 999999999).toString();
      const contentMd5 = crypto.createHash("md5").update(data).digest("hex");
      const hmacInput = `PUT:${uri}:${contentMd5}:application/octet-stream:${timestamp}:${nonce}`;
      const hmacKey = crypto
        .createHmac("sha256", this.password)
        .update(hmacInput)
        .digest("hex");

      headers = {
        Authorization: `hmac admin:${nonce}:${hmacKey}`,
        Date: new Date().toUTCString(),
        "Content-Type": "application/octet-stream",
        "Content-MD5": contentMd5,
      };
    }

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(data),
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Delete a file from the device
   */
  async deleteFile(filepath: string): Promise<void> {
    await this.request<void>("DELETE", "/api/files/", { path: filepath });
  }

  // ============ Multicast Control ============

  /**
   * Update multicast settings
   */
  async updateMulticast(config: {
    mode: "sender";
    address: string;
    port: string;
    type: "rtp" | "poly";
    group?: number;
  }): Promise<void> {
    await this.request<void>("POST", "/api/state/mcast/update/", config);
  }

  // ============ Call Control ============

  /**
   * Start a call with optional tone
   */
  async startCall(options: {
    extension: string;
    tone?: string;
    interval?: string;
    maxdur?: string;
  }): Promise<void> {
    await this.request<void>("POST", "/api/controls/call/start", options);
  }

  /**
   * Stop an active call
   */
  async stopCall(): Promise<void> {
    await this.request<void>("POST", "/api/controls/call/stop");
  }

  // ============ Relay Control ============

  /**
   * Get relay input status
   */
  async getRelayStatus(): Promise<{ "input.relay.status": string }> {
    return this.request<{ "input.relay.status": string }>("GET", "/api/info/input.relay.status");
  }

  // ============ Door Control ============

  /**
   * Unlock door
   */
  async unlockDoor(doorId: "local" | "netdc1"): Promise<void> {
    await this.request<void>("POST", "/api/controls/door/unlock", { doorid: doorId });
  }

  /**
   * Lock door
   */
  async lockDoor(doorId: "local" | "netdc1"): Promise<void> {
    await this.request<void>("POST", "/api/controls/door/lock", { doorid: doorId });
  }

  /**
   * Momentarily unlock door
   */
  async momentaryUnlock(doorId: "local" | "netdc1", duration: string): Promise<void> {
    await this.request<void>("POST", "/api/controls/door/munlock", {
      doorid: doorId,
      duration,
    });
  }

  // ============ Strobe Control ============

  /**
   * Start strobe light
   */
  async startStrobe(options: {
    pattern: number;
    color1: "red" | "blue" | "green" | "amber";
    color2?: "red" | "blue" | "green" | "amber";
    ledlvl: string;
  }): Promise<void> {
    await this.request<void>("POST", "/api/controls/strobe/start", options);
  }

  /**
   * Stop strobe light
   */
  async stopStrobe(): Promise<void> {
    await this.request<void>("POST", "/api/controls/strobe/stop");
  }

  // ============ Audio Streaming ============

  /**
   * Start listening to audio stream
   */
  async startRx(port: string): Promise<void> {
    await this.request<void>("POST", "/api/controls/rx/start", { port });
  }

  /**
   * Stop listening to audio stream
   */
  async stopRx(): Promise<void> {
    await this.request<void>("POST", "/api/controls/rx/stop");
  }
}

/**
 * Create an Algo client instance
 */
export function createAlgoClient(options: AlgoClientOptions): AlgoClient {
  return new AlgoClient(options);
}

/**
 * Test connection to an Algo device
 */
export async function testAlgoConnection(
  ipAddress: string,
  password: string,
  authMethod: AlgoAuthMethod
): Promise<{ success: boolean; deviceInfo?: AlgoAboutResponse; error?: string }> {
  try {
    const client = new AlgoClient({ ipAddress, password, authMethod });
    const aboutInfo = await client.getAbout();
    return { success: true, deviceInfo: aboutInfo };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
