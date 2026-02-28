import { NextResponse } from "next/server";
import { getPoESwitch, getPoEDevice, updatePoEDevice, updatePoESwitch } from "@/lib/firebase/firestore";
import { createPoEController } from "@/lib/poe/controller";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { devices } = body as { devices: Array<{ deviceId: string; enabled: boolean }> };

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

    // Toggle each switch's ports sequentially (one switch at a time, one port at a time)
    const results: Array<{ deviceId: string; success: boolean; error?: string }> = [];

    for (const [switchId, { poeSwitch, ports }] of switchGroups) {
      const controller = createPoEController(poeSwitch.type, {
        ipAddress: poeSwitch.ipAddress,
        password: poeSwitch.password,
      });

      // Toggle ports sequentially using single session
      for (const port of ports) {
        try {
          await controller.togglePort(port.portNumber, port.enabled);
          console.log(`[PoE Bulk] ${port.enabled ? 'ON' : 'OFF'} port ${port.portNumber} (${port.deviceName})`);

          // Update device state in Firestore
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
      }

      // Update switch status
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
