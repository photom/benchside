import { defineConfig } from 'vite';
import { defineApp } from '../../vite.shared.ts';

export default defineConfig(defineApp('home', { connect: [] }));
