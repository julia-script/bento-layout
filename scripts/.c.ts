import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.goto('file://' + process.cwd() + '/tests/html/wpt/css-grid/layout-algorithm_auto-margins-ignored-during-track-sizing-001.html');
console.log(await p.evaluate(() => {
  const r = document.getElementById('test-root')!;
  const k = r.firstElementChild!;
  return `root ${r.getBoundingClientRect().width}x${r.getBoundingClientRect().height}\n` +
    [...k.children].map((c,i)=>`  col${i}: ${c.getBoundingClientRect().width}x${c.getBoundingClientRect().height}`).join('\n');
}));
await b.close();
