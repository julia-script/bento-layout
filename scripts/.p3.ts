import { computeLayout, createNode } from '../src/index.js';
const a = createNode({ style:{ display:'block', position:'absolute', inset:{top:0,left:0,bottom:0,right:0}, gridColumn:{start:'auto',end:{line:1}} } });
const b2 = createNode({ style:{ display:'block', position:'absolute', inset:{top:0,left:0,bottom:0,right:0}, gridColumn:{start:{line:-1},end:'auto'} } });
const g = createNode({ style:{ display:'grid', direction:'rtl', position:'absolute', size:{width:150,height:100},
  padding:{left:50,right:80,top:0,bottom:0},
  gridTemplateColumns:[{min:50,max:50} as any,{min:100,max:100} as any] }, children:[a,b2] });
computeLayout(createNode({ style:{display:'block'}, children:[g] }), { width:1280, height:'max-content' });
console.log('child0', a.layout.location, a.layout.size, '(chrome x=70 80x100)');
console.log('child1', b2.layout.location, b2.layout.size, '(chrome x=-80 0x100)');
