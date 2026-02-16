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
      authMethod: authMethod || "basic",
    });

    const toneList = await client.getToneList();

    return NextResponse.json({
      success: true,
      tones: toneList.tonelist
    });
  } catch (error) {
    console.error("Get tones error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get tones" },
      { status: 500 }
    );
  }
}
