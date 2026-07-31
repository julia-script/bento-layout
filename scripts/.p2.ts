import { computeLayout, createNode } from '../src/index.js';
const kid = createNode({ style:{ display:'grid', size:{width:550,height:400}, margin:{top:1,right:2,bottom:3,left:4} } });
const root = createNode({ style:{ display:'block', size:{width:1280,height:'auto'} }, children:[kid] });
computeLayout(root, { width:'max-content', height:'max-content' });
console.log('root', root.layout.location, root.layout.size, '(chrome y=1 1280x400)');
console.log('kid ', kid.layout.location, kid.layout.size, '(chrome x=4 y=1)');
