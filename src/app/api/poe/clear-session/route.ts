import { NextResponse } from "next/server";
import { clearAllPoESessions } from "@/lib/poe/controller";

export async function POST() {
  await clearAllPoESessions();
  return NextResponse.json({ success: true });
}
