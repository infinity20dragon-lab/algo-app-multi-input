import { NextResponse } from 'next/server';

/**
 * API endpoint to clear the terminal where Next.js dev server is running
 * Uses ANSI escape codes to clear the terminal screen
 */
export async function POST() {
  try {
    // Clear terminal using ANSI escape codes
    // \x1Bc is the escape sequence for clearing the terminal
    process.stdout.write('\x1Bc');

    // Also clear console (works in Node.js)
    console.clear();

    console.log('🧹 Terminal cleared after session complete');

    return NextResponse.json({ success: true, message: 'Terminal cleared' });
  } catch (error) {
    console.error('Failed to clear terminal:', error);
    return NextResponse.json({ success: false, error: 'Failed to clear terminal' }, { status: 500 });
  }
}
