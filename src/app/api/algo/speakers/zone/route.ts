import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface PagingZoneRequest {
  ipAddress: string;
  password: string;
  authMethod?: AlgoAuthMethod;
  zone: number; // 1-50
}

export async function POST(request: NextRequest) {
  try {
    const body: PagingZoneRequest = await request.json();
    const { ipAddress, password, authMethod, zone } = body;

    if (!ipAddress || !password || zone === undefined) {
      return NextResponse.json(
        { error: "ipAddress, password, and zone are required" },
        { status: 400 }
      );
    }

    if (zone < 1 || zone > 50) {
      return NextResponse.json(
        { error: "Zone must be between 1 and 50" },
        { status: 400 }
      );
    }

    // Use AlgoClient to set the zone - simple!
    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "basic",
    });

    await client.setSetting({ "mcast.tx.fixed": String(zone) });

    // CRITICAL: Reload device to apply the zone change
    // Without this, device gets stuck in desync state
    await client.reload();

    console.log(`[Zone API] ✓ Changed paging zone to ${zone} for ${ipAddress}`);

    return NextResponse.json({
      success: true,
      ipAddress,
      zone,
      message: `Paging device set to transmit on zone ${zone}`,
    });
  } catch (error) {
    console.error("Paging zone control error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to change paging zone" },
      { status: 500 }
    );
  }
}
