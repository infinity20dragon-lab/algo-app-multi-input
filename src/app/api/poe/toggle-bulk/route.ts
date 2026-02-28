import { NextResponse } from "next/server";
import { getPoESwitch, getPoEDevice, updatePoEDevice, updatePoESwitch } from "@/lib/firebase/firestore";
import { createPoEController } from "@/lib/poe/controller";

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

      if (parallel) {
        // TRUE parallel — all ports at once, no serialization queue
        console.log(`[PoE Bulk] Parallel mode: toggling ${ports.length} ports concurrently`);
        const portResults = await controller.togglePortsParallel(portConfigs);

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
      } else {
        // Sequential mode — one port at a time via batch method (single session)
        console.log(`[PoE Bulk] Sequential mode: toggling ${ports.length} ports (delay: ${delay}ms)`);
        for (const port of ports) {
          try {
            await controller.togglePort(port.portNumber, port.enabled);
            console.log(`[PoE Bulk] ${port.enabled ? 'ON' : 'OFF'} port ${port.portNumber} (${port.deviceName})`);
            await updatePoEDevice(port.deviceId, {
              isEnabled: port.enabled,
              lastToggled: new Date(),
              isOnline: true,
            });
            results.push({ deviceId: port.deviceId, success: true });
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[PoE Bulk] Failed port ${port.portNumber}: ${msg}`);
            results.push({ deviceId: port.deviceId, success: false, error: msg });
          }
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
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
