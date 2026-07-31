import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [] });
const p = await b.newPage();
await p.setContent(`<div style="display:grid;direction:rtl;position:absolute;width:150px;height:100px;padding-left:50px;padding-right:80px;grid-template-columns:50px 100px" id=g>
 <div id=c0 style="position:absolute;inset:0;grid-column-end:1"></div>
 <div id=c1 style="position:absolute;inset:0;grid-column-start:-1"></div>
 <div id=c2 style="position:absolute;inset:0;grid-column-start:1"></div>
 <div id=c3 style="position:absolute;inset:0;grid-column-end:-1"></div>
</div>`);
console.log(await p.evaluate(() => {
  const g=document.getElementById('g')!.getBoundingClientRect();
  return ['c0','c1','c2','c3'].map(i=>{const r=document.getElementById(i)!.getBoundingClientRect();
    return `${i}: x=${r.x-g.x} w=${r.width}`}).join('\n');
}));
await b.close();
