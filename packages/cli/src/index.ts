import { pathToFileURL } from 'node:url';
import { diffCommand } from './commands/diff.js';

export * from './adapter/index.js';
export * from './model/sizes.js';
export * from './model/diff.js';
export * from './model/chains.js';
export * from './rules/index.js';
export { formatBytes, formatDelta, renderTextDiff } from './report/text.js';

export const VERSION = '0.0.0';

export const HELP = `bundle-mop v${VERSION}

Explains every PR's Next.js bundle change: which import, through which chain,
and how to fix it.

Usage:
  bundle-mop diff <base-export> <pr-export> [--json] [--top <n>]
                          Diff two \`next analyze export\` files (.jsonl / .jsonl.gz)
  bundle-mop --help       Show this help
  bundle-mop --version    Show version

Commands (coming soon):
  compare --base <ref>    Capture base and PR snapshots and diff them
`;

export function run(argv: string[]): { code: number; output: string } {
  const [command, ...rest] = argv;
  if (command === 'diff') return diffCommand(rest);
  if (command === '--version' || command === '-v') {
    return { code: 0, output: VERSION };
  }
  if (command === undefined || command === '--help' || command === '-h') {
    return { code: 0, output: HELP };
  }
  return { code: 1, output: `Unknown command: ${argv.join(' ')}\n\n${HELP}` };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { code, output } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(output);
  process.exitCode = code;
}
