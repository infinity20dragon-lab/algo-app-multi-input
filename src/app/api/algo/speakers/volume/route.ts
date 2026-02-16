import { NextResponse } from "next/server";
import { getIdleVolumeString } from "@/lib/settings";

interface SpeakerInfo {
  ipAddress: string;
  password: string;
  authMethod?: "standard" | "digest";
}

interface RequestBody {
  speakers: SpeakerInfo[];
  volume: number; // 0-100
}

/**
 * Set volume for multiple speakers
 * POST /api/algo/speakers/volume
 */
export async function POST(request: Request) {
  try {
    const body: RequestBody = await request.json();
    const { speakers, volume } = body;

    if (!speakers || !Array.isArray(speakers) || speakers.length === 0) {
      return NextResponse.json(
        { error: "speakers array is required" },
        { status: 400 }
      );
    }

    if (volume === undefined || volume < 0 || volume > 100) {
      return NextResponse.json(
        { error: "volume must be between 0 and 100" },
        { status: 400 }
      );
    }

    // Convert 0-100% to dB
    // SPECIAL CASE: 0% = idle volume (configurable, default -45dB)
    // Normal range: Algo expects 1=-27dB, 2=-24dB, ... 10=0dB
    // Formula: dB = (level - 10) * 3
    let volumeDbString: string;
    if (volume === 0) {
      volumeDbString = getIdleVolumeString(); // Get configurable idle volume
    } else {
      const volumeScale = Math.round((volume / 100) * 10);
      const volumeDb = (volumeScale - 10) * 3;
      volumeDbString = volumeDb === 0 ? "0dB" : `${volumeDb}dB`;
    }

    // Set volume for each speaker
    const results = await Promise.allSettled(
      speakers.map(async (speaker) => {
        const authMethod = speaker.authMethod || "standard";
        const authHeader =
          authMethod === "digest"
            ? `Digest username=admin password=${speaker.password}`
            : `Basic ${Buffer.from(`admin:${speaker.password}`).toString("base64")}`;

        const response = await fetch(
          `http://${speaker.ipAddress}/cgi-bin/api.cgi`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: authHeader,
            },
            body: new URLSearchParams({
              action: "set",
              "audio.page.vol": volumeDbString,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to set volume for ${speaker.ipAddress}: ${response.statusText}`);
        }

        return { ipAddress: speaker.ipAddress, success: true };
      })
    );

    // Check if any failed
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      console.error("Some speakers failed to set volume:", failures);
    }

    return NextResponse.json({
      success: true,
      volume: volumeDbString,
      results: results.map((r) =>
        r.status === "fulfilled" ? r.value : { error: (r.reason as Error).message }
      ),
    });
  } catch (error) {
    console.error("Error setting speaker volume:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
