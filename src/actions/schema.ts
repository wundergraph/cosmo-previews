import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import type { Inputs } from '../types';

type Context = typeof github.context;

const COMMENT_MARKER = '<!-- cosmo-schema-check -->';

interface LintIssue {
  lintRuleType: string;
  message: string;
  issueLocation?: { line?: number };
}

interface CompositionIssue {
  federatedGraphName: string;
  namespace: string;
  message: string;
}

interface SchemaChange {
  changeType: string;
  message: string;
}

interface GraphPruneIssue {
  graphPruningRuleType: string;
  fieldPath: string;
  message: string;
  issueLocation?: { line?: number };
}

export interface CheckResult {
  namespace: string;
  subgraphName: string;
  status: string;
  url: string;
  lintErrors: number;
  lintWarnings: number;
  message: string;
  changes?: {
    breaking: SchemaChange[];
    nonBreaking: SchemaChange[];
  };
  composition?: {
    errors: CompositionIssue[];
    warnings: CompositionIssue[];
  };
  lint?: {
    errors: LintIssue[];
    warnings: LintIssue[];
  };
  graphPrune?: {
    errors: GraphPruneIssue[];
    warnings: GraphPruneIssue[];
  };
}

export const hasIssues = (r: CheckResult): boolean => {
  const breaking = r.changes?.breaking?.length ?? 0;
  const compErrors = r.composition?.errors?.length ?? 0;
  const compWarnings = r.composition?.warnings?.length ?? 0;
  const lintErr = r.lint?.errors?.length ?? 0;
  const lintWarn = r.lint?.warnings?.length ?? 0;
  const pruneErr = r.graphPrune?.errors?.length ?? 0;
  const pruneWarn = r.graphPrune?.warnings?.length ?? 0;
  return breaking + compErrors + compWarnings + lintErr + lintWarn + pruneErr + pruneWarn > 0;
};

export const buildDetailsSection = (results: CheckResult[]): string => {
  const withIssues = results.filter(hasIssues);
  if (withIssues.length === 0) {
    return '';
  }

  const sections: string[] = [];

  for (const r of withIssues) {
    const parts: string[] = [];

    if (r.changes?.breaking?.length) {
      parts.push(
        '#### Breaking Changes\n| Type | Description |\n| --- | --- |',
        ...r.changes.breaking.map((c) => `| ${c.changeType} | ${c.message} |`),
      );
    }

    if (r.composition?.errors?.length) {
      parts.push(
        '#### Composition Errors\n| Graph | Namespace | Message |\n| --- | --- | --- |',
        ...r.composition.errors.map(
          (c) => `| ${c.federatedGraphName} | ${c.namespace} | ${c.message} |`,
        ),
      );
    }

    if (r.composition?.warnings?.length) {
      parts.push(
        '#### Composition Warnings\n| Graph | Namespace | Message |\n| --- | --- | --- |',
        ...r.composition.warnings.map(
          (c) => `| ${c.federatedGraphName} | ${c.namespace} | ${c.message} |`,
        ),
      );
    }

    if (r.lint?.errors?.length) {
      parts.push(
        '#### Lint Errors\n| Rule | Message | Line |\n| --- | --- | --- |',
        ...r.lint.errors.map(
          (l) => `| ${l.lintRuleType} | ${l.message} | ${l.issueLocation?.line ?? '-'} |`,
        ),
      );
    }

    if (r.lint?.warnings?.length) {
      parts.push(
        '#### Lint Warnings\n| Rule | Message | Line |\n| --- | --- | --- |',
        ...r.lint.warnings.map(
          (l) => `| ${l.lintRuleType} | ${l.message} | ${l.issueLocation?.line ?? '-'} |`,
        ),
      );
    }

    if (r.graphPrune?.errors?.length) {
      parts.push(
        '#### Graph Pruning Errors\n| Rule | Field Path | Message | Line |\n| --- | --- | --- | --- |',
        ...r.graphPrune.errors.map(
          (g) =>
            `| ${g.graphPruningRuleType} | ${g.fieldPath} | ${g.message} | ${g.issueLocation?.line ?? '-'} |`,
        ),
      );
    }

    if (r.graphPrune?.warnings?.length) {
      parts.push(
        '#### Graph Pruning Warnings\n| Rule | Field Path | Message | Line |\n| --- | --- | --- | --- |',
        ...r.graphPrune.warnings.map(
          (g) =>
            `| ${g.graphPruningRuleType} | ${g.fieldPath} | ${g.message} | ${g.issueLocation?.line ?? '-'} |`,
        ),
      );
    }

    const counts: string[] = [];
    const errCount =
      (r.changes?.breaking?.length ?? 0) +
      (r.composition?.errors?.length ?? 0) +
      (r.lint?.errors?.length ?? 0) +
      (r.graphPrune?.errors?.length ?? 0);
    const warnCount =
      (r.composition?.warnings?.length ?? 0) +
      (r.lint?.warnings?.length ?? 0) +
      (r.graphPrune?.warnings?.length ?? 0);
    if (errCount > 0) {
      counts.push(`${errCount} error${errCount === 1 ? '' : 's'}`);
    }
    if (warnCount > 0) {
      counts.push(`${warnCount} warning${warnCount === 1 ? '' : 's'}`);
    }

    sections.push(
      `<details>\n<summary><b>${r.namespace} / ${r.subgraphName}</b> — ${counts.join(', ')}</summary>\n\n${parts.join('\n')}\n\n</details>`,
    );
  }

  return sections.join('\n\n');
};

const upsertComment = async ({
  githubToken,
  prNumber,
  context,
  body,
}: {
  githubToken: string;
  prNumber: number;
  context: Context;
  body: string;
}): Promise<void> => {
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = context.repo;

  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.data.find((c) => c.body?.startsWith(COMMENT_MARKER));

  await (existing
    ? octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
    : octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body }));
};

export const schemaCheck = async ({
  inputs,
  prNumber,
  context,
}: {
  inputs: Inputs;
  prNumber: number;
  context: Context;
}): Promise<void> => {
  if (!inputs.check) {
    core.setFailed('Schema check requires a check section in the config.');
    return;
  }

  const results: CheckResult[] = [];

  for (const subgraph of inputs.subgraphs) {
    for (const namespace of inputs.check.namespaces) {
      const outFile = join(
        tmpdir(),
        `cosmo-check-${subgraph.name}-${namespace}-${Date.now()}.json`,
      );
      const command = `wgc subgraph check ${subgraph.name} --schema ${subgraph.schema_path} -n ${namespace} -j --out ${outFile}`;

      const exitCode = await exec.exec(command, [], { ignoreReturnCode: true });

      let json: Record<string, unknown> | undefined;
      try {
        const fileContent = readFileSync(outFile, 'utf8');
        json = JSON.parse(fileContent);
        unlinkSync(outFile);
      } catch {
        // File may not exist if the command failed before writing
      }

      if (!json) {
        results.push({
          namespace,
          subgraphName: subgraph.name,
          status: exitCode === 0 ? 'unknown' : 'error',
          url: '',
          lintErrors: 0,
          lintWarnings: 0,
          message: 'Failed to parse wgc output',
        });
        continue;
      }

      const lint = json.lint as CheckResult['lint'] | undefined;
      const changes = json.changes as CheckResult['changes'] | undefined;
      const composition = json.composition as CheckResult['composition'] | undefined;
      const graphPrune = json.graphPrune as CheckResult['graphPrune'] | undefined;
      results.push({
        namespace,
        subgraphName: subgraph.name,
        status: (json.status as string) ?? 'unknown',
        url: (json.url as string) ?? '',
        lintErrors: lint?.errors?.length ?? 0,
        lintWarnings: lint?.warnings?.length ?? 0,
        message: (json.message as string) ?? '',
        changes,
        composition,
        lint,
        graphPrune,
      });
    }
  }

  if (results.length === 0) {
    core.info('No subgraphs configured for schema checks.');
    return;
  }

  core.setOutput('schema_check_results', results);

  const hasFailure = results.some((r) => r.status !== 'success');

  const tableHeader =
    '| Namespace | Subgraph | Status | Lint Errors | Lint Warnings | |\n| --- | --- | --- | --- | --- | --- |\n';
  const tableRows = results.map((r) => {
    const statusIcon = r.status === 'success' ? '✅' : '❌';
    const link = r.url ? `[View in Studio](${r.url})` : '-';
    return `| ${r.namespace} | ${r.subgraphName} | ${statusIcon} ${r.status} | ${r.lintErrors} | ${r.lintWarnings} | ${link} |`;
  });
  const table = `${tableHeader}${tableRows.join('\n')}`;

  const details = buildDetailsSection(results);
  const body = details
    ? `${COMMENT_MARKER}\n## Schema Check Results\n\n${table}\n\n---\n\n${details}`
    : `${COMMENT_MARKER}\n## Schema Check Results\n\n${table}`;

  await upsertComment({ githubToken: inputs.githubToken, prNumber, context, body });

  if (hasFailure) {
    core.setFailed('One or more schema checks failed. See the PR comment for details.');
  }
};
