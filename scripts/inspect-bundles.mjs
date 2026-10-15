/**
 * Bundle size reports for the Lambda API and the Expo web client.
 *
 * API bundles use the same esbuild settings as the CDK NodejsFunction (ESM,
 * Node 22, minified). The metafile lists bytes that survived tree-shaking.
 * The client report is the exported web JavaScript Metro emitted.
 *
 *   node scripts/inspect-bundles.mjs api
 *   node scripts/inspect-bundles.mjs client
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'infrastructure/package.json'));
const esbuild = require('esbuild');

const resources = JSON.parse(await readFile(path.join(repoRoot, 'config/resources.json'), 'utf8'));
const reportRoot = path.join(repoRoot, 'dist/bundle-report');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const inspectApi = async () => {
  await mkdir(path.join(reportRoot, 'api'), { recursive: true });
  const banner =
    "import { createRequire } from 'module'; const require = createRequire(import.meta.url);";

  for (const area of resources.areas) {
    const outfile = path.join(reportRoot, 'api', `${area}.mjs`);
    const result = await esbuild.build({
      absWorkingDir: repoRoot,
      entryPoints: [path.join(repoRoot, 'functions', area, 'src', 'handler.ts')],
      bundle: true,
      format: 'esm',
      target: 'node22',
      platform: 'node',
      mainFields: ['module', 'main'],
      minify: true,
      outfile,
      metafile: true,
      banner: { js: banner },
      logLevel: 'silent',
    });
    const output = await readFile(outfile);
    const outputMeta = Object.values(result.metafile.outputs)[0];
    const inputs = Object.entries(outputMeta?.inputs ?? {})
      .map(([file, info]) => ({ file, bytes: info.bytesInOutput }))
      .filter((row) => row.bytes > 0)
      .sort((left, right) => right.bytes - left.bytes);
    await writeFile(path.join(reportRoot, 'api', `${area}.meta.json`), JSON.stringify(result.metafile));
    console.log(`\n${area}  ${kb(output.length)} raw  ${kb(gzipSync(output).length)} gzip`);
    for (const row of inputs.slice(0, 12)) {
      const label = row.file.replace(`${repoRoot.replaceAll('\\', '/')}/`, '').replaceAll('\\', '/');
      console.log(`  ${kb(row.bytes).padStart(8)}  ${label}`);
    }
  }
  console.log(`\nMetafiles: ${path.join(reportRoot, 'api')}`);
};

const inspectClient = async () => {
  const outDir = path.join(reportRoot, 'client');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, 'client/expo/scripts/run.mjs'), 'export', '--output-dir', outDir],
      { cwd: repoRoot, stdio: 'inherit', env: process.env },
    );
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`expo export exited ${code}`))));
  });
  const files = await walk(outDir);
  const scripts = files.filter((file) => file.endsWith('.js'));
  let total = 0;
  console.log('\nExpo web export');
  for (const file of scripts) {
    const size = (await stat(file)).size;
    total += size;
    console.log(`  ${kb(size).padStart(8)}  ${path.relative(outDir, file)}`);
  }
  console.log(`  ${kb(total).padStart(8)}  total javascript`);
  console.log(`\nExport: ${outDir}`);
};

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
};

const target = process.argv[2];
if (target === 'api') await inspectApi();
else if (target === 'client') await inspectClient();
else {
  console.error('Usage: node scripts/inspect-bundles.mjs <api|client>');
  process.exit(1);
}
