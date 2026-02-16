import { NextResponse } from "next/server";
import { getPoESwitch, getPoEDevice, updatePoEDevice, updatePoESwitch } from "@/lib/firebase/firestore";
import { createPoEController } from "@/lib/poe/controller";

// Queue to prevent concurrent toggles to the same device
const toggleQueues = new Map<string, Promise<void>>();

async function queueToggle(deviceId: string, fn: () => Promise<void>): Promise<void> {
  // Get existing queue for this device
  const existingQueue = toggleQueues.get(deviceId) || Promise.resolve();

  // Chain this toggle after the existing queue
  const newQueue = existingQueue.then(fn).catch((error) => {
    console.error(`[Queue] Toggle failed for device ${deviceId}:`, error);
    throw error;
  });

  toggleQueues.set(deviceId, newQueue);

  // Clean up completed queue after execution
  await newQueue.finally(() => {
    if (toggleQueues.get(deviceId) === newQueue) {
      toggleQueues.delete(deviceId);
    }
  });
}

export async function POST(request: Request) {
  let deviceId: string | undefined;

  try {
    const body = await request.json();
    deviceId = body.deviceId;
    const { enabled } = body;

    if (!deviceId) {
      return NextResponse.json(
        { error: "Device ID is required" },
        { status: 400 }
      );
    }

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "Enabled must be a boolean" },
        { status: 400 }
      );
    }

    // Get PoE device
    const poeDevice = await getPoEDevice(deviceId);
    if (!poeDevice) {
      return NextResponse.json(
        { error: "PoE device not found" },
        { status: 404 }
      );
    }

    // Get PoE switch
    const poeSwitch = await getPoESwitch(poeDevice.switchId);
    if (!poeSwitch) {
      return NextResponse.json(
        { error: "PoE switch not found" },
        { status: 404 }
      );
    }

    // Queue the toggle to prevent concurrent requests to the same device
    console.log(`[PoE Queue] Queuing ${enabled ? 'ON' : 'OFF'} for device "${poeDevice.name}"`);

    // Capture deviceId in a const for use in the callback
    const capturedDeviceId = deviceId;

    await queueToggle(deviceId, async () => {
      console.log(`[PoE Queue] Executing ${enabled ? 'ON' : 'OFF'} for device "${poeDevice.name}"`);

      // Create controller and toggle port
      const controller = createPoEController(poeSwitch.type, {
        ipAddress: poeSwitch.ipAddress,
        password: poeSwitch.password,
      });

      await controller.togglePort(poeDevice.portNumber, enabled);
      console.log(`[PoE Queue] Completed ${enabled ? 'ON' : 'OFF'} for device "${poeDevice.name}"`);

      // Update device state in Firestore
      await updatePoEDevice(capturedDeviceId, {
        isEnabled: enabled,
        lastToggled: new Date(),
        isOnline: true,
      });

      // Update switch online status
      await updatePoESwitch(poeDevice.switchId, {
        isOnline: true,
        lastSeen: new Date(),
      });
    });

    return NextResponse.json({
      success: true,
      deviceId,
      enabled,
      portNumber: poeDevice.portNumber,
    });

  } catch (error) {
    console.error("PoE toggle error:", error);

    // Mark switch as offline if it's a timeout/connection error
    const errorMessage = error instanceof Error ? error.message : "Failed to toggle PoE device";
    if (deviceId && (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT") || errorMessage.includes("ECONNREFUSED"))) {
      try {
        const poeDevice = await getPoEDevice(deviceId);
        if (poeDevice) {
          await updatePoESwitch(poeDevice.switchId, {
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
