import { ahemTextMeasure } from '../tests/harness/measure.js';
const cases: [string, string, any, any][] = [
  ['a max-content', 'AA BB', {width:null,height:null}, {width:'max-content',height:'max-content'}],
  ['b min-content', 'AA BB', {width:null,height:null}, {width:'min-content',height:'min-content'}],
  ['c width 30',    'AA BB', {width:30,height:null},   {width:30,height:'max-content'}],
  ['d AAA',         'AAA',   {width:null,height:null}, {width:'max-content',height:'max-content'}],
  ['e AABB',        'AABB',  {width:null,height:null}, {width:'max-content',height:'max-content'}],
];
const want: Record<string,string> = {'a max-content':'50x10','b min-content':'20x20','c width 30':'30x20','d AAA':'30x10','e AABB':'40x10'};
for (const [name, text, kd, avs] of cases) {
  const r = ahemTextMeasure(text, 'horizontal')(kd, avs);
  const got = `${r.width}x${r.height}`;
  console.log(`${got===want[name]?'ok  ':'FAIL'} ${name.padEnd(15)} got ${got.padEnd(8)} chrome ${want[name]}`);
}
