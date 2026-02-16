import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const ipAddress = formData.get("ipAddress") as string;
    const password = formData.get("password") as string;
    const authMethod = formData.get("authMethod") as AlgoAuthMethod;

    if (!file || !ipAddress || !password) {
      return NextResponse.json(
        { error: "File, IP address, and password are required" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith(".wav")) {
      return NextResponse.json(
        { error: "Only WAV files are supported" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "basic",
    });

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to device
    await client.uploadFile("tones", file.name, buffer);

    return NextResponse.json({ success: true, filename: file.name });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload file" },
      { status: 500 }
    );
  }
}
