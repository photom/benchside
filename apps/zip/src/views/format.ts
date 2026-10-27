/** Number formatting for the views (zip-architecture.md#ui). */

import { hex } from '@benchside/ui';

// hex, offset, and PAGE are shared with the other apps.
export { hex, offset, PAGE } from '@benchside/ui';

export const crc = (n: number) => hex(n, 8);

export const bytesHex = (bytes: Uint8Array) => [...bytes].map((b) => hex(b, 2)).join(' ');
