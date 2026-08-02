export function positionalArg(args: string[], valueFlags: ReadonlySet<string> = new Set()): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (valueFlags.has(arg)) {
      index++;
      continue;
    }
    if (!arg.startsWith('--')) return arg;
  }
  return undefined;
}
