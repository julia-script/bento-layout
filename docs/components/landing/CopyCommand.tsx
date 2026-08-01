'use client';

import { useState } from 'react';

/** The install one-liner with a copy button. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="ld-kbd inline-flex items-center gap-3 px-4 py-2.5 text-sm text-fd-foreground transition-colors hover:border-fd-primary/40"
      onClick={() => {
        navigator.clipboard?.writeText(command).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      aria-label={`Copy ${command}`}
    >
      <span aria-hidden className="text-fd-muted-foreground">
        $
      </span>
      {command}
      <span className="text-xs text-fd-muted-foreground" aria-live="polite">
        {copied ? 'copied' : 'copy'}
      </span>
    </button>
  );
}
