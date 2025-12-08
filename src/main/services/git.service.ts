import simpleGit, { SimpleGit, LogResult } from 'simple-git';
import * as path from 'path';
import Store from 'electron-store';
import type { Commit, Branch, FileChange, Session } from '../../shared/types';

export class GitService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;

  constructor() {
    this.store = new Store({ name: 'grep-sessions' });
  }

  private getWorktreePath(sessionId: string): string {
    const session = this.store.get(`sessions.${sessionId}`) as { worktreePath: string } | undefined;
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.worktreePath;
  }

  private getGit(sessionId: string): SimpleGit {
    const worktreePath = this.getWorktreePath(sessionId);
    return simpleGit(worktreePath);
  }

  async clone(url: string, targetPath: string): Promise<void> {
    const git = simpleGit();
    await git.clone(url, targetPath);
  }

  async createWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    const git = simpleGit(repoPath);

    // Check if branch exists
    const branches = await git.branch();
    const branchExists = branches.all.includes(branch) ||
                         branches.all.includes(`remotes/origin/${branch}`);

    if (branchExists) {
      await git.raw(['worktree', 'add', worktreePath, branch]);
    } else {
      // Create new branch from current HEAD
      await git.raw(['worktree', 'add', '-b', branch, worktreePath]);
    }
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    const git = simpleGit(repoPath);
    await git.raw(['worktree', 'remove', worktreePath, '--force']);
  }

  async getStatus(sessionId: string): Promise<{
    current: string | null;
    tracking: string | null;
    files: FileChange[];
    ahead: number;
    behind: number;
  }> {
    const git = this.getGit(sessionId);
    const status = await git.status();

    return {
      current: status.current,
      tracking: status.tracking,
      files: [
        ...status.created.map(f => ({ path: f, status: 'added' as const, additions: 0, deletions: 0 })),
        ...status.modified.map(f => ({ path: f, status: 'modified' as const, additions: 0, deletions: 0 })),
        ...status.deleted.map(f => ({ path: f, status: 'deleted' as const, additions: 0, deletions: 0 })),
        ...status.renamed.map(r => ({ path: r.to, status: 'renamed' as const, additions: 0, deletions: 0 })),
      ],
      ahead: status.ahead,
      behind: status.behind,
    };
  }

  async getLog(sessionId: string, limit: number = 50): Promise<Commit[]> {
    const git = this.getGit(sessionId);
    const log = await git.log({ maxCount: limit });

    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      authorEmail: entry.author_email,
      date: new Date(entry.date),
      parents: entry.refs.split(',').filter(Boolean),
    }));
  }

  async getBranches(sessionId: string): Promise<Branch[]> {
    const git = this.getGit(sessionId);
    const branches = await git.branch(['-a', '-v']);

    return branches.all.map(name => ({
      name: name.replace('remotes/origin/', ''),
      current: name === branches.current,
      remote: name.startsWith('remotes/') ? name.split('/')[1] : undefined,
      commit: branches.branches[name]?.commit || '',
    }));
  }

  async checkout(sessionId: string, branch: string): Promise<void> {
    const git = this.getGit(sessionId);
    await git.checkout(branch);
  }

  async getDiff(sessionId: string, commitHash?: string): Promise<string> {
    const git = this.getGit(sessionId);

    if (commitHash) {
      return git.diff([`${commitHash}^`, commitHash]);
    }

    // Get diff of working directory
    const staged = await git.diff(['--staged']);
    const unstaged = await git.diff();

    return `${staged}\n${unstaged}`.trim();
  }

  async commit(sessionId: string, message: string): Promise<string> {
    const git = this.getGit(sessionId);

    // Stage all changes
    await git.add('.');

    const result = await git.commit(message);
    return result.commit;
  }

  async push(sessionId: string): Promise<void> {
    const git = this.getGit(sessionId);
    const status = await git.status();

    if (status.tracking) {
      await git.push();
    } else if (status.current) {
      await git.push(['-u', 'origin', status.current]);
    }
  }

  async pull(sessionId: string): Promise<void> {
    const git = this.getGit(sessionId);
    await git.pull();
  }

  async stash(sessionId: string): Promise<void> {
    const git = this.getGit(sessionId);
    await git.stash();
  }

  async stashPop(sessionId: string): Promise<void> {
    const git = this.getGit(sessionId);
    await git.stash(['pop']);
  }
}
