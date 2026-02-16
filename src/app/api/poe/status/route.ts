import { NextResponse } from "next/server";
import { getPoESwitch, getPoEDevices, updatePoEDevice, updatePoESwitch } from "@/lib/firebase/firestore";
import { createPoEController } from "@/lib/poe/controller";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { switchId } = body;

    if (!switchId) {
      return NextResponse.json(
        { error: "Switch ID is required" },
        { status: 400 }
      );
    }

    // Get PoE switch
    const poeSwitch = await getPoESwitch(switchId);
    if (!poeSwitch) {
      return NextResponse.json(
        { error: "PoE switch not found" },
        { status: 404 }
      );
    }

    // Create controller and get all port statuses
    const controller = createPoEController(poeSwitch.type, {
      ipAddress: poeSwitch.ipAddress,
      password: poeSwitch.password,
    });

    const portStatuses = await controller.getPortStatuses();

    // Update switch online status
    await updatePoESwitch(switchId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    // Get all devices for this switch
    const allDevices = await getPoEDevices();
    const switchDevices = allDevices.filter(d => d.switchId === switchId);

    // Update device states in Firestore based on actual port status
    const updates = switchDevices.map(async (device) => {
      const portStatus = portStatuses.find(p => p.port === device.portNumber);
      if (portStatus && portStatus.enabled !== device.isEnabled) {
        // Port status differs from stored state - update it
        await updatePoEDevice(device.id, {
          isEnabled: portStatus.enabled,
          isOnline: true,
        });
      }
    });

    await Promise.all(updates);

    return NextResponse.json({
      success: true,
      switchId,
      portStatuses,
      updatedDevices: switchDevices.length,
    });

  } catch (error) {
    console.error("PoE status error:", error);

    // Mark switch as offline on error
    const errorMessage = error instanceof Error ? error.message : "Failed to get PoE status";
    if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT") || errorMessage.includes("ECONNREFUSED")) {
      try {
        const { switchId: id } = await request.json();
        if (id) {
          await updatePoESwitch(id, {
            isOnline: false,
          });
        }
      } catch (updateError) {
        console.error("Failed to update switch offline status:", updateError);
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
