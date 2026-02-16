import { NextResponse } from "next/server";
import { createPoEController } from "@/lib/poe/controller";

export async function POST(request: Request) {
  let switchId: string | undefined;

  try {
    const body = await request.json();
    const { ipAddress, password, type = "netgear_gs308ep", switchId: extractedSwitchId } = body;
    switchId = extractedSwitchId;

    if (!ipAddress) {
      return NextResponse.json(
        { error: "IP address is required" },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      );
    }

    // Create controller and test connection
    const controller = createPoEController(type, {
      ipAddress,
      password,
    });

    const isOnline = await controller.testConnection();

    // Update switch status if switchId provided (both online and offline)
    if (switchId) {
      const { updatePoESwitch } = await import("@/lib/firebase/firestore");
      await updatePoESwitch(switchId, {
        isOnline: isOnline,
        lastSeen: isOnline ? new Date() : null,
      });
    }

    return NextResponse.json({
      success: true,
      isOnline,
      ipAddress,
      message: isOnline ? "Switch is reachable" : "Switch is not reachable",
    });

  } catch (error) {
    console.error("PoE test error:", error);

    // Mark switch as offline if test failed
    if (switchId) {
      try {
        const { updatePoESwitch } = await import("@/lib/firebase/firestore");
        await updatePoESwitch(switchId, {
          isOnline: false,
          lastSeen: null,
        });
      } catch (updateError) {
        console.error("Failed to update switch offline status:", updateError);
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to test PoE switch" },
      { status: 500 }
    );
  }
}
