import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi.js';

type Operation = { tags: string[]; parameters?: { name: string; in: string }[] };

const operations = Object.entries(openApiDocument.paths).flatMap(([path, methods]) =>
  Object.values(methods).map((operation) => ({ path, operation: operation as Operation })),
);

describe('openApiDocument', () => {
  it('serializes to OpenAPI 3.1 JSON', () => {
    const parsed = JSON.parse(JSON.stringify(openApiDocument)) as typeof openApiDocument;
    expect(parsed.openapi).toBe('3.1.0');
    expect(Object.keys(parsed.paths).length).toBeGreaterThan(0);
  });

  it('has at least one route per tagged area beyond the health check', () => {
    for (const { name } of openApiDocument.tags) {
      const routes = operations.filter(
        ({ path, operation }) => operation.tags.includes(name) && !path.endsWith('/health'),
      );
      expect(routes.length, name).toBeGreaterThan(0);
    }
  });

  it('declares a path parameter for every {param} in a path', () => {
    for (const { path, operation } of operations) {
      const declared = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name);
      const expected = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => name);
      expect(declared, path).toEqual(expected);
    }
  });

  it('includes request body schemas from Zod', () => {
    const createTeam = openApiDocument.paths['/teams']?.post as {
      requestBody: { content: { 'application/json': { schema: { required: string[] } } } };
    };
    expect(createTeam.requestBody.content['application/json'].schema.required).toEqual([
      'name',
      'timeZone',
    ]);
  });
});
