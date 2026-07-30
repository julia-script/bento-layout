// Browser conformance fixture generator.
//
// Loads each HTML fixture from tests/html/<dir>/ in headless Chrome (Puppeteer),
// invokes the in-page extractor (tests/html/support/test_helper.js, vendored from
// Taffy), and serializes the four box-sizing/direction variants to the XML
// fixture format consumed by tests/fixtures.test.ts.
//
// The XML serialization is a port of taffy's scripts/gentest/src/main.rs writer,
// targeting byte-parity with the previously vendored fixtures so that diffs
// after regeneration reflect genuine browser-behavior differences only.
//
// Usage: pnpm gentest [substring...]   (no args = all fixtures)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_ROOT = join(ROOT, 'tests', 'html');
const FIXTURES_ROOT = join(ROOT, 'tests', 'fixtures');
const DIRS = ['flex', 'block', 'blockflex', 'blockgrid', 'grid', 'gridflex'] as const;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

// --- Shortest-round-trip f32 formatting (Rust `f32` Display parity) ---------

function formatF32(value: number): string {
  const f = Math.fround(value);
  if (Number.isInteger(f) && Math.abs(f) < 1e21) return f.toString();
  for (let precision = 1; precision <= 9; precision++) {
    const s = f.toPrecision(precision);
    if (Math.fround(parseFloat(s)) === f) {
      // Normalize away exponent/trailing-zero artifacts
      return parseFloat(s).toString();
    }
  }
  return f.toString();
}

/** Rust `f64` Display and JS Number#toString are both shortest-round-trip */
function formatF64(value: number): string {
  return value.toString();
}

// --- XML writer (xmlwriter crate parity: 2-space indent, self-closing tags) --

class XmlWriter {
  private out = '';
  private stack: { tag: string; hasChildren: boolean }[] = [];

  startElement(tag: string): void {
    if (this.stack.length > 0) {
      const parent = this.stack[this.stack.length - 1]!;
      if (!parent.hasChildren) {
        this.out += '>';
        parent.hasChildren = true;
      }
    }
    if (this.out.length > 0) this.out += '\n';
    this.out += `${'  '.repeat(this.stack.length)}<${tag}`;
    this.stack.push({ tag, hasChildren: false });
  }

  writeAttribute(name: string, value: string): void {
    this.out += ` ${name}="${escapeAttr(value)}"`;
  }

  writeText(text: string): void {
    const top = this.stack[this.stack.length - 1]!;
    if (!top.hasChildren) {
      this.out += '>';
      top.hasChildren = true;
    }
    this.out += `\n${'  '.repeat(this.stack.length)}${escapeText(text)}`;
  }

  endElement(): void {
    const el = this.stack.pop()!;
    if (el.hasChildren) {
      this.out += `\n${'  '.repeat(this.stack.length)}</${el.tag}>`;
    } else {
      this.out += '/>';
    }
  }

  endDocument(): string {
    // xmlwriter parity: close any elements still open
    while (this.stack.length > 0) this.endElement();
    return this.out + '\n';
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Style serialization (port of main.rs) -----------------------------------

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function serializeDimension(obj: Json | undefined): string | null {
  if (!isObject(obj)) return null;
  const unit = obj['unit'];
  const value = typeof obj['value'] === 'number' ? obj['value'] : null;
  switch (unit) {
    case 'auto':
    case 'max-content':
    case 'min-content':
      return unit;
    case 'px':
      return `${formatF64(value!)}px`;
    case 'percent':
      return `${formatF64(value! * 100.0)}%`;
    case 'fraction':
      return `${formatF64(value!)}fr`;
    default:
      throw new Error(`Unknown dimension unit: ${String(unit)}`);
  }
}

function getStrAttr(value: Json | undefined, elideIf: string | null): string | null {
  if (typeof value === 'string' && value !== elideIf) return value;
  return null;
}

function getNumAttr(value: Json | undefined, elideIf: number | null): string | null {
  if (typeof value === 'number' && value !== elideIf) return formatF64(value);
  return null;
}

function getDimAttr(value: Json | undefined, elideIf: string | null): string | null {
  const attr = serializeDimension(value);
  if (attr !== null && attr !== elideIf) return attr;
  return null;
}

function serializeGridAutoFlow(obj: Json | undefined): string | null {
  if (!isObject(obj)) return null;
  const direction = obj['direction'] as string;
  const algorithm = obj['algorithm'] as string;
  if (direction === 'row' && algorithm === 'sparse') return 'row';
  if (direction === 'column' && algorithm === 'sparse') return 'column';
  if (direction === 'row' && algorithm === 'dense') return 'row dense';
  if (direction === 'column' && algorithm === 'dense') return 'column dense';
  throw new Error(`Unknown grid-auto-flow: ${direction} ${algorithm}`);
}

function serializeGridPosition(obj: Json | undefined): string | null {
  if (!isObject(obj)) return null;
  const kind = obj['kind'];
  const value = typeof obj['value'] === 'number' ? obj['value'] : 0;
  switch (kind) {
    case 'auto':
      return null;
    case 'span':
      return `span ${formatF32(value)}`;
    case 'line':
      return Math.trunc(value).toString();
    default:
      throw new Error(`Unknown grid position kind: ${String(kind)}`);
  }
}

function serializeValueList(
  values: Json[],
  sep: string,
  quoter: (v: Json) => string | null,
): string | null {
  const parts: string[] = [];
  for (const item of values) {
    const part = quoter(item);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join(sep);
}

function serializeArray(value: Json | undefined, sep: string, quoter: (v: Json) => string | null): string | null {
  if (!Array.isArray(value)) return null;
  return serializeValueList(value, sep, quoter);
}

function serializeTrackDefinition(def: Json): string | null {
  if (!isObject(def)) return null;
  const kind = def['kind'];
  if (kind === 'scalar') return serializeDimension(def);
  if (kind === 'function') {
    const name = def['name'] as string;
    const args = def['arguments'];
    if (!Array.isArray(args)) return null;
    if (name === 'fit-content') {
      if (args.length !== 1) throw new Error('fit-content function with the wrong number of arguments');
      const limit = serializeDimension(args[0]);
      return limit !== null ? `fit-content(${limit})` : null;
    }
    if (name === 'minmax') {
      if (args.length !== 2) throw new Error('minmax function with the wrong number of arguments');
      const min = serializeDimension(args[0]);
      const max = serializeDimension(args[1]);
      return min !== null && max !== null ? `minmax(${min},${max})` : null;
    }
    if (name === 'repeat') {
      if (args.length < 2) throw new Error('repeat function with the wrong number of arguments');
      const first = args[0];
      if (!isObject(first)) return null;
      const unit = first['unit'];
      let repetition: string;
      if (unit === 'auto-fill' || unit === 'auto-fit') {
        repetition = unit;
      } else if (unit === 'integer') {
        repetition = Math.trunc(first['value'] as number).toString();
      } else {
        throw new Error(`Unknown repeat repetition unit: ${String(unit)}`);
      }
      const trackList = serializeValueList(args.slice(1), ' ', serializeTrackDefinition);
      return trackList !== null ? `repeat(${repetition}, ${trackList})` : null;
    }
    throw new Error(`Unknown track function: ${name}`);
  }
  throw new Error(`Unknown track definition kind: ${String(kind)}`);
}

// --- Node / assertion generation (port of main.rs) ---------------------------

function maybeWrite(w: XmlWriter, name: string, value: string | null): void {
  if (value !== null) w.writeAttribute(name, value);
}

function generateNode(w: XmlWriter, node: JsonObject): void {
  const style = node['style'] as JsonObject;

  const textContent = typeof node['textContent'] === 'string' ? node['textContent'] : null;
  w.startElement(textContent !== null ? 'text' : 'div');

  maybeWrite(w, 'display', getStrAttr(style['display'], null));
  maybeWrite(w, 'box-sizing', getStrAttr(style['boxSizing'], 'border-box'));
  maybeWrite(w, 'direction', getStrAttr(style['direction'], null));
  maybeWrite(w, 'writing-mode', getStrAttr(style['writingMode'], null));
  maybeWrite(w, 'position', getStrAttr(style['position'], 'relative'));
  maybeWrite(w, 'float', getStrAttr(style['cssFloat'], null));
  maybeWrite(w, 'clear', getStrAttr(style['clear'], null));
  maybeWrite(w, 'flex-direction', getStrAttr(style['flexDirection'], 'row'));
  maybeWrite(w, 'flex-wrap', getStrAttr(style['flexWrap'], 'nowrap'));
  maybeWrite(w, 'overflow-x', getStrAttr(style['overflowX'], 'visible'));
  maybeWrite(w, 'overflow-y', getStrAttr(style['overflowY'], 'visible'));

  const overflowX = getStrAttr(style['overflowX'], 'visible');
  const overflowY = getStrAttr(style['overflowY'], 'visible');
  if (overflowX !== null || overflowY !== null) {
    maybeWrite(w, 'scrollbar-width', getNumAttr(style['scrollbarWidth'], null));
  }

  maybeWrite(w, 'text-align', getStrAttr(style['textAlign'], null));
  maybeWrite(w, 'align-items', getStrAttr(style['alignItems'], null));
  maybeWrite(w, 'align-self', getStrAttr(style['alignSelf'], null));
  maybeWrite(w, 'justify-items', getStrAttr(style['justifyItems'], null));
  maybeWrite(w, 'justify-self', getStrAttr(style['justifySelf'], null));
  maybeWrite(w, 'align-content', getStrAttr(style['alignContent'], null));
  maybeWrite(w, 'justify-content', getStrAttr(style['justifyContent'], null));

  maybeWrite(w, 'flex-grow', getNumAttr(style['flexGrow'], 0.0));
  maybeWrite(w, 'flex-shrink', getNumAttr(style['flexShrink'], 1.0));
  maybeWrite(w, 'flex-basis', getDimAttr(style['flexBasis'], 'auto'));

  const size = (style['size'] ?? {}) as JsonObject;
  const minSize = (style['minSize'] ?? {}) as JsonObject;
  const maxSize = (style['maxSize'] ?? {}) as JsonObject;
  maybeWrite(w, 'width', getDimAttr(size['width'], 'auto'));
  maybeWrite(w, 'height', getDimAttr(size['height'], 'auto'));
  maybeWrite(w, 'min-width', getDimAttr(minSize['width'], 'auto'));
  maybeWrite(w, 'min-height', getDimAttr(minSize['height'], 'auto'));
  maybeWrite(w, 'max-width', getDimAttr(maxSize['width'], 'auto'));
  maybeWrite(w, 'max-height', getDimAttr(maxSize['height'], 'auto'));

  maybeWrite(w, 'aspect-ratio', getNumAttr(style['aspectRatio'], null));

  const gap = (style['gap'] ?? {}) as JsonObject;
  maybeWrite(w, 'row-gap', getDimAttr(gap['row'], null));
  maybeWrite(w, 'column-gap', getDimAttr(gap['column'], null));

  for (const [prop, attr] of [
    ['margin', 'margin'],
    ['padding', 'padding'],
    ['border', 'border'],
  ] as const) {
    const rect = (style[prop] ?? {}) as JsonObject;
    maybeWrite(w, `${attr}-top`, getDimAttr(rect['top'], null));
    maybeWrite(w, `${attr}-left`, getDimAttr(rect['left'], null));
    maybeWrite(w, `${attr}-bottom`, getDimAttr(rect['bottom'], null));
    maybeWrite(w, `${attr}-right`, getDimAttr(rect['right'], null));
  }

  const inset = (style['inset'] ?? {}) as JsonObject;
  maybeWrite(w, 'top', getDimAttr(inset['top'], null));
  maybeWrite(w, 'left', getDimAttr(inset['left'], null));
  maybeWrite(w, 'bottom', getDimAttr(inset['bottom'], null));
  maybeWrite(w, 'right', getDimAttr(inset['right'], null));

  maybeWrite(w, 'grid-auto-flow', serializeGridAutoFlow(style['gridAutoFlow']));
  maybeWrite(w, 'grid-template-rows', serializeArray(style['gridTemplateRows'], ' ', serializeTrackDefinition));
  maybeWrite(w, 'grid-template-columns', serializeArray(style['gridTemplateColumns'], ' ', serializeTrackDefinition));
  maybeWrite(w, 'grid-auto-rows', serializeArray(style['gridAutoRows'], ' ', serializeTrackDefinition));
  maybeWrite(w, 'grid-auto-columns', serializeArray(style['gridAutoColumns'], ' ', serializeTrackDefinition));

  maybeWrite(w, 'grid-row-start', serializeGridPosition(style['gridRowStart']));
  maybeWrite(w, 'grid-row-end', serializeGridPosition(style['gridRowEnd']));
  maybeWrite(w, 'grid-column-start', serializeGridPosition(style['gridColumnStart']));
  maybeWrite(w, 'grid-column-end', serializeGridPosition(style['gridColumnEnd']));

  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      generateNode(w, child as JsonObject);
    }
  }

  if (textContent !== null) {
    w.writeText(textContent.trim());
  }

  w.endElement();
}

function generateAssertions(w: XmlWriter, node: JsonObject, useRounding: boolean): void {
  const layout = (useRounding ? node['smartRoundedLayout'] : node['unroundedLayout']) as JsonObject;
  const naive = node['naivelyRoundedLayout'] as JsonObject;

  const readF32 = (key: string): number => Math.fround(layout[key] as number);
  const readNaiveF32 = (key: string): number => Math.fround(naive[key] as number);
  const scrollWidth = Math.max(readF32('scrollWidth') - readNaiveF32('clientWidth'), 0);
  const scrollHeight = Math.max(readF32('scrollHeight') - readNaiveF32('clientHeight'), 0);

  const style = node['style'] as JsonObject;
  const isScrollable = (overflow: Json | undefined): boolean =>
    overflow === 'hidden' || overflow === 'scroll' || overflow === 'auto';
  const isScrollContainer = isScrollable(style['overflowX']) || isScrollable(style['overflowY']);

  w.startElement('node');
  w.writeAttribute('x', formatF32(readF32('x')));
  w.writeAttribute('y', formatF32(readF32('y')));
  w.writeAttribute('width', formatF32(readF32('width')));
  w.writeAttribute('height', formatF32(readF32('height')));

  if (isScrollContainer) {
    w.writeAttribute('scroll_width', formatF32(scrollWidth));
    w.writeAttribute('scroll_height', formatF32(scrollHeight));
  }

  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      generateAssertions(w, child as JsonObject, useRounding);
    }
  }

  w.endElement();
}

export function generateTestXml(name: string, description: JsonObject): string {
  const useRounding = description['useRounding'] as boolean;

  const w = new XmlWriter();
  w.startElement('test');
  w.writeAttribute('name', name);
  w.writeAttribute('use-rounding', String(useRounding));

  const viewport = description['viewport'] as JsonObject;
  w.startElement('viewport');
  w.writeAttribute('width', serializeDimension(viewport['width'])!);
  w.writeAttribute('height', serializeDimension(viewport['height'])!);
  w.endElement();

  w.startElement('input');
  generateNode(w, description);
  w.endElement();

  w.startElement('expectations');
  generateAssertions(w, description, useRounding);
  w.endElement();

  return w.endDocument();
}

// --- Driver ------------------------------------------------------------------

const VARIANTS = [
  ['borderBoxLtrData', 'border_box_ltr'],
  ['contentBoxLtrData', 'content_box_ltr'],
  ['borderBoxRtlData', 'border_box_rtl'],
  ['contentBoxRtlData', 'content_box_rtl'],
] as const;

async function main(): Promise<void> {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
  });
  const version = await browser.version();
  console.log(`chrome: ${version}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  // Scrollbar canary: fixtures depend on the generating environment's scrollbar
  // width; record it so provenance captures the environment.
  await page.goto('data:text/html;charset=utf-8,<html><body><div style="overflow:scroll"></div></body></html>');
  const scrollbarWidth = await page.evaluate(() => {
    const el = document.body.firstChild as HTMLElement;
    return el.offsetWidth - el.clientWidth;
  });
  console.log(`scrollbar width: ${scrollbarWidth}`);

  let generated = 0;
  for (const dir of DIRS) {
    const files = readdirSync(join(HTML_ROOT, dir))
      .filter((f) => f.endsWith('.html'))
      .filter((f) => !f.startsWith('x')) // x-prefix marks a disabled fixture
      .sort();
    for (const file of files) {
      const name = file.replace(/\.html$/, '');
      const id = `${dir}/${name}`;
      if (filters.length > 0 && !filters.some((f) => id.includes(f))) continue;

      await page.goto(`file://${join(HTML_ROOT, dir, file)}`);
      await page.evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
      const raw = (await page.evaluate('getTestData()')) as string;
      const data = JSON.parse(raw) as JsonObject;

      mkdirSync(join(FIXTURES_ROOT, dir), { recursive: true });
      for (const [key, suffix] of VARIANTS) {
        const xml = generateTestXml(`${name}__${suffix}`, data[key] as JsonObject);
        writeFileSync(join(FIXTURES_ROOT, dir, `${name}__${suffix}.xml`), xml);
        generated++;
      }
    }
  }

  await browser.close();

  // On full (unfiltered) runs, record generation provenance next to the fixtures.
  if (filters.length === 0) {
    const puppeteerVersion = (
      JSON.parse(readFileSync(join(ROOT, 'node_modules', 'puppeteer', 'package.json'), 'utf8')) as { version: string }
    ).version;
    writeFileSync(
      join(FIXTURES_ROOT, 'CHROME_VERSION'),
      `${version}\nscrollbar-width: ${scrollbarWidth}\npuppeteer: ${puppeteerVersion}\n`,
    );
  }

  console.log(`generated ${generated} fixtures (chrome ${version}, scrollbar width ${scrollbarWidth})`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}
