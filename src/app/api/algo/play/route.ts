import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface PlayRequest {
  paging: {
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  };
  speakers: Array<{
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  }>;
  tone: string;
  loop?: boolean;
}

// Helper to control speaker multicast mode
async function setSpeakersMcast(
  speakers: PlayRequest["speakers"],
  enable: boolean
): Promise<void> {
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

// Helper to wait for paging device to finish playing
async function waitForPlaybackComplete(
  client: AlgoClient,
  maxWaitMs: number = 30000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500; // Check every 500ms

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const status = await client.getStatus();
      const currentAction = status["Current Action"];

      // If no action or action is "None", playback is complete
      if (!currentAction || currentAction === "None") {
        return;
      }
    } catch (error) {
      console.error("Status poll error:", error);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout reached - return anyway to ensure speakers get disabled
  console.warn("Playback wait timeout reached");
}

export async function POST(request: NextRequest) {
  try {
    const body: PlayRequest = await request.json();
    const { paging, speakers, tone, loop = false } = body;

    if (!paging?.ipAddress || !paging?.password) {
      return NextResponse.json(
        { error: "Paging device info is required" },
        { status: 400 }
      );
    }

    if (!tone) {
      return NextResponse.json(
        { error: "Tone filename is required" },
        { status: 400 }
      );
    }

    const pagingClient = new AlgoClient({
      ipAddress: paging.ipAddress,
      password: paging.password,
      authMethod: paging.authMethod || "basic",
    });

    // Step 1: Enable speakers (if any)
    if (speakers && speakers.length > 0) {
      await setSpeakersMcast(speakers, true);
      // Small delay to ensure speakers are ready
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Step 2: Play the tone
    await pagingClient.playTone({
      path: tone,
      loop,
      mcast: true,
    });

    // Step 3: If not looping, wait for completion then disable speakers
    if (!loop && speakers && speakers.length > 0) {
      // Wait for playback to complete (polls status)
      await waitForPlaybackComplete(pagingClient);

      // Small buffer after playback ends
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Disable speakers
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
    console.error("Play error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to play" },
      { status: 500 }
    );
  }
}
