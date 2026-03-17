import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import type { WhoAmICommandJsonOutput } from 'wgc/dist/src/core/types/types';
import { getInputs } from './inputs';
import { getChangedFilesFromGithubAPI, getFilteredChangedFiles } from './githubFiles';
import { checkConfigChanged, previewCreate, previewDelete, previewUpdate } from './actions/preview';
import { schemaCheck } from './actions/schema';

const installWgc = async () => {
  core.info('Installing wgc CLI...');
  await exec.exec('npm install -g wgc@latest');
};

const exportApiKey = (apiKey: string) => {
  core.exportVariable('COSMO_API_KEY', apiKey);
  core.info('Environment variable COSMO_API_KEY is set.');
};

const getOrganizationDetails = async (): Promise<WhoAmICommandJsonOutput | undefined> => {
  let output = '';
  let error = '';
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        error += data.toString();
      },
    },
  };
  await exec.exec(`wgc auth whoami --json`, [], options);
  const data = JSON.parse(output);
  if (data.status !== 'success') {
    core.setFailed(error);
    return;
  }
  return data;
};

export async function run(): Promise<void> {
  try {
    const { context } = github;

    const pullRequest = context.payload.pull_request;
    if (!pullRequest) {
      core.setFailed('This action only works with pull_requests.');
      return;
    }

    const prNumber = pullRequest.number;

    const inputs = getInputs();
    if (!inputs) {
      return;
    }

    await installWgc();
    exportApiKey(inputs.cosmoApiKey);
    const organizationDetails = await getOrganizationDetails();
    if (!organizationDetails) {
      core.setFailed('Failed to get organization details.');
      return;
    }

    const changedFiles = await getChangedFilesFromGithubAPI({ githubToken: inputs.githubToken });
    const changedGraphQLFiles = getFilteredChangedFiles({
      allDiffFiles: changedFiles,
      filePatterns: ['**/*.graphql', '**/*.gql', '**/*.graphqls'],
    });

    if (inputs.action === 'preview') {
      if (inputs.stage === 'update') {
        const changed = await checkConfigChanged({ inputs, prNumber, context });
        if (changed) {
          return;
        }
      }

      switch (inputs.stage) {
        case 'create': {
          await previewCreate({
            inputs,
            prNumber,
            changedGraphQLFiles,
            context,
            organizationSlug: organizationDetails.organizationSlug,
          });
          break;
        }
        case 'update': {
          await previewUpdate({
            inputs,
            prNumber,
            changedGraphQLFiles,
            context,
            organizationSlug: organizationDetails.organizationSlug,
          });
          break;
        }
        case 'delete': {
          await previewDelete({ inputs, prNumber, changedGraphQLFiles });
          break;
        }
      }
    } else if (inputs.action === 'schema') {
      switch (inputs.stage) {
        case 'check': {
          await schemaCheck({ inputs, prNumber, changedGraphQLFiles, context });
          break;
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}
