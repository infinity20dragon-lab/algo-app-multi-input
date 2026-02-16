import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod, AlgoDeviceType } from "@/lib/algo/types";

interface DistributeRequest {
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
  audioUrl?: string;
  filename?: string;
  loop: boolean;
  volume: number;
}

// Helper to control speaker multicast mode
async function setSpeakersMcast(
  speakers: DistributeRequest["speakers"],
  enable: boolean
): Promise<void> {
  if (!speakers || speakers.length === 0) return;

  const mcastMode = enable ? "2" : "0";

  await Promise.all(
    speakers.map(async (speaker) => {
      try {
        const client = new AlgoClient({
          ipAddress: speaker.ipAddress,
          password: speaker.password,
          authMethod: speaker.authMethod || "basic",
        });
        await client.setSetting({ "mcast.mode": mcastMode });
      } catch (error) {
        console.error(`Failed to set mcast for ${speaker.ipAddress}:`, error);
      }
    })
  );
}

// Helper to wait for playback to complete
async function waitForPlaybackComplete(
  client: AlgoClient,
  maxWaitMs: number = 30000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const status = await client.getStatus();
      const currentAction = status["Current Action"];

      if (!currentAction || currentAction === "None") {
        return;
      }
    } catch (error) {
      console.error("Status poll error:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn("Playback wait timeout reached");
}

export async function POST(request: NextRequest) {
  try {
    const body: DistributeRequest = await request.json();
    const { device, speakers, filename, loop, volume } = body;

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

    // Step 1: Enable speakers (if this is a paging device with linked speakers)
    if (device.type === "8301" && speakers && speakers.length > 0) {
      console.log("Enabling speakers...");
      await setSpeakersMcast(speakers, true);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Step 2: Set volume if different from default
    if (volume !== undefined) {
      const volumeDb = Math.round((volume / 100) * 42 - 42);
      try {
        await client.setSetting({ "audio.page.vol": `${volumeDb}dB` });
      } catch (e) {
        console.warn("Failed to set volume:", e);
      }
    }

    // Step 3: Play tone
    const tonePath = filename || "chime.wav";
    await client.playTone({
      path: tonePath,
      loop,
      mcast: true,
    });

    // Step 4: If not looping and has speakers, wait and disable
    if (!loop && device.type === "8301" && speakers && speakers.length > 0) {
      await waitForPlaybackComplete(client);
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("Disabling speakers...");
      await setSpeakersMcast(speakers, false);
    }

    return NextResponse.json({
      success: true,
      message: loop
        ? "Playing (looped) - call stop endpoint to end"
        : "Playback complete",
    });
  } catch (error) {
    console.error("Distribute error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to distribute audio" },
      { status: 500 }
    );
  }
}
