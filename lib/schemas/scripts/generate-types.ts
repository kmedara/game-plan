/**
 * Generate plain TypeScript types and consts for `@gameplan/types` from
 * `@gameplan/schemas` Zod schemas.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as Schemas from '../src/index.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(
  scriptDir,
  '../../types/src/generated/schema-types.ts',
);

/** Runtime consts copied into the generated client types package. */
const CONST_EXPORTS = [
  'ACCOUNT_KINDS',
  'CHAT_KINDS',
  'DEVICE_PLATFORMS',
  'EVENT_TYPES',
  'RSVP_STATUSES',
  'TEAM_ROLES',
  'TEAM_PERMISSIONS',
  'DEFAULT_ROLE_PERMISSIONS',
  'MAX_UPLOAD_BYTES',
] as const;

/** Convert `loginBodySchema` → `LoginBody`. */
const schemaExportToTypeName = (exportName: string): string => {
  const base = exportName.replace(/Schema$/u, '');
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
};

/** Prefer `export type` aliases over interfaces for generated wire types. */
const interfaceToTypeAlias = (source: string): string =>
  source.replace(/^export interface (\w+) /gmu, 'export type $1 = ');

/** Serialize a const value as TypeScript with `as const` for arrays. */
const formatConst = (name: string, value: unknown): string => {
  if (name === 'MAX_UPLOAD_BYTES' && typeof value === 'number') {
    return `export const ${name} = ${value};`;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => JSON.stringify(item)).join(', ');
    return `export const ${name} = [${items}] as const;`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entryValue]) => {
        if (Array.isArray(entryValue)) {
          const items = entryValue.map((item) => JSON.stringify(item)).join(', ');
          return `  ${key}: [${items}]`;
        }
        return `  ${key}: ${JSON.stringify(entryValue)}`;
      },
    );
    return `export const ${name} = {\n${entries.join(',\n')},\n} as const;`;
  }
  return `export const ${name} = ${JSON.stringify(value)} as const;`;
};

/** True when the export is a Zod schema named `*Schema`. */
const isZodSchemaExport = (
  entry: [string, unknown],
): entry is [string, z.ZodTypeAny] =>
  entry[0].endsWith('Schema') && entry[1] instanceof z.ZodType;

const schemaEntries = (Object.entries(Schemas) as [string, unknown][])
  .filter(isZodSchemaExport)
  .sort(([a], [b]) => a.localeCompare(b));

const typeChunks: string[] = [];

for (const [exportName, schema] of schemaEntries) {
  const typeName = schemaExportToTypeName(exportName);
  // Omit `name` so zod-to-json-schema does not wrap the schema in `$ref` +
  // `definitions` (that pair makes json-schema-to-typescript emit `Foo` and `Foo1`).
  const { $schema: _schema, ...jsonSchema } = zodToJsonSchema(schema, {
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  const compiled = await compile(jsonSchema, typeName, {
    bannerComment: '',
    additionalProperties: false,
    unreachableDefinitions: true,
    style: {
      singleQuote: true,
      semi: true,
    },
  });
  typeChunks.push(interfaceToTypeAlias(compiled.trim()));
}

const constChunks = CONST_EXPORTS.map((name) => {
  const value = (Schemas as Record<string, unknown>)[name];
  if (value === undefined) {
    throw new Error(`Missing schema const export: ${name}`);
  }
  return formatConst(name, value);
});

const banner = `/**
 * AUTO-GENERATED FILE — do not edit.
 *
 * Source: \`@gameplan/schemas\`
 * Generate: \`npm run generate:types\`
 */
`;

const body = `${banner}
${typeChunks.join('\n\n')}

${constChunks.join('\n\n')}
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${body.trim()}\n`, 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
