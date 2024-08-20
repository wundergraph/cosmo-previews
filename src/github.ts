import * as github from '@actions/github';
import * as core from '@actions/core';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import mm from 'micromatch';

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

  for (const changeType of Object.keys(allDiffFiles)) {
    const files = allDiffFiles[changeType as ChangeTypeEnum];
    if (hasFilePatterns) {
      changedFiles.push(
        ...mm(files, filePatterns, {
          dot: true,
          noext: true,
        }).map((element) => normalizeSeparators(element)),
      );
    } else {
      changedFiles.push(...files);
    }
  }

  return changedFiles;
};

export const getRemovedGraphQLFilesInLastCommit = async ({
  githubToken,
  prNumber,
  changedGraphQLFilesInPr,
}: {
  githubToken: string;
  prNumber: number;
  changedGraphQLFilesInPr: string[];
}) => {
  const octokit = github.getOctokit(githubToken);

  // Step 1: Get the list of commits in the pull request
  const commits = await octokit.rest.pulls.listCommits({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
  });

  // Get the last commit
  const lastCommit = commits.data.at(-1);
  if (!lastCommit) {
    return [];
  }
  const lastCommitSha = lastCommit.sha;

  // Get the list of files in the last commit
  const commitFiles = await octokit.rest.repos.getCommit({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    ref: lastCommitSha,
  });
  if (!commitFiles.data.files) {
    return [];
  }

  // Filter out the files that were removed
  const modifiedFiles = commitFiles.data.files?.filter((file) => file.status === 'modified');
  const modifiedFilePaths = modifiedFiles.map((file) => file.filename);

  const modifiedGraphQLFiles: string[] = mm(modifiedFilePaths, ['**/*.graphql', '**/*.gql', '**/*.graphqls'], {
    dot: true,
    noext: true,
  }).map((element) => normalizeSeparators(element));

  // find the file changes which exist in the last commit, but not in the current PR
  // happens when a file is removed in the last commit, or when the changes are reverted.
  const removedGraphQLFiles = modifiedGraphQLFiles.filter((file) => !changedGraphQLFilesInPr.includes(file));

  console.log('Removed files:', modifiedGraphQLFiles, removedGraphQLFiles);

  return removedGraphQLFiles;
};
