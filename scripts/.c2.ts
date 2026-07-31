import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.setContent(`<style>@font-face{font-family:Ahem;src:url(file://${process.cwd()}/tests/html/support/Ahem.ttf)}
div{font:10px/1 Ahem;display:block}</style>
<div id=a style="width:max-content">AA BB</div>
<div id=b style="width:min-content">AA BB</div>
<div id=c style="width:30px">AA BB</div>
<div id=d style="width:max-content">AAA</div>`);
await new Promise(r=>setTimeout(r,300));
console.log(await p.evaluate(() => ['a','b','c','d'].map(i=>{const r=document.getElementById(i)!.getBoundingClientRect();return `${i}: ${r.width}x${r.height}`}).join('\n')));
await b.close();
