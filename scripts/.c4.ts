import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.goto('file://' + process.cwd() + '/tests/html/wpt/.probe.html');
console.log(await p.evaluate(() => ['a','b','c','d','e'].map(i=>{const r=document.getElementById(i)!.getBoundingClientRect();return `${i}: ${r.width}x${r.height}`}).join('\n')));
await b.close();
