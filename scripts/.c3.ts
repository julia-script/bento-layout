import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
const css = readFileSync('tests/html/support/test_base_style.css','utf8');
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.setContent(`<style>${css}</style><style>div{display:block}</style>
<div id=a style="width:max-content">AA BB</div>
<div id=b style="width:min-content">AA BB</div>
<div id=c style="width:30px">AA BB</div>
<div id=d style="width:max-content">AAA</div>
<div id=e style="width:max-content">AABB</div>
<div id=f style="width:20px">AA BB</div>`);
await new Promise(r=>setTimeout(r,300));
console.log(await p.evaluate(() => ['a','b','c','d','e','f'].map(i=>{const r=document.getElementById(i)!.getBoundingClientRect();return `${i}: ${r.width}x${r.height}`}).join('\n')));
await b.close();
