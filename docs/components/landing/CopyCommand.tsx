'use client';

import { useState } from 'react';

/** The install one-liner with a copy button. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="ld-kbd"
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
