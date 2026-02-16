/**
 * Utility functions for getting app settings from localStorage
 */

/**
 * Get the configured idle volume level for speakers
 * @returns The idle volume in dB (default: -45)
 */
export function getIdleVolume(): number {
  if (typeof window === "undefined") {
    return -45; // Server-side default
  }

  const saved = localStorage.getItem("algoapp-idle-volume");
  if (saved) {
    const parsed = parseInt(saved);
    // Validate range
    if (parsed >= -60 && parsed <= 0) {
      return parsed;
    }
  }

  return -45; // Default
}

/**
 * Get the idle volume as a string with "dB" suffix (for Algo API)
 * @returns The idle volume as a string like "-45dB"
 */
export function getIdleVolumeString(): string {
  return `${getIdleVolume()}dB`;
}

/**
 * Get whether to always keep paging device in transmitter mode
 * @returns true if paging device should always be in mode 1, false to toggle based on audio
 */
export function getAlwaysKeepPagingOn(): boolean {
  if (typeof window === "undefined") {
    return false; // Server-side default
  }

  const saved = localStorage.getItem("algoapp-always-keep-paging-on");
  return saved === "true";
}
