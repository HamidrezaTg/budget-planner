import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const document = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'openapi.json'), 'utf8'),
);

const expectedOperations = [
  ['GET', '/healthz'],
  ['GET', '/metrics'],
  ['GET', '/.well-known/budget-planner'],
  ['GET', '/auth/status'],
  ['POST', '/auth/setup'],
  ['POST', '/auth/login'],
  ['POST', '/auth/logout'],
  ['GET', '/auth/me'],
  ['POST', '/auth/change-password'],
  ['PATCH', '/auth/me'],
  ['PATCH', '/auth/users/{username}'],
  ['GET', '/auth/users'],
  ['POST', '/auth/users'],
  ['POST', '/auth/users/{username}/password'],
  ['DELETE', '/auth/users/{username}'],
  ['GET', '/accounts'],
  ['POST', '/accounts'],
  ['PATCH', '/accounts/{id}'],
  ['DELETE', '/accounts/{id}'],
  ['GET', '/persons'],
  ['POST', '/persons'],
  ['PATCH', '/persons/{id}'],
  ['DELETE', '/persons/{id}'],
  ['GET', '/categories'],
  ['GET', '/categories/meta/all'],
  ['POST', '/categories'],
  ['PATCH', '/categories/{id}'],
  ['DELETE', '/categories/{id}'],
  ['POST', '/categories/groups'],
  ['PATCH', '/categories/groups/{id}'],
  ['DELETE', '/categories/groups/{id}'],
  ['GET', '/transactions'],
  ['PATCH', '/transactions/{id}'],
  ['DELETE', '/transactions/{id}'],
  ['POST', '/transactions'],
  ['POST', '/transactions/{id}/split'],
  ['POST', '/transactions/{id}/unsplit'],
  ['GET', '/transactions/rules/all'],
  ['POST', '/transactions/rules'],
  ['POST', '/transactions/rules/advanced'],
  ['POST', '/transactions/rules/test'],
  ['DELETE', '/transactions/rules/{id}'],
  ['DELETE', '/transactions/rules/advanced/{id}'],
  ['POST', '/import/upload'],
  ['POST', '/import/smart'],
  ['POST', '/import/preview'],
  ['POST', '/import/confirm'],
  ['GET', '/dashboard/{month}'],
  ['GET', '/budgets/{month}'],
  ['PUT', '/budgets/{month}/{categoryId}'],
  ['GET', '/commitments'],
  ['POST', '/commitments'],
  ['PATCH', '/commitments/{id}'],
  ['DELETE', '/commitments/{id}'],
  ['GET', '/funds'],
  ['POST', '/funds'],
  ['POST', '/funds/{id}/movement'],
  ['PATCH', '/funds/{id}'],
  ['DELETE', '/funds/{id}'],
  ['GET', '/income'],
  ['POST', '/income/sources'],
  ['PATCH', '/income/sources/{id}'],
  ['DELETE', '/income/sources/{id}'],
  ['PUT', '/income/{month}/{sourceId}'],
  ['GET', '/balances'],
  ['POST', '/balances'],
  ['DELETE', '/balances/{id}'],
  ['GET', '/projection'],
  ['POST', '/projection/scenarios'],
  ['GET', '/shares'],
  ['POST', '/shares'],
  ['DELETE', '/shares/{id}'],
  ['GET', '/share/{token}'],
  ['GET', '/recurrences'],
  ['POST', '/recurrences'],
  ['PATCH', '/recurrences/{id}'],
  ['POST', '/recurrences/{id}/post'],
  ['DELETE', '/recurrences/{id}'],
  ['GET', '/attachments'],
  ['POST', '/attachments'],
  ['GET', '/attachments/{id}/file'],
  ['DELETE', '/attachments/{id}'],
  ['GET', '/reports/history'],
  ['GET', '/reports/export/monthly/{month}.xlsx'],
  ['GET', '/reports/export/yearly/{year}.xlsx'],
  ['GET', '/reports/monthly/{month}'],
  ['GET', '/reports/yearly/{year}'],
  ['GET', '/reports/export/monthly/{month}'],
  ['GET', '/reports/export/yearly/{year}'],
  ['GET', '/settings'],
  ['PUT', '/settings'],
  ['GET', '/settings/ntfy'],
  ['PUT', '/settings/ntfy'],
  ['POST', '/settings/ntfy/test'],
  ['GET', '/settings/fx'],
  ['PUT', '/settings/fx'],
  ['DELETE', '/settings/fx'],
  ['POST', '/settings/fx/fetch'],
  ['GET', '/settings/backup'],
  ['DELETE', '/settings/spending'],
  ['POST', '/settings/restore'],
  ['POST', '/settings/models'],
  ['POST', '/settings/test'],
  ['POST', '/ai/suggest-categories'],
  ['POST', '/ai/chat'],
  ['POST', '/ai/dev-chat'],
  ['POST', '/ai/dev-apply'],
  ['GET', '/ai/audit'],
];

test('OpenAPI contract is parseable and uses OpenAPI 3.1', () => {
  assert.equal(document.openapi, '3.1.0');
  assert.equal(typeof document.info?.title, 'string');
  assert.ok(document.paths && typeof document.paths === 'object');
});

test('OpenAPI operationIds are unique', () => {
  const operationIds = Object.values(document.paths).flatMap((pathItem) =>
    Object.entries(pathItem)
      .filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method),
      )
      .map(([, operation]) => operation.operationId),
  );
  assert.equal(operationIds.length, expectedOperations.length);
  assert.equal(new Set(operationIds).size, operationIds.length);
  assert.ok(operationIds.every((operationId) => typeof operationId === 'string' && operationId));
});

test('OpenAPI covers every mounted API and public operation', () => {
  const documented = Object.entries(document.paths).flatMap(([routePath, pathItem]) =>
    Object.keys(pathItem)
      .filter((method) =>
        ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method),
      )
      .map((method) => `${method.toUpperCase()} ${routePath}`),
  );
  const expected = expectedOperations.map(([method, routePath]) => `${method} ${routePath}`);
  assert.deepEqual(documented.sort(), expected.sort());
});

test('OpenAPI defines the session cookie and reusable payload schemas', () => {
  assert.deepEqual(document.components.securitySchemes.bpSession, {
    type: 'apiKey',
    in: 'cookie',
    name: 'bp_session',
    description: 'HttpOnly session cookie issued by /auth/login or /auth/setup.',
  });
  for (const schema of ['Error', 'Json', 'Binary', 'Multipart']) {
    assert.ok(document.components.schemas[schema], `missing reusable ${schema} schema`);
  }
});

test('OpenAPI documents strict projection scenario payloads', () => {
  const request = document.components.requestBodies.ProjectionScenarios;
  assert.ok(request);
  const schema = document.components.schemas.ProjectionScenarios;
  assert.deepEqual(schema.required, ['horizon', 'scenarios']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.horizon.minimum, 1);
  assert.equal(schema.properties.horizon.maximum, 240);
  assert.equal(schema.properties.scenarios.maxItems, 3);
  assert.equal(document.components.schemas.ProjectionScenario.additionalProperties, false);
  assert.equal(document.components.schemas.ProjectionOneOff.additionalProperties, false);
});
