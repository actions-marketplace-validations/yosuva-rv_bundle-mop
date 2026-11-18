import { pathToFileURL } from 'node:url';

export * from './adapter/index.js';
export * from './model/sizes.js';

export const VERSION = '0.0.0';

export const HELP = `bundle-mop v${VERSION}

Explains every PR's Next.js bundle change: which import, through which chain,
and how to fix it.

Usage:
  bundle-mop --help       Show this help
  bundle-mop --version    Show version

Commands (coming soon):
  compare --base <ref>    Diff next analyze snapshots between base and PR
`;

export function run(argv: string[]): { code: number; output: string } {
  if (argv.includes('--version') || argv.includes('-v')) {
    return { code: 0, output: VERSION };
  }
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
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
