// Minimize a hand-written or previously generated fuzz reproduction while
// keeping at least one Chrome-vs-engine mismatch alive.
//
// Usage: pnpm fuzz-minimize '<tree-json>' [--max-checks N] [--preserve-mismatch]
//        pnpm fuzz-minimize path/to/tree.json [--max-checks N] [--preserve-mismatch]

import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { checkTree, createExecutor } from './fuzz/check.js';
import type { FuzzTree } from './fuzz/generate.js';
import { countNodes } from './fuzz/generate.js';
import { shrinkTree } from './fuzz/shrink.js';

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readTree(arg: string): FuzzTree {
  const json = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
  const tree = JSON.parse(json) as FuzzTree & { viewport?: FuzzTree['viewport'] | null };
  if (tree.viewport === null) delete tree.viewport;
  return tree;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = args.find((value, index) => !value.startsWith('--') && args[index - 1] !== '--max-checks');
  if (arg === undefined) {
    console.error("usage: pnpm fuzz-minimize '<tree-json>' | <file.json> [--max-checks N] [--preserve-mismatch]");
    process.exitCode = 2;
    return;
  }

  const maxChecks = Number(flagValue('--max-checks') ?? 2000);
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1) {
    console.error('--max-checks must be a positive integer');
    process.exitCode = 2;
    return;
  }

  const tree = readTree(arg);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env.GENTEST_NO_SANDBOX ? ['--no-sandbox'] : [])],
  });

  try {
    const exec = await createExecutor(browser);
    const initial = await checkTree(exec, tree);
    if (initial.length === 0) {
      console.error('input does not currently differ from Chrome; nothing to minimize');
      process.exitCode = 1;
      return;
    }

    const preserveMismatch = process.argv.includes('--preserve-mismatch');
    const anchor = preserveMismatch ? initial[0] : undefined;
    console.error(
      `input: ${countNodes(tree.root)} node(s), ${initial.length} mismatch(es)` +
        (anchor === undefined ? '' : `; preserving ${anchor.variant} ${anchor.path} ${anchor.axis}`),
    );
    let checks = 0;
    const shrunk = await shrinkTree(
      tree,
      async (candidate) => {
        checks++;
        if (checks % 25 === 0) console.error(`  checked ${checks} candidate combinations...`);
        const mismatches = await checkTree(exec, candidate);
        return anchor === undefined
          ? mismatches.length > 0
          : mismatches.some(
              (mismatch) =>
                mismatch.variant === anchor.variant && mismatch.path === anchor.path && mismatch.axis === anchor.axis,
            );
      },
      maxChecks,
    );
    const finalMismatches = await checkTree(exec, shrunk.tree);

    console.error(
      `result: ${countNodes(shrunk.tree.root)} node(s), ${shrunk.applied} reduction(s), ` +
        `${shrunk.checks} checks${shrunk.budgetExhausted ? ' (budget exhausted)' : ''}`,
    );
    for (const mismatch of finalMismatches.slice(0, 8)) {
      console.error(
        `  ${mismatch.variant} ${mismatch.path} ${mismatch.axis}: ` +
          `chrome=${mismatch.expected} engine=${mismatch.actual}`,
      );
    }
    if (finalMismatches.length > 8) console.error(`  ... and ${finalMismatches.length - 8} more`);

    // Keep stdout machine-friendly: it can be redirected straight to a file or
    // command-substituted into fuzz-triage. Progress and diagnostics use stderr.
    console.log(JSON.stringify(shrunk.tree));
  } finally {
    await browser.close();
  }
}

await main();
