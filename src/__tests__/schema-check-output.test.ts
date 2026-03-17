import { describe, expect, it } from 'vitest';
import { buildDetailsSection, hasIssues } from '../actions/schema';
import type { CheckResult } from '../actions/schema';

const baseResult: CheckResult = {
  namespace: 'dev1',
  subgraphName: 'my-subgraph',
  status: 'success',
  url: '',
  message: '',
};

describe('hasIssues', () => {
  it('returns false for a clean result', () => {
    expect(hasIssues(baseResult)).toBe(false);
  });

  it('returns true when there are lint warnings', () => {
    expect(
      hasIssues({
        ...baseResult,
        lint: {
          errors: [],
          warnings: [
            {
              lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
              message: 'bad name',
              issueLocation: { line: 10 },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('returns true when there are breaking changes', () => {
    expect(
      hasIssues({
        ...baseResult,
        changes: {
          breaking: [{ changeType: 'FIELD_REMOVED', message: 'Field removed' }],
          nonBreaking: [],
        },
      }),
    ).toBe(true);
  });

  it('returns true when there are composition errors', () => {
    expect(
      hasIssues({
        ...baseResult,
        composition: {
          errors: [{ federatedGraphName: 'graph', namespace: 'dev1', message: 'error' }],
          warnings: [],
        },
      }),
    ).toBe(true);
  });

  it('returns true when there are graph prune warnings', () => {
    expect(
      hasIssues({
        ...baseResult,
        graphPrune: {
          errors: [],
          warnings: [
            {
              graphPruningRuleType: 'UNUSED_FIELD',
              fieldPath: 'Query.old',
              message: 'unused',
              issueLocation: { line: 5 },
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe('buildDetailsSection', () => {
  it('returns empty string when no results have issues', () => {
    expect(buildDetailsSection([baseResult])).toBe('');
  });

  it('builds a collapsible section for lint warnings', () => {
    const result: CheckResult = {
      ...baseResult,
      lint: {
        errors: [],
        warnings: [
          {
            lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
            message: 'Use camelCase',
            issueLocation: { line: 42 },
          },
        ],
      },
    };

    const output = buildDetailsSection([result]);
    expect(output).toContain('<details>');
    expect(output).toContain('<summary><b>dev1 / my-subgraph</b>');
    expect(output).toContain('1 warning');
    expect(output).toContain('#### Lint Warnings');
    expect(output).toContain('FIELD_NAMES_SHOULD_BE_CAMEL_CASE');
    expect(output).toContain('Use camelCase');
    expect(output).toContain('42');
    expect(output).toContain('</details>');
  });

  it('builds a collapsible section for breaking changes', () => {
    const result: CheckResult = {
      ...baseResult,
      status: 'error',
      changes: {
        breaking: [
          {
            changeType: 'FIELD_REMOVED',
            message: 'Field "liveClientConfig" was removed from object type "Query"',
          },
          {
            changeType: 'FIELD_TYPE_CHANGED',
            message: 'Field "lots" arg "showId" changed type from "ID!" to "String!"',
          },
        ],
        nonBreaking: [],
      },
    };

    const output = buildDetailsSection([result]);
    expect(output).toContain('2 errors');
    expect(output).toContain('#### Breaking Changes');
    expect(output).toContain('FIELD_REMOVED');
    expect(output).toContain('FIELD_TYPE_CHANGED');
  });

  it('shows both errors and warnings in the summary count', () => {
    const result: CheckResult = {
      ...baseResult,
      changes: {
        breaking: [{ changeType: 'FIELD_REMOVED', message: 'removed' }],
        nonBreaking: [],
      },
      lint: {
        errors: [],
        warnings: [
          { lintRuleType: 'RULE_A', message: 'warn1' },
          { lintRuleType: 'RULE_B', message: 'warn2' },
        ],
      },
    };

    const output = buildDetailsSection([result]);
    expect(output).toContain('1 error');
    expect(output).toContain('2 warnings');
  });

  it('renders multiple subgraph/namespace combos as separate collapsible sections', () => {
    const results: CheckResult[] = [
      {
        ...baseResult,
        namespace: 'dev1',
        subgraphName: 'svc-a',
        lint: {
          errors: [{ lintRuleType: 'BAD_RULE', message: 'lint error' }],
          warnings: [],
        },
      },
      {
        ...baseResult,
        namespace: 'staging',
        subgraphName: 'svc-b',
        composition: {
          errors: [],
          warnings: [{ federatedGraphName: 'main', namespace: 'staging', message: 'comp warning' }],
        },
      },
    ];

    const output = buildDetailsSection(results);
    expect(output).toContain('<b>dev1 / svc-a</b>');
    expect(output).toContain('<b>staging / svc-b</b>');
    const detailsCount = (output.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(2);
  });

  it('skips results with no issues in a mixed list', () => {
    const results: CheckResult[] = [
      baseResult,
      {
        ...baseResult,
        namespace: 'staging',
        lint: {
          errors: [],
          warnings: [{ lintRuleType: 'RULE', message: 'warning' }],
        },
      },
    ];

    const output = buildDetailsSection(results);
    expect(output).not.toContain('<b>dev1 / my-subgraph</b>');
    expect(output).toContain('<b>staging / my-subgraph</b>');
  });

  it('renders lint issue line as dash when missing', () => {
    const result: CheckResult = {
      ...baseResult,
      lint: {
        errors: [{ lintRuleType: 'RULE', message: 'no line info' }],
        warnings: [],
      },
    };

    const output = buildDetailsSection([result]);
    expect(output).toContain('| RULE | no line info | - |');
  });

  it('renders composition errors table', () => {
    const result: CheckResult = {
      ...baseResult,
      composition: {
        errors: [
          { federatedGraphName: 'main-graph', namespace: 'dev1', message: 'Cannot compose' },
        ],
        warnings: [],
      },
    };

    const output = buildDetailsSection([result]);
    expect(output).toContain('#### Composition Errors');
    expect(output).toContain('main-graph');
    expect(output).toContain('Cannot compose');
  });

  it('renders graph pruning warnings table', () => {
    const result: CheckResult = {
      ...baseResult,
      graphPrune: {
        errors: [],
        warnings: [
          {
            graphPruningRuleType: 'UNUSED_FIELD',
            fieldPath: 'Query.deprecated',
            message: 'Field is unused',
            issueLocation: { line: 15 },
          },
        ],
      },
    };

    const output = buildDetailsSection([result]);
    expect(output).toContain('#### Graph Pruning Warnings');
    expect(output).toContain('UNUSED_FIELD');
    expect(output).toContain('Query.deprecated');
    expect(output).toContain('15');
  });
});
