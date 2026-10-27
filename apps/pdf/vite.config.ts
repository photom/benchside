import { defineConfig } from 'vite';
import { defineApp } from '../../vite.shared.ts';

// REQ-PDF-001: no network at all.
export default defineConfig(defineApp('pdf', { connect: [] }));
