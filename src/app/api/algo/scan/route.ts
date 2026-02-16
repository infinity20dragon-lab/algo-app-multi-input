import { NextRequest, NextResponse } from "next/server";
import { networkInterfaces } from "os";

interface DiscoveredDevice {
  ipAddress: string;
  model: string;
  type: "8301" | "8180" | "8188" | "unknown";
  name?: string;
  reachable: boolean;
}

interface ScanRequest {
  networkRange?: string; // e.g., "192.168.68"
  timeout?: number; // milliseconds per IP
}

// Detect Algo device by fetching its web interface
async function detectAlgoDevice(
  ipAddress: string,
  timeout: number = 2000
): Promise<DiscoveredDevice | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`http://${ipAddress}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AlgoSound-Scanner/1.0",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Check for Algo device signatures
    const isAlgo =
      html.includes("Algo") ||
      html.includes("8301") ||
      html.includes("8180") ||
      html.includes("8188") ||
      html.includes("IP Paging") ||
      html.includes("IP Speaker");

    if (!isAlgo) {
      return null;
    }

    // Detect model type
    let type: "8301" | "8180" | "8188" | "unknown" = "unknown";
    let model = "Unknown Algo Device";

    if (html.includes("8301") || html.includes("IP Paging Adapter")) {
      type = "8301";
      model = "Algo 8301 IP Paging Adapter";
    } else if (html.includes("8180") || html.includes("IP Speaker")) {
      type = "8180";
      model = "Algo 8180 IP Speaker";
    } else if (html.includes("8188")) {
      type = "8188";
      model = "Algo 8188 IP Speaker";
    }

    // Try to extract device name from title
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const name = titleMatch ? titleMatch[1].trim() : undefined;

    return {
      ipAddress,
      model,
      type,
      name,
      reachable: true,
    };
  } catch (error) {
    // Timeout, network error, or not reachable
    return null;
  }
}

// Get the local network range from network interfaces
function getLocalNetworkRange(): string {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;

    for (const net of netInfo) {
      // Skip internal and non-IPv4 addresses
      if (net.family === "IPv4" && !net.internal) {
        // Extract network prefix (e.g., "192.168.68" from "192.168.68.100")
        const parts = net.address.split(".");
        return `${parts[0]}.${parts[1]}.${parts[2]}`;
      }
    }
  }

  // Default fallback
  return "192.168.1";
}

// Scan a range of IPs in parallel (with concurrency limit)
async function scanNetwork(
  networkRange: string,
  timeout: number
): Promise<DiscoveredDevice[]> {
  const devices: DiscoveredDevice[] = [];
  const CONCURRENCY = 20; // Scan 20 IPs at a time

  // Generate all IPs to scan (1-254)
  const ipsToScan: string[] = [];
  for (let i = 1; i <= 254; i++) {
    ipsToScan.push(`${networkRange}.${i}`);
  }

  // Scan in chunks to avoid overwhelming the network
  for (let i = 0; i < ipsToScan.length; i += CONCURRENCY) {
    const chunk = ipsToScan.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((ip) => detectAlgoDevice(ip, timeout))
    );

    // Add found devices
    results.forEach((device) => {
      if (device) {
        devices.push(device);
      }
    });
  }

  return devices;
}

export async function POST(request: NextRequest) {
  try {
    const body: ScanRequest = await request.json().catch(() => ({}));

    const networkRange = body.networkRange || getLocalNetworkRange();
    const timeout = body.timeout || 2000;

    console.log(`[Scan] Scanning network: ${networkRange}.0/24`);

    const devices = await scanNetwork(networkRange, timeout);

    console.log(`[Scan] Found ${devices.length} Algo devices`);

    return NextResponse.json({
      success: true,
      networkRange: `${networkRange}.0/24`,
      devicesFound: devices.length,
      devices,
    });
  } catch (error) {
    console.error("Network scan error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to scan network",
      },
      { status: 500 }
    );
  }
}
