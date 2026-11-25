// Library entry: no side effects on import. The executable is src/bin.ts.
import { compareCommand } from './commands/compare.js';
import { diffCommand } from './commands/diff.js';
import { fail } from './commands/shared.js';
import type { CommandResult } from './commands/shared.js';

export * from './adapter/index.js';
export * from './model/sizes.js';
export * from './model/diff.js';
export * from './model/chains.js';
export * from './rules/index.js';
export * from './budgets/index.js';
export * from './capture/index.js';
export { analyze } from './pipeline.js';
export type { Analysis, AnalysisOptions } from './pipeline.js';
export { formatBytes, formatDelta, renderTextDiff } from './report/text.js';
export { COMMENT_MARKER, formatChainMarkdown, formatChainMermaid, renderMarkdown } from './report/markdown.js';
export type { MarkdownOptions } from './report/markdown.js';
export type { CommandResult } from './commands/shared.js';

export const VERSION = '0.3.1';

export const HELP = `bundle-mop v${VERSION}

Explains every PR's Next.js bundle change: which import, through which chain,
and how to fix it.

Usage:
  bundle-mop compare [--base <branch>] [options]
                          Compare your branch with main, in one step. Run it inside a
                          Next.js 16.4+ app. \`bundle-mop compare --help\` for options.
  bundle-mop diff <base-export> <pr-export> [options]
                          Diff two saved \`next analyze export\` files.
  bundle-mop --help       Show this help
  bundle-mop --version    Show version

Docs: https://github.com/yosuva-rv/bundle-mop
`;

/** Synchronous commands (everything except compare). */
export function run(argv: string[]): CommandResult {
  const [command, ...rest] = argv;
  if (command === 'diff') return diffCommand(rest);
  if (command === '--version' || command === '-v') {
    return { code: 0, output: VERSION };
  }
  if (command === undefined || command === '--help' || command === '-h') {
    return { code: 0, output: HELP };
  }
  return fail(`Unknown command: ${argv.join(' ')}\n\n${HELP}`);
}

/** Entry point for the executable: all commands, including the async `compare`. */
export async function main(argv: string[]): Promise<CommandResult> {
  if (argv[0] === 'compare') return compareCommand(argv.slice(1));
  return run(argv);
}
