import { defineConfig } from 'vite';
import { DOH_ORIGINS, defineApp } from '../../vite.shared.ts';

// The DoH endpoints, for the opt-in reverse lookup only (RDNS-1, 0013).
export default defineConfig(defineApp('dmarc-aggregate', { connect: DOH_ORIGINS }));
