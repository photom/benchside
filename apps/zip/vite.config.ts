import { defineConfig } from 'vite';
import { defineApp } from '../../vite.shared.ts';

// REQ-ZIP-001: no network at all.
export default defineConfig(defineApp('zip', { connect: [] }));
