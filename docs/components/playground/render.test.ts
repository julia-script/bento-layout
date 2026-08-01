// The renderer itself is a thin map from `node.layout` to inline styles, so
// these tests cover the thing that could actually be wrong: that each display
// mode lays out and that the tree the renderer walks has the geometry it needs.

import { computeLayout } from 'bento-layout';
import { describe, expect, it } from 'vitest';
import { unreachable } from '../../../src/assert.js';
import { demoToTree } from './parse.js';

function layout(source: string) {
  const root = demoToTree(source);
  computeLayout(root, { width: 'max-content', height: 'max-content' });
  return root;
}

describe('display modes render', () => {
  it('lays out a flex row', () => {
    const root = layout(`
      <Layout>
        <Node style={{display: 'flex', width: '300px', height: '60px'}}>
          <Node style={{flexGrow: 1}} />
          <Node style={{flexGrow: 2}} />
        </Node>
      </Layout>
    `);
    expect(root.children.map((c) => c.layout.size.width)).toEqual([100, 200]);
  });

  it('lays out a grid', () => {
    const root = layout(`
      <Layout>
        <Node style={{display: 'grid', width: '200px', height: '100px',
                      gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr'}}>
          <Node />
          <Node />
          <Node />
          <Node />
        </Node>
      </Layout>
    `);
    expect(root.children.map((c) => [c.layout.location.x, c.layout.location.y])).toEqual([
      [0, 0],
      [100, 0],
      [0, 50],
      [100, 50],
    ]);
  });

  it('lays out a block', () => {
    const root = layout(`
      <Layout>
        <Node style={{display: 'block', width: '200px'}}>
          <Node style={{display: 'block', height: '30px'}} />
          <Node style={{display: 'block', height: '40px'}} />
        </Node>
      </Layout>
    `);
    // Block children stack and fill the inline axis.
    expect(root.children.map((c) => c.layout.location.y)).toEqual([0, 30]);
    expect(root.children.map((c) => c.layout.size.width)).toEqual([200, 200]);
    expect(root.layout.size.height).toBe(70);
  });
});

describe('geometry the renderer relies on', () => {
  it('reports child positions relative to the parent border box', () => {
    // The renderer positions each child absolutely inside its parent, so
    // offsets must be parent-relative rather than accumulated.
    const root = layout(`
      <Layout>
        <Node style={{width: '200px', height: '200px', paddingLeft: '20px', paddingTop: '10px'}}>
          <Node style={{width: '50px', height: '50px'}} />
        </Node>
      </Layout>
    `);
    expect(root.children[0]?.layout.location).toEqual({ x: 20, y: 10 });
  });

  it('nests offsets per level rather than cumulatively', () => {
    const root = layout(`
      <Layout>
        <Node style={{width: '300px', height: '300px', paddingLeft: '10px'}}>
          <Node style={{width: '200px', height: '200px', paddingLeft: '10px'}}>
            <Node style={{width: '50px', height: '50px'}} />
          </Node>
        </Node>
      </Layout>
    `);
    const mid = root.children[0] ?? unreachable();
    expect(mid.layout.location.x).toBe(10);
    // Not 20: the grandchild's x is relative to its own parent.
    expect(mid.children[0]?.layout.location.x).toBe(10);
  });

  it('keeps a one-axis collapse at zero size for the renderer to mark', () => {
    // SVG renders no rect at zero width, so the renderer draws a line along
    // the remaining extent — which it can only do if the engine reports the
    // collapse rather than omitting the node.
    const root = layout(`
      <Layout>
        <Node style={{width: '100px', height: '100px'}}>
          <Node style={{width: 0, height: '40px'}} />
        </Node>
      </Layout>
    `);
    expect(root.children[0]?.layout.size).toEqual({ width: 0, height: 40 });
  });

  it('keeps a display:none node in the tree for the renderer to skip', () => {
    const root = layout(`
      <Layout>
        <Node style={{width: '100px', height: '100px'}}>
          <Node style={{display: 'none', width: '50px', height: '50px'}} />
        </Node>
      </Layout>
    `);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.style.display).toBe('none');
  });
});
