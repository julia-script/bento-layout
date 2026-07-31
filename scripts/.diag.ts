import { readFileSync } from 'node:fs';
import { computeLayout } from '../src/index.js';
import { parseFixture } from '../tests/harness/fixture.js';
const fx = parseFixture(readFileSync(process.argv[2]!, 'utf8'));
computeLayout(fx.root, fx.viewport, { rounding: fx.useRounding });
const walk = (n: any, e: any, path = 'root') => {
  const l = n.layout;
  const got = `${l.location.x},${l.location.y} ${l.size.width}x${l.size.height}`;
  const exp = `${e.x},${e.y} ${e.width}x${e.height}`;
  console.log(`${got === exp ? 'ok  ' : 'FAIL'} ${path.padEnd(14)} got ${got.padEnd(22)} exp ${exp}`);
  n.children.forEach((c: any, i: number) => walk(c, e.children[i], `${path}.${i}`));
};
walk(fx.root, fx.expected);
