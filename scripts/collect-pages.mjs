// Collects each app's build output into site/ for GitHub Pages (0002).
// home → site/, every other app → site/<name>/.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const site = 'site';
rmSync(site, { recursive: true, force: true });
for (const app of readdirSync('apps')) {
  const dist = join('apps', app, 'dist');
  if (!existsSync(dist)) throw new Error(`${dist} is missing; build the app first`);
  cpSync(dist, app === 'home' ? site : join(site, app), { recursive: true });
}
console.log(`Collected ${readdirSync('apps').length} apps into ${site}/`);
