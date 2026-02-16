import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface GetSettingRequest {
  ipAddress: string;
  password: string;
  authMethod: AlgoAuthMethod;
  setting: string; // e.g. "mcast.mode"
}

export async function POST(request: NextRequest) {
  let requestBody: GetSettingRequest | null = null;

  try {
    const body: GetSettingRequest = await request.json();
    requestBody = body;
    const { ipAddress, password, authMethod, setting } = body;

    if (!ipAddress || !password || !setting) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "basic",
    });

    const result = await client.getSetting(setting);

    return NextResponse.json({
      success: true,
      value: result[setting],
      setting,
    });
  } catch (error) {
    console.error("[GetSetting API] Error:", error);
    if (requestBody) {
      console.error("[GetSetting API] Device:", requestBody.ipAddress);
      console.error("[GetSetting API] Setting:", requestBody.setting);
    }
    console.error("[GetSetting API] Full error:", error instanceof Error ? error.stack : error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get setting",
      },
      { status: 500 }
    );
  }
}
