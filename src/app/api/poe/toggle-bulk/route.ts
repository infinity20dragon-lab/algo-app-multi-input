import { NextResponse } from "next/server";
import { getPoESwitch, getPoEDevice, updatePoEDevice, updatePoESwitch } from "@/lib/firebase/firestore";
import { createPoEController } from "@/lib/poe/controller";
import type { PoEDeviceMode } from "@/lib/algo/types";

// PATCH — update a single PoE device's mode (auto/always_off/always_on)
export async function PATCH(request: Request) {
  try {
    const { deviceId, mode } = await request.json() as { deviceId: string; mode: PoEDeviceMode };
    if (!deviceId || !mode) {
      return NextResponse.json({ error: "deviceId and mode required" }, { status: 400 });
    }
    await updatePoEDevice(deviceId, { mode });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update mode" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { devices, parallel = false, delay = 0 } = body as {
      devices: Array<{ deviceId: string; enabled: boolean }>;
      parallel?: boolean;
      delay?: number;
    };

    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      return NextResponse.json(
        { error: "devices array is required" },
        { status: 400 }
      );
    }

    // Resolve all devices and group by switch
    const switchGroups = new Map<string, {
      poeSwitch: any;
      ports: Array<{ deviceId: string; portNumber: number; enabled: boolean; deviceName: string }>;
    }>();

    for (const { deviceId, enabled } of devices) {
      const poeDevice = await getPoEDevice(deviceId);
      if (!poeDevice) continue;

      const switchId = poeDevice.switchId;
      if (!switchGroups.has(switchId)) {
        const poeSwitch = await getPoESwitch(switchId);
        if (!poeSwitch) continue;
        switchGroups.set(switchId, { poeSwitch, ports: [] });
      }

      switchGroups.get(switchId)!.ports.push({
        deviceId,
        portNumber: poeDevice.portNumber,
        enabled,
        deviceName: poeDevice.name || `Port ${poeDevice.portNumber}`,
      });
    }

    const results: Array<{ deviceId: string; success: boolean; error?: string }> = [];

    for (const [switchId, { poeSwitch, ports }] of switchGroups) {
      const controller = createPoEController(poeSwitch.type, {
        ipAddress: poeSwitch.ipAddress,
        password: poeSwitch.password,
      });

      const portConfigs = ports.map(p => ({ portNumber: p.portNumber, enabled: p.enabled }));

      // Both modes use single-session batch — difference is delay between ports
      const effectiveDelay = parallel ? 0 : delay;
      console.log(`[PoE Bulk] ${parallel ? 'Fast' : 'Sequential'} mode: toggling ${ports.length} ports (delay: ${effectiveDelay}ms)`);

      const portResults = await controller.togglePortsBatch(portConfigs, effectiveDelay);

      // Update Firestore for each result
      for (let i = 0; i < ports.length; i++) {
        const port = ports[i];
        const result = portResults[i];
        if (result.success) {
          console.log(`[PoE Bulk] ${port.enabled ? 'ON' : 'OFF'} port ${port.portNumber} (${port.deviceName})`);
          await updatePoEDevice(port.deviceId, {
            isEnabled: port.enabled,
            lastToggled: new Date(),
            isOnline: true,
          });
        } else {
          console.error(`[PoE Bulk] Failed port ${port.portNumber}: ${result.error}`);
        }
        results.push({ deviceId: port.deviceId, success: result.success, error: result.error });
      }

      await updatePoESwitch(switchId, { isOnline: true, lastSeen: new Date() });
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("PoE bulk toggle error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to toggle PoE devices" },
      { status: 500 }
    );
  }
}
