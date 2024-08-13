import { resolve } from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import mm from 'micromatch';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import { Inputs, getInputs } from './inputs.js';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const context = github.context;

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

    setUpWgc(inputs.cosmoApiKey);

    const changedFiles = await getChangedFilesFromGithubAPI({ githubToken: inputs.githubToken });
    const changedGraphQLFiles = getFilteredChangedFiles({
      allDiffFiles: changedFiles,
      filePatterns: ['**/*.graphql', '**/*.gql', '**/*.graphqls'],
    });

    if (inputs.actionType === 'update') {
      const isCosmoConfigChanged =
        getFilteredChangedFiles({
          allDiffFiles: changedFiles,
          filePatterns: ['cosmo.yaml'],
        }).length > 0;
      if (isCosmoConfigChanged) {
        core.setFailed('Cosmo config file is changed. Please close and reopen the pr.');
      }
    }

    switch (inputs.actionType) {
      case 'create': {
        await create({ inputs, prNumber, changedGraphQLFiles });
        break;
      }
      case 'update': {
        await update({ inputs, prNumber, changedGraphQLFiles });
        break;
      }
      case 'destroy': {
        await destroy({ inputs, prNumber, changedGraphQLFiles });
        break;
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

/**
 * Exports the API key as an environment variable.
 */
function setUpWgc(apiKey: string) {
  // core.info('Installing wgc@latest globally...');
  // await exec.exec('npm install -g wgc');

  // // Adding npm global bin to PATH
  // const npmGlobalBin = await exec.getExecOutput('npm bin -g');
  // core.addPath(npmGlobalBin.stdout.trim());

  core.exportVariable('COSMO_API_KEY', apiKey);
  core.info('Environment variable COSMO_API_KEY is set.');
}

const create = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
}): Promise<void> => {
  // Create the resources
  const featureSubgraphs = [];
  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${subgraph.routingUrl} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphs.push(featureSubgraphName);
  }
  if (featureSubgraphs.length === 0) {
    core.info('No subgraphs found to create feature subgraphs.');
    return;
  }
  for (const featureFlag of inputs.featureFlags) {
    const command = `wgc feature-flag create ${featureFlag.name} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphs.join(' ')} --enabled`;
    await exec.exec(command);
  }
};

const update = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
}): Promise<void> => {
  // Update the resources
  const featureSubgraphs = [];
  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${subgraph.routingUrl} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphs.push(featureSubgraphName);
  }
  if (featureSubgraphs.length === 0) {
    core.info('No changes found in subgraphs to update feature subgraphs.');
    return;
  }
  for (const featureFlag of inputs.featureFlags) {
    const command = `wgc feature-flag update ${featureFlag.name} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphs.join(' ')}`;
    await exec.exec(command);
  }
};

const destroy = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
}): Promise<void> => {
  // Destroy the resources
  for (const featureFlag of inputs.featureFlags) {
    const command = `wgc feature-flag delete ${featureFlag.name} -n ${inputs.namespace} -f`;
    await exec.exec(command);
  }
  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc subgraph delete ${featureSubgraphName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
  }
};

export enum ChangeTypeEnum {
  Added = 'A',
  Copied = 'C',
  Deleted = 'D',
  Modified = 'M',
  Renamed = 'R',
  TypeChanged = 'T',
  Unmerged = 'U',
  Unknown = 'X',
}

export type ChangedFiles = {
  [key in ChangeTypeEnum]: string[];
};

export const getChangedFilesFromGithubAPI = async ({ githubToken }: { githubToken: string }): Promise<ChangedFiles> => {
  const octokit = github.getOctokit(githubToken);
  const changedFiles: ChangedFiles = {
    [ChangeTypeEnum.Added]: [],
    [ChangeTypeEnum.Copied]: [],
    [ChangeTypeEnum.Deleted]: [],
    [ChangeTypeEnum.Modified]: [],
    [ChangeTypeEnum.Renamed]: [],
    [ChangeTypeEnum.TypeChanged]: [],
    [ChangeTypeEnum.Unmerged]: [],
    [ChangeTypeEnum.Unknown]: [],
  };

  core.info('Getting changed files from GitHub API...');

  const options = octokit.rest.pulls.listFiles.endpoint.merge({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: github.context.payload.pull_request?.number,
    per_page: 100,
  });

  const paginatedResponse =
    await octokit.paginate<RestEndpointMethodTypes['pulls']['listFiles']['response']['data'][0]>(options);

  core.info(`Found ${paginatedResponse.length} changed files from GitHub API`);
  const statusMap: Record<string, ChangeTypeEnum> = {
    added: ChangeTypeEnum.Added,
    removed: ChangeTypeEnum.Deleted,
    modified: ChangeTypeEnum.Modified,
    renamed: ChangeTypeEnum.Renamed,
    copied: ChangeTypeEnum.Copied,
    changed: ChangeTypeEnum.TypeChanged,
    unchanged: ChangeTypeEnum.Unmerged,
  };

  for await (const item of paginatedResponse) {
    const changeType: ChangeTypeEnum = statusMap[item.status] || ChangeTypeEnum.Unknown;

    if (changeType === ChangeTypeEnum.Renamed) {
      changedFiles[ChangeTypeEnum.Deleted].push(item.filename);
      changedFiles[ChangeTypeEnum.Added].push(item.filename);
    } else {
      changedFiles[changeType].push(item.filename);
    }
  }

  return changedFiles;
};

export const isWindows = (): boolean => {
  return process.platform === 'win32';
};

export const normalizeSeparators = (p: string): string => {
  // Windows
  if (isWindows()) {
    // Convert slashes on Windows
    p = p.replace(/\//g, '\\');

    // Remove redundant slashes
    const isUnc = /^\\\\+[^\\]/.test(p); // e.g. \\hello
    p = (isUnc ? '\\' : '') + p.replace(/\\\\+/g, '\\'); // preserve leading \\ for UNC
  } else {
    // Remove redundant slashes on Linux/macOS
    p = p.replace(/\/\/+/g, '/');
  }

  return p;
};

export const getFilteredChangedFiles = ({
  allDiffFiles,
  filePatterns,
}: {
  allDiffFiles: ChangedFiles;
  filePatterns: string[];
}): string[] => {
  const changedFiles: string[] = [];
  const hasFilePatterns = filePatterns.length > 0;
  const isWin = isWindows();

  for (const changeType of Object.keys(allDiffFiles)) {
    const files = allDiffFiles[changeType as ChangeTypeEnum];
    if (hasFilePatterns) {
      changedFiles.push(
        ...mm(files, filePatterns, {
          dot: true,
          windows: isWin,
          noext: true,
        }).map((element) => normalizeSeparators(element)),
      );
    } else {
      changedFiles.push(...files);
    }
  }

  return changedFiles;
};
