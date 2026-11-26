import { readFileSync } from 'node:fs';
import { replay } from './replay.ts';

try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('用法: npm run replay -- <服务端 JSONL 路径>');
  process.stdout.write(JSON.stringify(replay(readFileSync(path, 'utf8'))) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
