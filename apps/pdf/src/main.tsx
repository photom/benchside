import { render } from 'preact';
import { App } from './App.tsx';
import { createWorkerHost } from './worker/host.ts';

const root = document.getElementById('app');
if (root) render(<App host={createWorkerHost()} />, root);
