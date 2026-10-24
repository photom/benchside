import { defineConfig } from 'vite';
import { DOH_ORIGINS, defineApp } from '../../vite.shared.ts';

export default defineConfig(defineApp('mail', { connect: DOH_ORIGINS }));
