import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface ReloadRequest {
  ipAddress: string;
  password: string;
  authMethod?: AlgoAuthMethod;
}

export async function POST(request: NextRequest) {
  try {
    const body: ReloadRequest = await request.json();
    const { ipAddress, password, authMethod } = body;

    if (!ipAddress || !password) {
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

    await client.reload();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Reload API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reload device" },
      { status: 500 }
    );
  }
}
