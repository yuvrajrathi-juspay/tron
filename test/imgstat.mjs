import fs from 'node:fs';
import { PNG } from 'pngjs';
for (const f of process.argv.slice(2)) {
  const png = PNG.sync.read(fs.readFileSync(f));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 16) { r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++; }
  console.log(f.split('/').pop(), 'mean', (r / n).toFixed(0), (g / n).toFixed(0), (b / n).toFixed(0));
}
