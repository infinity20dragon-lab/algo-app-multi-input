/**
 * PoE Switch Controller Library
 * Handles communication with PoE switches to control port power
 */

import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';

export interface PoESwitchCredentials {
  ipAddress: string;
  password: string;
}

export interface PoEPortConfig {
  portNumber: number; // Physical port 1-8
  enabled: boolean;
}

/**
 * MD5 hash function
 */
function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Merge two strings by interleaving characters (from login.js)
 * Used for Netgear switch password encryption
 */
function merge(str1: string, str2: string): string {
  const arr1 = str1.split('');
  const arr2 = str2.split('');
  let result = '';
  let index1 = 0;
  let index2 = 0;

  while (index1 < arr1.length || index2 < arr2.length) {
    if (index1 < arr1.length) {
      result += arr1[index1];
      index1++;
    }
    if (index2 < arr2.length) {
      result += arr2[index2];
      index2++;
    }
  }

  return result;
}

/**
 * Helper to make HTTP requests using Node's http module
 */
function httpRequest(options: http.RequestOptions, body?: string, timeout: number = 10000): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    });

    // Set timeout
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

/**
 * Netgear GS308EP Controller
 */
export class NetgearGS308EPController {
  private ipAddress: string;
  private password: string;
  private cachedSid: string | null = null;
  private loginInProgress: Promise<string> | null = null;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(credentials: PoESwitchCredentials) {
    this.ipAddress = credentials.ipAddress;
    this.password = credentials.password;
  }

  /**
   * Serialize all requests to the switch — one at a time
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue = this.requestQueue
        .then(() => fn().then(resolve, reject))
        .catch(() => {}); // Keep queue alive even if one request fails
    });
  }

  /**
   * Logout from the switch (frees session slot)
   */
  private async logout(sidCookie: string): Promise<void> {
    try {
      await httpRequest({
        hostname: this.ipAddress,
        port: 80,
        path: '/logout.cgi',
        method: 'GET',
        headers: { 'Cookie': sidCookie },
      }, undefined, 3000);
    } catch {
      // Ignore logout errors — best effort
    }
  }

  /**
   * Clear cached session with logout (frees session on the switch)
   */
  async clearSession(): Promise<void> {
    if (this.cachedSid) {
      await this.logout(this.cachedSid);
    }
    this.cachedSid = null;
    this.loginInProgress = null;
  }

  /**
   * Update credentials (if password changed in UI). Clears session if password differs.
   */
  updateCredentials(credentials: PoESwitchCredentials): void {
    if (this.password !== credentials.password || this.ipAddress !== credentials.ipAddress) {
      // Logout old session in background (don't await — fire and forget)
      if (this.cachedSid) {
        this.logout(this.cachedSid).catch(() => {});
      }
      this.ipAddress = credentials.ipAddress;
      this.password = credentials.password;
      this.cachedSid = null;
      this.loginInProgress = null;
    }
  }

  /**
   * Get the rand value and initial SID cookie from the login page
   */
  private async getLoginPageData(): Promise<{ rand: string; initialSid: string | null }> {
    const response = await httpRequest({
      hostname: this.ipAddress,
      port: 80,
      path: '/login.cgi',
      method: 'GET',
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch login page: ${response.statusCode}`);
    }

    // Extract rand from HTML: <input type=hidden id='rand' value='374961091' disabled>
    const randMatch = response.body.match(/id='rand'\s+value='([^']+)'/);
    if (!randMatch) {
      throw new Error('Rand value not found in login page');
    }

    // Capture the initial SID cookie (needed for the POST)
    let initialSid: string | null = null;
    const cookies = response.headers['set-cookie'];
    if (cookies) {
      const sidMatch = cookies.join(';').match(/SID=([^;]+)/);
      if (sidMatch) {
        initialSid = `SID=${sidMatch[1]}`;
      }
    }

    return { rand: randMatch[1], initialSid };
  }

  /**
   * Login to the switch and get SID cookie (with session caching)
   */
  private async login(): Promise<string> {
    // Return cached session if available
    if (this.cachedSid) {
      return this.cachedSid;
    }

    // If a login is already in progress, wait for it (prevents concurrent logins)
    if (this.loginInProgress) {
      return this.loginInProgress;
    }

    this.loginInProgress = this.performLogin();
    try {
      const sid = await this.loginInProgress;
      this.cachedSid = sid;
      return sid;
    } finally {
      this.loginInProgress = null;
    }
  }

  /**
   * Perform the actual login (called only once, results are cached)
   */
  private async performLogin(): Promise<string> {
    console.log(`[PoE] Performing fresh login to ${this.ipAddress}...`);

    // Get rand value and initial SID from login page
    const { rand, initialSid } = await this.getLoginPageData();
    console.log(`[PoE] Got rand value, initial SID: ${initialSid ? 'yes' : 'no'}`);

    // Small delay — switch uses Connection: close, needs time between connections
    await new Promise(resolve => setTimeout(resolve, 500));

    // Merge password with rand, then hash
    const merged = merge(this.password, rand);
    const hashedPassword = md5(merged);

    const postData = `password=${hashedPassword}`;

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
      'Origin': `http://${this.ipAddress}`,
      'Referer': `http://${this.ipAddress}/login.cgi`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    };

    // Send the initial SID cookie with the POST (same as browser behavior)
    if (initialSid) {
      headers['Cookie'] = initialSid;
    }

    const response = await httpRequest({
      hostname: this.ipAddress,
      port: 80,
      path: '/login.cgi',
      method: 'POST',
      headers,
    }, postData);

    if (response.statusCode !== 200) {
      throw new Error(`Login failed: ${response.statusCode}`);
    }

    // Extract SID cookie
    const cookies = response.headers['set-cookie'];
    if (!cookies) {
      // Log response body to understand why login failed
      const bodySnippet = response.body.substring(0, 200);
      console.error(`[PoE] Login POST returned no cookies. Status: ${response.statusCode}, Body: ${bodySnippet}`);
      throw new Error(`No cookies received from login (body: ${bodySnippet})`);
    }

    const sidMatch = cookies.join(';').match(/SID=([^;]+)/);
    if (!sidMatch) {
      throw new Error('SID cookie not found');
    }

    return `SID=${sidMatch[1]}`;
  }

  /**
   * Get hash token from PoE config page
   */
  private async getHashToken(sidCookie: string): Promise<string> {
    const response = await httpRequest({
      hostname: this.ipAddress,
      port: 80,
      path: '/PoEPortConfig.cgi',
      method: 'GET',
      headers: {
        'Cookie': sidCookie,
      },
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to get PoE config page: ${response.statusCode}`);
    }

    // Extract hash from HTML: <input type=hidden name='hash' id='hash' value="...">
    const hashMatch = response.body.match(/name='hash'[^>]*value="([^"]+)"/);
    if (!hashMatch) {
      throw new Error('Hash token not found in HTML');
    }

    return hashMatch[1];
  }

  /**
   * Toggle a PoE port on or off (with automatic session retry)
   */
  async togglePort(portNumber: number, enabled: boolean): Promise<void> {
    // Validate port number
    if (portNumber < 1 || portNumber > 8) {
      throw new Error(`Invalid port number: ${portNumber}. Must be 1-8.`);
    }

    // All requests to this switch are serialized through the queue
    return this.enqueue(async () => {
      try {
        await this.doTogglePort(portNumber, enabled);
      } catch (error) {
        console.error(`[PoE] Toggle port ${portNumber} failed:`, error instanceof Error ? error.message : error);

        // Session might have expired — logout and retry once
        if (this.cachedSid) {
          await this.logout(this.cachedSid);
        }
        this.cachedSid = null;
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`[PoE] Retrying port ${portNumber}...`);
        await this.doTogglePort(portNumber, enabled);
      }
    });
  }

  private async doTogglePort(portNumber: number, enabled: boolean): Promise<void> {
    // Login to get SID cookie (uses cache if available)
    const sidCookie = await this.login();

    // Get hash token
    const hash = await this.getHashToken(sidCookie);

    // Port number is 0-indexed in the API (physical port 1 = portID 0)
    const portID = portNumber - 1;

    // Build form data
    const formData = new URLSearchParams({
      hash: hash,
      ACTION: 'Apply',
      portID: portID.toString(),
      ADMIN_MODE: enabled ? '1' : '0', // 1 = Enable, 0 = Disable
      PORT_PRIO: '0',
      POW_MOD: '3',
      POW_LIMT_TYP: '2',
      POW_LIMT: '30.0',
      DETEC_TYP: '2',
      DISCONNECT_TYP: '2',
    });

    const postData = formData.toString();

    const response = await httpRequest({
      hostname: this.ipAddress,
      port: 80,
      path: '/PoEPortConfig.cgi',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': sidCookie,
        'X-Requested-With': 'XMLHttpRequest',
      },
    }, postData);

    if (response.statusCode !== 200) {
      throw new Error(`Failed to toggle port: ${response.statusCode}`);
    }
  }

  /**
   * Toggle multiple ports sequentially with a single session
   */
  async togglePorts(ports: PoEPortConfig[]): Promise<void> {
    if (ports.length === 0) return;

    return this.enqueue(async () => {
    // Login once
    const sidCookie = await this.login();

    for (const port of ports) {
      if (port.portNumber < 1 || port.portNumber > 8) continue;

      // Get fresh hash token for each toggle (switch requires it)
      const hash = await this.getHashToken(sidCookie);
      const portID = port.portNumber - 1;

      const formData = new URLSearchParams({
        hash: hash,
        ACTION: 'Apply',
        portID: portID.toString(),
        ADMIN_MODE: port.enabled ? '1' : '0',
        PORT_PRIO: '0',
        POW_MOD: '3',
        POW_LIMT_TYP: '2',
        POW_LIMT: '30.0',
        DETEC_TYP: '2',
        DISCONNECT_TYP: '2',
      });

      const postData = formData.toString();

      const response = await httpRequest({
        hostname: this.ipAddress,
        port: 80,
        path: '/PoEPortConfig.cgi',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Cookie': sidCookie,
          'X-Requested-With': 'XMLHttpRequest',
        },
      }, postData);

      if (response.statusCode !== 200) {
        throw new Error(`Failed to toggle port ${port.portNumber}: ${response.statusCode}`);
      }
    }
    }); // end enqueue
  }

  /**
   * Toggle multiple ports in TRUE parallel — bypasses the serialization queue.
   * Each port gets its own hash fetch + toggle POST fired concurrently.
   * This is fast but may overwhelm cheap switches; use only when DoS prevention is off.
   */
  async togglePortsParallel(ports: PoEPortConfig[]): Promise<Array<{ port: number; success: boolean; error?: string }>> {
    if (ports.length === 0) return [];

    // Login once (shared session)
    const sidCookie = await this.login();

    // Fire all toggles concurrently — no queue, no serialization
    const results = await Promise.allSettled(
      ports.map(async (port) => {
        if (port.portNumber < 1 || port.portNumber > 8) {
          throw new Error(`Invalid port: ${port.portNumber}`);
        }

        // Each port: fetch its own hash token, then POST toggle
        const hash = await this.getHashToken(sidCookie);
        const portID = port.portNumber - 1;

        const formData = new URLSearchParams({
          hash: hash,
          ACTION: 'Apply',
          portID: portID.toString(),
          ADMIN_MODE: port.enabled ? '1' : '0',
          PORT_PRIO: '0',
          POW_MOD: '3',
          POW_LIMT_TYP: '2',
          POW_LIMT: '30.0',
          DETEC_TYP: '2',
          DISCONNECT_TYP: '2',
        });

        const postData = formData.toString();

        const response = await httpRequest({
          hostname: this.ipAddress,
          port: 80,
          path: '/PoEPortConfig.cgi',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Cookie': sidCookie,
            'X-Requested-With': 'XMLHttpRequest',
          },
        }, postData);

        if (response.statusCode !== 200) {
          throw new Error(`Failed to toggle port ${port.portNumber}: ${response.statusCode}`);
        }

        return port.portNumber;
      })
    );

    return results.map((r, i) => ({
      port: ports[i].portNumber,
      success: r.status === 'fulfilled',
      error: r.status === 'rejected' ? (r.reason as Error)?.message : undefined,
    }));
  }

  /**
   * Enable a PoE port
   */
  async enablePort(portNumber: number): Promise<void> {
    return this.togglePort(portNumber, true);
  }

  /**
   * Disable a PoE port
   */
  async disablePort(portNumber: number): Promise<void> {
    return this.togglePort(portNumber, false);
  }

  /**
   * Get status of all PoE ports
   */
  async getPortStatuses(): Promise<Array<{ port: number; enabled: boolean }>> {
    return this.enqueue(async () => {
    // Login to get SID cookie
    const sidCookie = await this.login();

    // Get PoE config page
    const response = await httpRequest({
      hostname: this.ipAddress,
      port: 80,
      path: '/PoEPortConfig.cgi',
      method: 'GET',
      headers: {
        'Cookie': sidCookie,
      },
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to get PoE config page: ${response.statusCode}`);
    }

    // Parse HTML to extract port statuses
    // Look for patterns like: <input type="hidden" class="port" value="2"> and <input type="hidden" class="hidPortPwr" id="hidPortPwr" value="0">
    const portStatuses: Array<{ port: number; enabled: boolean }> = [];

    // Find all port list items
    const portMatches = response.body.matchAll(/<li class="poe_port_list_item[^>]*>[\s\S]*?<input type="hidden" class="port" value="(\d+)"[\s\S]*?<input type="hidden" class="hidPortPwr"[^>]*value="(\d+)"/g);

    for (const match of portMatches) {
      const portNumber = parseInt(match[1]);
      const enabled = match[2] === '1'; // 1 = enabled, 0 = disabled

      portStatuses.push({
        port: portNumber,
        enabled: enabled,
      });
    }

    // Sort by port number
    portStatuses.sort((a, b) => a.port - b.port);

    return portStatuses;
    }); // end enqueue
  }

  /**
   * Get status of a specific port
   */
  async getPortStatus(portNumber: number): Promise<boolean> {
    const statuses = await this.getPortStatuses();
    const portStatus = statuses.find(s => s.port === portNumber);
    if (!portStatus) {
      throw new Error(`Port ${portNumber} not found`);
    }
    return portStatus.enabled;
  }

  /**
   * Test connection to the switch
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getLoginPageData();
      return true;
    } catch (error) {
      console.error('Switch connection test failed:', error);
      return false;
    }
  }
}

/**
 * Shared controller cache — one instance per switch IP, reuses sessions
 */
const controllerCache = new Map<string, NetgearGS308EPController>();

/**
 * Factory function to create (or reuse) a controller for any PoE switch type.
 * Controllers are cached by IP so all API calls share the same session.
 */
export function createPoEController(type: string, credentials: PoESwitchCredentials) {
  const cacheKey = `${type}:${credentials.ipAddress}`;

  const existing = controllerCache.get(cacheKey);
  if (existing) {
    // Update credentials if they changed (e.g. password updated in UI)
    existing.updateCredentials(credentials);
    return existing;
  }

  let controller: NetgearGS308EPController;
  switch (type) {
    case 'netgear_gs308ep':
      controller = new NetgearGS308EPController(credentials);
      break;
    default:
      throw new Error(`Unsupported PoE switch type: ${type}`);
  }

  controllerCache.set(cacheKey, controller);
  return controller;
}

/**
 * Clear all cached controller sessions with logout (call on monitoring stop)
 */
export async function clearAllPoESessions(): Promise<void> {
  const logouts = Array.from(controllerCache.values()).map(c => c.clearSession());
  await Promise.allSettled(logouts);
}
