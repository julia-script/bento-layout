// Canonical structural signatures for minimized trees (design decision 3):
// known divergences are matched by exact signature and skipped by the fuzzer.

import type { FuzzNode, FuzzTree } from './generate.js';

/** Canonical signature: sorted style keys + text + shape + viewport. */
export function treeSignature(tree: FuzzTree): string {
  const canonNode = (node: FuzzNode): unknown => ({
    style: Object.fromEntries(Object.entries(node.style).sort(([a], [b]) => (a < b ? -1 : 1))),
    ...(node.text !== undefined ? { text: node.text } : {}),
    children: node.children.map(canonNode),
  });
  return JSON.stringify({ root: canonNode(tree.root), viewport: tree.viewport ?? null });
}

/** FNV-1a hash of a signature — used for persisted fixture names. */
export function signatureHash(signature: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < signature.length; i++) {
    h ^= signature.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
