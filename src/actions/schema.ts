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
      const command = `wgc subgraph check ${subgraph.name} --schema ${subgraph.schema_path} -n ${namespace} -j`;
      let output = '';
      const options = {
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
        },
        ignoreReturnCode: true,
      };

      await exec.exec(command, [], options);

      if (!output) {
        results.push({
          namespace,
          subgraphName: subgraph.name,
          status: 'error',
          url: '',
          lintErrors: 0,
          lintWarnings: 0,
          message: 'No output from wgc subgraph check',
        });
        continue;
      }

      const json = JSON.parse(output);
      results.push({
        namespace,
        subgraphName: subgraph.name,
        status: json.status ?? 'unknown',
        url: json.url ?? '',
        lintErrors: json.lint?.errors?.length ?? 0,
        lintWarnings: json.lint?.warnings?.length ?? 0,
        message: json.message ?? '',
      });
    }
  }

  if (results.length === 0) {
    core.info('No subgraph schema changes detected. Skipping schema check.');
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
