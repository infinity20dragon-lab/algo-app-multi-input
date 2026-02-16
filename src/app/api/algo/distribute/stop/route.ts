import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod, AlgoDeviceType } from "@/lib/algo/types";

interface StopRequest {
  device: {
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
    type?: AlgoDeviceType;
  };
  speakers?: Array<{
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  }>;
}

// Helper to disable speakers
async function disableSpeakers(
  speakers: StopRequest["speakers"]
): Promise<void> {
  if (!speakers || speakers.length === 0) return;

  await Promise.all(
    speakers.map(async (speaker) => {
      try {
        const client = new AlgoClient({
          ipAddress: speaker.ipAddress,
          password: speaker.password,
          authMethod: speaker.authMethod || "basic",
        });
        await client.setSetting({ "mcast.mode": "0" });
      } catch (error) {
        console.error(`Failed to disable speaker ${speaker.ipAddress}:`, error);
      }
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: StopRequest = await request.json();
    const { device, speakers } = body;

    if (!device?.ipAddress || !device?.password) {
      return NextResponse.json(
        { error: "Device information is required" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress: device.ipAddress,
      password: device.password,
      authMethod: device.authMethod || "standard",
    });

    // Stop the tone
    await client.stopTone();

    // Disable speakers if this is a paging device with linked speakers
    if (device.type === "8301" && speakers && speakers.length > 0) {
      console.log("Disabling speakers...");
      await disableSpeakers(speakers);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stop error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop audio" },
      { status: 500 }
    );
  }
}
