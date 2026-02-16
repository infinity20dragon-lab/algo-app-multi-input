import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

// Default tones that shouldn't be deleted
const DEFAULT_TONES = [
  "bell-na.wav",
  "bell-uk.wav",
  "buzzer.wav",
  "chime.wav",
  "dogs.wav",
  "gong.wav",
  "page-notif.wav",
  "speech-test.wav",
  "tone-1kHz-max.wav",
  "warble1-low.wav",
  "warble2-med.wav",
  "warble3-high.wav",
  "warble4-trill.wav",
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ipAddress, password, authMethod, filename } = body as {
      ipAddress: string;
      password: string;
      authMethod: AlgoAuthMethod;
      filename: string;
    };

    if (!ipAddress || !password || !filename) {
      return NextResponse.json(
        { error: "IP address, password, and filename are required" },
        { status: 400 }
      );
    }

    // Prevent deleting default tones
    if (DEFAULT_TONES.includes(filename)) {
      return NextResponse.json(
        { error: "Cannot delete default system tones" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "basic",
    });

    await client.deleteFile(`/tones/${filename}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete file" },
      { status: 500 }
    );
  }
}
