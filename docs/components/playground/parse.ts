// Demo source -> a layout tree, by parsing only.
//
// The demo dialect looks like JSX but is not React and is not a program: a
// single <Layout> root wrapping a tree of <Node style={{...}}>, where every
// attribute value is a literal. Because the untrusted surface is a data format
// rather than code, it can be parsed instead of evaluated — so nothing here
// ever reaches `eval`, `new Function`, or a scope object, and a share link
// carrying demo source is inert.
//
// The whitelist below is the enforcement point: an AST node type that is not
// listed is a parse error, which makes the safety property a default-deny
// rather than a list of things to block.

import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { LayoutNode } from 'bento-layout';
import { unreachable } from '../../../src/assert.js';
import { CoercionError, coerceStyle } from './coerce.js';

const JsxParser = Parser.extend(jsx());

/** Thrown for source outside the demo dialect. Caught by <Demo>. */
export class DemoSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSyntaxError';
  }
}

/** A parsed demo node, before styles reach the engine. */
export interface StyleNode {
  style: Record<string, unknown>;
  children: StyleNode[];
}

// Minimal structural types for the acorn/acorn-jsx nodes we accept. acorn types
// its output loosely once the JSX plugin is applied, so the walkers below check
// `type` before reading anything off a node.
interface AstNode {
  type: string;
  [key: string]: unknown;
}

/**
 * Human names for the constructs people actually type, so the error says
 * "function calls are not supported" rather than "CallExpression".
 */
const CONSTRUCT_NAMES: Record<string, string> = {
  CallExpression: 'function calls',
  Identifier: 'variables',
  MemberExpression: 'property access',
  BinaryExpression: 'arithmetic expressions',
  ArrowFunctionExpression: 'functions',
  FunctionExpression: 'functions',
  ConditionalExpression: 'conditionals',
  LogicalExpression: 'logical operators',
  TemplateLiteral: 'template strings',
  SpreadElement: 'spreads',
  NewExpression: '`new`',
  AssignmentExpression: 'assignments',
  UpdateExpression: 'increments',
  TaggedTemplateExpression: 'tagged templates',
  AwaitExpression: '`await`',
  JSXExpressionContainer: 'expressions',
};

function reject(node: AstNode, where: string): never {
  const name = CONSTRUCT_NAMES[node.type] ?? node.type;
  // Phrased so it reads correctly for every entry, plural or not.
  throw new DemoSyntaxError(`${where} cannot use ${name} — demo values must be literals`);
}

/**
 * A literal value inside a style object: number, string, boolean, null, array,
 * or nested object. Anything else — a call, a variable, arithmetic — is
 * rejected here, which is what keeps the dialect data rather than code.
 */
function literalValue(node: AstNode, where: string): unknown {
  switch (node.type) {
    case 'Literal':
      return (node as unknown as { value: unknown }).value;

    case 'UnaryExpression': {
      // Negative numbers parse as unary minus over a literal, so `-10` needs
      // this branch. Only numeric negation is allowed; `!x`, `typeof x`, and
      // `void x` all fall through to the reject below.
      const u = node as unknown as { operator: string; argument: AstNode };
      if ((u.operator === '-' || u.operator === '+') && u.argument.type === 'Literal') {
        const v = (u.argument as unknown as { value: unknown }).value;
        if (typeof v === 'number') return u.operator === '-' ? -v : v;
      }
      return reject(node, where);
    }

    case 'ArrayExpression':
      return (node as unknown as { elements: (AstNode | null)[] }).elements.map((el) => {
        if (el === null) {
          throw new DemoSyntaxError(`holes are not supported in ${where}`);
        }
        return literalValue(el, where);
      });

    case 'ObjectExpression':
      return objectLiteral(node, where);

    default:
      return reject(node, where);
  }
}

function objectLiteral(node: AstNode, where: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prop of (node as unknown as { properties: AstNode[] }).properties) {
    if (prop.type !== 'Property') reject(prop, where);
    const p = prop as unknown as {
      key: AstNode;
      value: AstNode;
      computed: boolean;
      kind: string;
    };
    if (p.computed) {
      throw new DemoSyntaxError(`computed keys are not supported in ${where}`);
    }
    if (p.kind !== 'init') {
      throw new DemoSyntaxError(`getters and setters are not supported in ${where}`);
    }
    const key =
      p.key.type === 'Identifier'
        ? (p.key as unknown as { name: string }).name
        : p.key.type === 'Literal'
          ? String((p.key as unknown as { value: unknown }).value)
          : reject(p.key, where);
    out[key] = literalValue(p.value, where);
  }
  return out;
}

function elementName(node: AstNode): string {
  const name = (node as unknown as { openingElement: { name: AstNode } }).openingElement.name;
  if (name.type !== 'JSXIdentifier') {
    throw new DemoSyntaxError('only <Layout> and <Node> elements are supported');
  }
  return (name as unknown as { name: string }).name;
}

/** Read a <Node>'s `style` attribute, rejecting anything else on the tag. */
function elementStyle(node: AstNode): Record<string, unknown> {
  const attrs = (node as unknown as { openingElement: { attributes: AstNode[] } }).openingElement.attributes;

  let style: Record<string, unknown> = {};
  for (const attr of attrs) {
    if (attr.type !== 'JSXAttribute') {
      throw new DemoSyntaxError('spread attributes are not supported on <Node>');
    }
    const a = attr as unknown as { name: AstNode; value: AstNode | null };
    const name = (a.name as unknown as { name: string }).name;
    if (name !== 'style') {
      throw new DemoSyntaxError(`<Node> takes only a \`style\` attribute, got \`${name}\``);
    }
    if (a.value === null || a.value.type !== 'JSXExpressionContainer') {
      throw new DemoSyntaxError('`style` must be an object, as in style={{width: 100}}');
    }
    const expr = (a.value as unknown as { expression: AstNode }).expression;
    if (expr.type !== 'ObjectExpression') {
      throw new DemoSyntaxError('`style` must be an object, as in style={{width: 100}}');
    }
    style = objectLiteral(expr, 'a style');
  }
  return style;
}

/** JSX children, minus whitespace-only text. Comments are already dropped. */
function elementChildren(node: AstNode): AstNode[] {
  const raw = (node as unknown as { children: AstNode[] }).children ?? [];
  return raw.filter((child) => {
    if (child.type === 'JSXText') {
      const value = (child as unknown as { value: string }).value;
      if (value.trim() === '') return false;
      throw new DemoSyntaxError(`text is not supported inside <Node> — found "${value.trim().slice(0, 20)}"`);
    }
    if (child.type === 'JSXExpressionContainer') {
      const expr = (child as unknown as { expression: AstNode }).expression;
      // `{/* comment */}` parses as a container holding only a comment.
      if (expr.type === 'JSXEmptyExpression') return false;
      reject(expr, 'the tree');
    }
    return true;
  });
}

function nodeFromElement(node: AstNode): StyleNode {
  const name = elementName(node);
  if (name !== 'Node') {
    throw new DemoSyntaxError(`expected <Node>, got <${name}>`);
  }
  return {
    style: elementStyle(node),
    children: elementChildren(node).map((child) => {
      if (child.type !== 'JSXElement') reject(child, 'the tree');
      return nodeFromElement(child);
    }),
  };
}

/**
 * Parse demo source into a style-node tree.
 *
 * @throws {@link DemoSyntaxError} for anything outside the dialect.
 */
export function parseDemo(source: string): StyleNode {
  let program: AstNode;
  try {
    program = JsxParser.parse(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
    }) as unknown as AstNode;
  } catch (err) {
    throw new DemoSyntaxError(err instanceof Error ? err.message : String(err));
  }

  const body = (program as unknown as { body: AstNode[] }).body;
  if (body.length === 0) {
    throw new DemoSyntaxError('empty demo — expected a <Layout> element');
  }
  if (body.length > 1 || body[0]?.type !== 'ExpressionStatement') {
    throw new DemoSyntaxError('a demo is a single <Layout> element');
  }

  const root = (body[0] as unknown as { expression: AstNode }).expression;
  if (root.type !== 'JSXElement') {
    reject(root, 'the tree');
  }

  const name = elementName(root);
  if (name !== 'Layout') {
    throw new DemoSyntaxError(`a demo starts with <Layout>, got <${name}>`);
  }

  const attrs = (root as unknown as { openingElement: { attributes: AstNode[] } }).openingElement.attributes;
  if (attrs.length > 0) {
    throw new DemoSyntaxError('<Layout> takes no attributes');
  }

  const children = elementChildren(root);
  if (children.length !== 1) {
    throw new DemoSyntaxError('<Layout> must contain exactly one <Node>');
  }
  const only = children[0] ?? unreachable();
  if (only.type !== 'JSXElement') reject(only, 'the tree');
  return nodeFromElement(only);
}

/**
 * Build engine nodes from a parsed tree, coercing each style on the way.
 *
 * @throws {@link CoercionError} for a value the engine cannot lay out.
 */
export function buildTree(node: StyleNode): LayoutNode {
  return LayoutNode.make(coerceStyle(node.style), node.children.map(buildTree));
}

/** Parse and build in one step — what <Demo> calls on every edit. */
export function demoToTree(source: string): LayoutNode {
  return buildTree(parseDemo(source));
}

export { CoercionError };
