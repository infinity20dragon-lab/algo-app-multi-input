import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ipAddress, password, authMethod } = body as {
      ipAddress: string;
      password: string;
      authMethod: AlgoAuthMethod;
    };

    if (!ipAddress || !password) {
      return NextResponse.json(
        { error: "IP address and password are required" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "standard",
    });

    // Play a tone file (chime.wav is standard on Algo devices)
    // mcast: true broadcasts to multicast receivers (speakers)
    await client.playTone({ path: "chime.wav", loop: false, mcast: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Test tone error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to play test tone" },
      { status: 500 }
    );
  }
}
