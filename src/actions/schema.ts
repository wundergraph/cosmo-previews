import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import type { Inputs } from '../types';

type Context = typeof github.context;

const COMMENT_MARKER = '<!-- cosmo-schema-check -->';

interface CheckResult {
  namespace: string;
  subgraphName: string;
  status: string;
  url: string;
  lintErrors: number;
  lintWarnings: number;
  message: string;
}

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

      const lint = json.lint as { errors?: unknown[]; warnings?: unknown[] } | undefined;
      results.push({
        namespace,
        subgraphName: subgraph.name,
        status: (json.status as string) ?? 'unknown',
        url: (json.url as string) ?? '',
        lintErrors: lint?.errors?.length ?? 0,
        lintWarnings: lint?.warnings?.length ?? 0,
        message: (json.message as string) ?? '',
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

  const body = `${COMMENT_MARKER}\n## Schema Check Results\n\n${table}`;

  await upsertComment({ githubToken: inputs.githubToken, prNumber, context, body });

  if (hasFailure) {
    core.setFailed('One or more schema checks failed. See the PR comment for details.');
  }
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
