/** Bounded raw-deflate decompression (nested.md: NEST-3), through @benchside/core (0010). */
import { type InflateResult, inflate } from '@benchside/core';

export type { InflateResult };

export const inflateRaw = (data: Uint8Array, limit: number) => inflate(data, limit, 'deflate-raw');
