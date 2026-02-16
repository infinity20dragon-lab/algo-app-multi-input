import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface SettingsRequest {
  ipAddress: string;
  password: string;
  authMethod: AlgoAuthMethod;
  settings: Record<string, string>;
}

export async function POST(request: NextRequest) {
  let ipAddress = "unknown";

  try {
    const body: SettingsRequest = await request.json();
    ipAddress = body.ipAddress;
    const { password, authMethod, settings } = body;

    if (!ipAddress || !password || !settings) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "standard",
    });

    await client.setSetting(settings);

    return NextResponse.json({ success: true });
  } catch (error) {
    // Provide more context about the error
    let errorMessage = "Failed to update settings";

    if (error instanceof Error) {
      // Check for common network errors
      if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
        errorMessage = `Device unreachable at ${ipAddress} - check if device is online and on the same network`;
      } else if (error.message.includes("ETIMEDOUT") || error.message.includes("timeout")) {
        errorMessage = `Connection timeout to ${ipAddress} - device may be slow or offline`;
      } else if (error.message.includes("EHOSTUNREACH")) {
        errorMessage = `Host unreachable at ${ipAddress} - check network connectivity`;
      } else {
        errorMessage = error.message;
      }
    }

    // Only log in development to reduce noise
    if (process.env.NODE_ENV === "development") {
      console.error(`[Settings API] Error for ${ipAddress}:`, error);
    }

    return NextResponse.json(
      { error: errorMessage, ip: ipAddress },
      { status: 500 }
    );
  }
}
