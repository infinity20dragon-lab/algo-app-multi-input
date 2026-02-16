import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface StopRequest {
  paging: {
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  };
  speakers?: Array<{
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  }>;
}

// Helper to disable speaker multicast mode
async function disableSpeakersMcast(
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
        console.error(`Failed to disable mcast for ${speaker.ipAddress}:`, error);
      }
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: StopRequest = await request.json();
    const { paging, speakers } = body;

    if (!paging?.ipAddress || !paging?.password) {
      return NextResponse.json(
        { error: "Paging device info is required" },
        { status: 400 }
      );
    }

    const pagingClient = new AlgoClient({
      ipAddress: paging.ipAddress,
      password: paging.password,
      authMethod: paging.authMethod || "basic",
    });

    // Step 1: Stop playback on paging device
    console.log("Stopping playback...");
    await pagingClient.stopTone();

    // Step 2: Disable speakers (if any)
    if (speakers && speakers.length > 0) {
      // Small delay to ensure audio fully stops
      await new Promise((resolve) => setTimeout(resolve, 300));

      console.log("Disabling speakers...");
      await disableSpeakersMcast(speakers);
    }

    return NextResponse.json({
      success: true,
      message: "Playback stopped and speakers disabled",
    });
  } catch (error) {
    console.error("Stop error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop" },
      { status: 500 }
    );
  }
}
