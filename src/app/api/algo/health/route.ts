import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface HealthCheckRequest {
  devices: Array<{
    id: string;
    ipAddress: string;
    apiPassword: string;
    authMethod: AlgoAuthMethod;
  }>;
  timeout?: number;
}

interface DeviceHealth {
  id: string;
  ipAddress: string;
  isOnline: boolean;
  authValid?: boolean; // true = auth works, false = wrong password, undefined = couldn't check
  responseTime?: number; // milliseconds
  lastChecked: string;
  error?: string;
}

// Check if a single device is reachable and if auth is valid
async function checkDeviceHealth(
  ipAddress: string,
  password: string,
  authMethod: AlgoAuthMethod,
  timeout: number = 3000
): Promise<{
  isOnline: boolean;
  authValid?: boolean;
  responseTime?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    // First, check if device is reachable (basic connectivity)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const pingResponse = await fetch(`http://${ipAddress}`, {
      signal: controller.signal,
      method: "HEAD",
      headers: {
        "User-Agent": "AlgoSound-Health/1.0",
      },
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    // Device is not reachable
    if (!pingResponse.ok && pingResponse.status !== 401) {
      return {
        isOnline: false,
        error: `HTTP ${pingResponse.status}`,
        responseTime,
      };
    }

    // Device is reachable, now test authentication
    try {
      const client = new AlgoClient({
        ipAddress,
        password,
        authMethod,
      });

      // Try to get a simple setting (like device info)
      // This will fail if auth is wrong
      await client.getSetting("info.product");

      // Auth is valid!
      return {
        isOnline: true,
        authValid: true,
        responseTime,
      };
    } catch (authError) {
      // Device is online but auth failed
      return {
        isOnline: true,
        authValid: false,
        responseTime,
        error: "Invalid credentials",
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          isOnline: false,
          responseTime,
          error: "Timeout",
        };
      }
      return {
        isOnline: false,
        error: error.message,
        responseTime,
      };
    }

    return {
      isOnline: false,
      error: "Unknown error",
      responseTime,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: HealthCheckRequest = await request.json();
    const { devices, timeout = 3000 } = body;

    if (!devices || !Array.isArray(devices)) {
      return NextResponse.json(
        { error: "Invalid devices array" },
        { status: 400 }
      );
    }

    console.log(`[Health Check] Checking ${devices.length} devices...`);

    // Check all devices in parallel
    const healthChecks = await Promise.all(
      devices.map(async (device): Promise<DeviceHealth> => {
        const health = await checkDeviceHealth(
          device.ipAddress,
          device.apiPassword,
          device.authMethod,
          timeout
        );

        return {
          id: device.id,
          ipAddress: device.ipAddress,
          isOnline: health.isOnline,
          authValid: health.authValid,
          responseTime: health.responseTime,
          lastChecked: new Date().toISOString(),
          error: health.error,
        };
      })
    );

    const onlineCount = healthChecks.filter((h) => h.isOnline).length;
    const offlineCount = healthChecks.filter((h) => !h.isOnline).length;
    const authIssuesCount = healthChecks.filter(
      (h) => h.isOnline && h.authValid === false
    ).length;

    console.log(
      `[Health Check] Results: ${onlineCount} online, ${offlineCount} offline, ${authIssuesCount} auth issues`
    );

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      totalDevices: devices.length,
      onlineCount,
      offlineCount,
      authIssuesCount,
      devices: healthChecks,
    });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to check devices",
      },
      { status: 500 }
    );
  }
}
