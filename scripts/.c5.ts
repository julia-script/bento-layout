import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.setContent(`<style>body{margin:0}</style>
<div id=root style="display:block;width:1280px">
  <div id=kid style="display:grid;width:550px;height:400px;margin:1px 2px 3px 4px"></div>
</div>`);
console.log(await p.evaluate(() => ['root','kid'].map(i=>{const r=document.getElementById(i)!.getBoundingClientRect();return `${i}: x=${r.x} y=${r.y} ${r.width}x${r.height}`}).join('\n')));
await b.close();
