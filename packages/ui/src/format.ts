/** Number formatting shared by the apps' views. */

export const hex = (n: number, width = 0) => n.toString(16).padStart(width, '0');

/** Offsets in decimal and hex: specs and hex editors use hex. */
export const offset = (n: number) => `${n} (0x${hex(n)})`;
