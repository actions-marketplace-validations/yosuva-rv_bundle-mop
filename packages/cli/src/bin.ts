#!/usr/bin/env node
import { main } from './index.js';

const { code, output, error } = await main(process.argv.slice(2));
// Reports always go to stdout (so `--format json > out.json` works even when a budget fails);
// error and usage messages go to stderr.
(error ? console.error : console.log)(output);
process.exitCode = code;
