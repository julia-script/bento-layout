import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.goto('file://' + process.cwd() + '/tests/html/wpt/css-grid/abspos_positioned-grid-items-025.html');
console.log(await p.evaluate(() => {
  const g = document.querySelector('#test-root > div') as HTMLElement;
  return [...g.children].map((c,i)=>{const r=(c as HTMLElement).getBoundingClientRect(); const gr=g.getBoundingClientRect();
    return `child${i}: x=${r.x-gr.x} ${r.width}x${r.height}`}).join('\n');
}));
await b.close();
