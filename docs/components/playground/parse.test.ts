import { describe, expect, it } from 'vitest';
import { computeLayout } from 'bento-layout';
import { DemoSyntaxError, buildTree, demoToTree, parseDemo } from './parse.js';
import { CoercionError } from './coerce.js';

describe('accepted dialect', () => {
  it('parses a nested tree', () => {
    const tree = parseDemo(`
      <Layout>
        <Node style={{width: 200, height: 100}}>
          <Node style={{flexGrow: 1}} />
          <Node style={{width: 50}} />
        </Node>
      </Layout>
    `);
    expect(tree.style).toEqual({ width: 200, height: 100 });
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.style).toEqual({ flexGrow: 1 });
    expect(tree.children[1]!.children).toEqual([]);
  });

  it('allows a node with no style', () => {
    expect(parseDemo('<Layout><Node /></Layout>').style).toEqual({});
  });

  it('accepts every literal form a style can hold', () => {
    const tree = parseDemo(`
      <Layout>
        <Node style={{
          width: 100,
          height: '50%',
          marginLeft: -10,
          flexGrow: 1.5,
          display: 'grid',
          alignItems: {keyword: 'center', safe: true},
          gridTemplateColumns: [{min: 'auto', max: {fr: 1}}],
        }} />
      </Layout>
    `);
    expect(tree.style).toEqual({
      width: 100,
      height: '50%',
      marginLeft: -10,
      flexGrow: 1.5,
      display: 'grid',
      alignItems: { keyword: 'center', safe: true },
      gridTemplateColumns: [{ min: 'auto', max: { fr: 1 } }],
    });
  });

  it('ignores whitespace and JSX comments', () => {
    const tree = parseDemo(`
      <Layout>
        <Node>
          {/* a comment */}
          <Node />
        </Node>
      </Layout>
    `);
    expect(tree.children).toHaveLength(1);
  });
});

describe('rejected constructs', () => {
  // Each of these would run code if the source were evaluated rather than
  // parsed. They must fail at parse, and the message must name the construct.
  const hostile: Array<[string, string, RegExp]> = [
    ['arithmetic', '<Layout><Node style={{width: 100 * 3}} /></Layout>', /arithmetic/],
    ['variables', '<Layout><Node style={{width: someVar}} /></Layout>', /variables/],
    [
      'function calls',
      '<Layout><Node style={{width: alert(1)}} /></Layout>',
      /function calls/,
    ],
    [
      'property access',
      '<Layout><Node style={{width: window.innerWidth}} /></Layout>',
      /property access/,
    ],
    [
      'template strings',
      '<Layout><Node style={{width: `100`}} /></Layout>',
      /template strings/,
    ],
    [
      'functions',
      '<Layout><Node style={{width: () => 1}} /></Layout>',
      /functions/,
    ],
    [
      'conditionals',
      '<Layout><Node style={{width: a ? 1 : 2}} /></Layout>',
      /conditionals|variables/,
    ],
    ['spread', '<Layout><Node style={{...other}} /></Layout>', /spread/],
    [
      'computed keys',
      '<Layout><Node style={{[k]: 1}} /></Layout>',
      /computed keys/,
    ],
    ['`new`', '<Layout><Node style={{width: new Thing()}} /></Layout>', /`new`/],
  ];

  for (const [name, source, pattern] of hostile) {
    it(`rejects ${name}`, () => {
      expect(() => parseDemo(source)).toThrow(DemoSyntaxError);
      expect(() => parseDemo(source)).toThrow(pattern);
    });
  }

  it('rejects an expression child in the tree', () => {
    expect(() => parseDemo('<Layout><Node>{items}</Node></Layout>')).toThrow(DemoSyntaxError);
  });

  it('never evaluates rejected source', () => {
    // If this were evaluated rather than parsed, the global would be set.
    const key = '__demo_should_not_run__';
    expect(() =>
      parseDemo(`<Layout><Node style={{width: (globalThis.${key} = 1)}} /></Layout>`),
    ).toThrow(DemoSyntaxError);
    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
  });
});

describe('dialect shape', () => {
  it('requires a <Layout> root', () => {
    expect(() => parseDemo('<Node />')).toThrow(/starts with <Layout>/);
    expect(() => parseDemo('<Layout><Layout /></Layout>')).toThrow(/expected <Node>/);
  });

  it('requires exactly one child of <Layout>', () => {
    expect(() => parseDemo('<Layout></Layout>')).toThrow(/exactly one <Node>/);
    expect(() => parseDemo('<Layout><Node /><Node /></Layout>')).toThrow(/exactly one <Node>/);
  });

  it('rejects unknown attributes and elements', () => {
    expect(() => parseDemo('<Layout><Node id="a" /></Layout>')).toThrow(/only a `style`/);
    expect(() => parseDemo('<Layout config={{a: 1}}><Node /></Layout>')).toThrow(
      /takes no attributes/,
    );
    expect(() => parseDemo('<Layout><Node><div /></Node></Layout>')).toThrow(/expected <Node>/);
  });

  it('rejects text content', () => {
    expect(() => parseDemo('<Layout><Node>hello</Node></Layout>')).toThrow(/text is not supported/);
  });

  it('rejects empty and multi-statement source', () => {
    expect(() => parseDemo('')).toThrow(/empty demo/);
    expect(() => parseDemo('<Layout><Node /></Layout>; 1 + 1')).toThrow(/single <Layout>/);
  });

  it('reports malformed JSX as a syntax error', () => {
    expect(() => parseDemo('<Layout><Node ')).toThrow(DemoSyntaxError);
  });
});

describe('building engine trees', () => {
  it('builds and lays out a tree', () => {
    const root = demoToTree(`
      <Layout>
        <Node style={{width: '400px', height: '120px'}}>
          <Node style={{flexGrow: 1}} />
          <Node style={{flexGrow: 1}} />
        </Node>
      </Layout>
    `);
    computeLayout(root, { width: 'max-content', height: 'max-content' });

    expect(root.layout.size).toEqual({ width: 400, height: 120 });
    expect(root.children[0]!.layout.size.width).toBe(200);
    expect(root.children[1]!.layout.location.x).toBe(200);
  });

  it('lays out a grid built from CSS-shaped strings', () => {
    const root = demoToTree(`
      <Layout>
        <Node style={{display: 'grid', width: '300px', height: '100px',
                      gridTemplateColumns: 'repeat(3, 1fr)'}}>
          <Node />
          <Node />
          <Node />
        </Node>
      </Layout>
    `);
    computeLayout(root, { width: 'max-content', height: 'max-content' });

    expect(root.children.map((c) => c.layout.size.width)).toEqual([100, 100, 100]);
    expect(root.children.map((c) => c.layout.location.x)).toEqual([0, 100, 200]);
  });

  it('surfaces coercion errors from style values', () => {
    expect(() => demoToTree("<Layout><Node style={{width: '2rem'}} /></Layout>")).toThrow(
      CoercionError,
    );
  });

  it('rejects a NaN-producing value before it reaches layout', () => {
    // The failure this guards against is not a wrong number but a hang: NaN
    // survives every bounds check and can spin the sizing loop forever.
    expect(() => demoToTree("<Layout><Node style={{width: '1f'}} /></Layout>")).toThrow(
      CoercionError,
    );
  });

  it('builds from an already-parsed tree', () => {
    const root = buildTree({ style: { width: 10 }, children: [] });
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(root.layout.size.width).toBe(10);
  });
});
