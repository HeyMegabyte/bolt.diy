import fs from 'fs';
import path from 'path';

function walk(d, acc) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    let s;
    try { s = fs.statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, acc);
    else if (f.endsWith('.entity.js')) acc.push(p);
  }
  return acc;
}

const files = walk('dist/engine', []);
const out = [];
for (const f of files) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const em = s.match(/_typeorm\.Entity\)\(\s*['"`]([a-zA-Z0-9_]+)['"`]/) || s.match(/Entity\)\(\{\s*name:\s*['"`]([a-zA-Z0-9_]+)['"`]/);
  if (!em) continue;
  const table = em[1];
  const re = /(PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|type:\s*['"`]([a-zA-Z]+)['"`])[\s\S]{0,260}?\],\s*[A-Za-z0-9_]+\.prototype,\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
  let m;
  const cols = new Set();
  while ((m = re.exec(s))) {
    let typ = m[2] || '';
    if (!typ) {
      if (m[1].includes('PrimaryGenerated')) typ = 'uuid';
      else if (m[1].includes('Date')) typ = 'timestamptz';
    }
    const col = m[3];
    if (col) cols.add(col + ':' + (typ || 'text'));
  }
  if (cols.size) out.push(table + '\t' + [...cols].join(','));
}
console.log(out.join('\n'));
