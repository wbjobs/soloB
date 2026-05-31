const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const CodeVersion = require('../models/CodeVersion');

const reposDir = path.join(os.tmpdir(), 'code-collab-repos');

const getRepoPath = (roomId) => {
  return path.join(reposDir, roomId);
};

const ensureRepo = async (roomId) => {
  const repoPath = getRepoPath(roomId);

  try {
    await fs.access(repoPath);
  } catch {
    await fs.mkdir(repoPath, { recursive: true });
  }

  const git = simpleGit(repoPath);

  try {
    await git.revparse(['--is-inside-work-tree']);
  } catch {
    await git.init();
    await git.addConfig('user.email', 'code-collab@local.dev');
    await git.addConfig('user.name', 'Code Collab');
  }

  return git;
};

const saveVersion = async ({
  roomId,
  fileId,
  fileName,
  content,
  language,
  authorId,
  authorName,
  message = 'Auto-save'
}) => {
  const git = await ensureRepo(roomId);
  const repoPath = getRepoPath(roomId);
  const filePath = path.join(repoPath, fileName);

  await fs.writeFile(filePath, content);

  await git.add(fileName);

  try {
    const status = await git.status();
    if (status.files.length === 0) {
      return null;
    }
  } catch {
    return null;
  }

  const commitResult = await git.commit(message, [fileName], {
    '--author': `"${authorName} <${authorId}@local.dev>"`
  });

  const commitHash = commitResult.commit || (await git.revparse(['HEAD'])).trim();

  let changes = '';
  try {
    changes = await git.diff(['HEAD~1', 'HEAD', fileName]);
  } catch {
    changes = content;
  }

  const parentCommit = (await git.revparse(['HEAD^']).catch(() => null)) || null;

  const version = new CodeVersion({
    roomId,
    fileId,
    commitHash,
    authorId,
    authorName,
    message,
    content,
    language,
    changes,
    parentCommit,
    createdAt: new Date()
  });

  await version.save();
  return version.toObject();
};

const getHistory = async (roomId, fileId, options = {}) => {
  const { limit = 50, offset = 0 } = options;

  const versions = await CodeVersion.find({ roomId, fileId })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

  return versions;
};

const getVersion = async (roomId, commitHash) => {
  const version = await CodeVersion.findOne({ roomId, commitHash }).lean();
  return version;
};

const getVersionById = async (versionId) => {
  const version = await CodeVersion.findById(versionId).lean();
  return version;
};

const compareVersions = async (roomId, fileId, fromCommit, toCommit) => {
  const git = await ensureRepo(roomId);

  let diff = '';
  try {
    diff = await git.diff([fromCommit, toCommit]);
  } catch {
    const fromVersion = await CodeVersion.findOne({ roomId, commitHash: fromCommit }).lean();
    const toVersion = await CodeVersion.findOne({ roomId, commitHash: toCommit }).lean();

    if (fromVersion && toVersion) {
      diff = `--- a/old\n+++ b/new\n${toVersion.content}`;
    }
  }

  return parseDiff(diff);
};

const parseDiff = (diff) => {
  const lines = diff.split('\n');
  const hunks = [];
  let currentHunk = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        header: line,
        changes: []
      };
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.changes.push({ type: 'add', content: line.slice(1) });
      } else if (line.startsWith('-')) {
        currentHunk.changes.push({ type: 'remove', content: line.slice(1) });
      } else {
        currentHunk.changes.push({ type: 'context', content: line.slice(1) || line });
      }
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  return {
    raw: diff,
    hunks
  };
};

const rollbackToVersion = async ({
  roomId,
  fileId,
  commitHash,
  authorId,
  authorName
}) => {
  const targetVersion = await CodeVersion.findOne({
    roomId,
    fileId,
    commitHash
  }).lean();

  if (!targetVersion) {
    throw new Error('Version not found');
  }

  const newVersion = await saveVersion({
    roomId,
    fileId,
    fileName: `${fileId}.txt`,
    content: targetVersion.content,
    language: targetVersion.language,
    authorId,
    authorName,
    message: `Rollback to ${commitHash.slice(0, 7)}`
  });

  return {
    content: targetVersion.content,
    version: newVersion,
    previousCommit: commitHash
  };
};

const getLatestVersion = async (roomId, fileId) => {
  const version = await CodeVersion.findOne({ roomId, fileId })
    .sort({ createdAt: -1 })
    .lean();

  return version;
};

module.exports = {
  saveVersion,
  getHistory,
  getVersion,
  getVersionById,
  compareVersions,
  rollbackToVersion,
  getLatestVersion,
  ensureRepo
};
