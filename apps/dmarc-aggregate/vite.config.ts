import { defineConfig } from 'vite';
import { defineApp } from '../../vite.shared.ts';

// No network until reverse lookup is added; then the DoH origins, as 0013 records.
export default defineConfig(defineApp('dmarc-aggregate', { connect: [] }));
