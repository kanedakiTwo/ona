function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}

export const haptic = {
  light: () => vibrate(10),
  medium: () => vibrate(20),
  strong: () => vibrate([15, 30, 15]),
}
