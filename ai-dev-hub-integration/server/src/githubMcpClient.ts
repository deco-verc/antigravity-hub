import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GitManager } from './gitManager.js';

export interface GitHubIssue {
  number: number;
  id?: number | string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

export interface GitHubPullRequest {
  number: number;
  id?: number | string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  merged?: boolean;
}

export class GitHubMcpClient {
  private static client: Client | null = null;
  private static transport: StdioClientTransport | null = null;
  private static isConnecting = false;

  private static async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.isConnecting) {
      while (this.isConnecting) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (this.client) return this.client;
    }

    this.isConnecting = true;
    try {
      const runnerPath = path.resolve(process.cwd(), '..', 'github-mcp-stdio.js');
      const stdioPath = path.resolve(process.cwd(), 'github-mcp-stdio.js');
      const scriptPath = fs.existsSync(stdioPath) ? stdioPath : runnerPath;
      const token = GitManager.getStoredGitHubToken();
      const cleanEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') cleanEnv[k] = v;
      }
      if (token) {
        cleanEnv.GITHUB_PERSONAL_ACCESS_TOKEN = token;
        cleanEnv.GITHUB_TOKEN = token;
      }

      this.transport = new StdioClientTransport({
        command: 'node',
        args: [scriptPath],
        env: cleanEnv
      });

      this.client = new Client(
        { name: 'ai-dev-hub-github', version: '1.0.0' },
        { capabilities: {} }
      );

      await this.client.connect(this.transport);
      return this.client;
    } finally {
      this.isConnecting = false;
    }
  }

  private static async call(toolName: string, args: Record<string, any>): Promise<any> {
    const client = await this.getClient();
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    const content = (result as any).content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      if (first.type === 'text') {
        try {
          return JSON.parse(first.text);
        } catch {
          return first.text;
        }
      }
    }
    return content;
  }

  // --- ISSUES ---

  static async listIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubIssue[]> {
    const res = await this.call('list_issues', { owner, repo, state });
    return Array.isArray(res) ? res : (res?.items || []);
  }

  static async getIssue(owner: string, repo: string, issue_number: number): Promise<GitHubIssue> {
    return await this.call('get_issue', { owner, repo, issue_number });
  }

  static async createIssue(owner: string, repo: string, title: string, body: string, labels?: string[]): Promise<GitHubIssue> {
    const args: any = { owner, repo, title, body };
    if (labels && labels.length > 0) args.labels = labels;
    return await this.call('create_issue', args);
  }

  static async updateIssue(owner: string, repo: string, issue_number: number, updates: {
    state?: 'open' | 'closed';
    title?: string;
    body?: string;
    labels?: string[];
  }): Promise<GitHubIssue> {
    return await this.call('update_issue', { owner, repo, issue_number, ...updates });
  }

  static async addIssueComment(owner: string, repo: string, issue_number: number, body: string): Promise<any> {
    return await this.call('add_issue_comment', { owner, repo, issue_number, body });
  }

  // --- BRANCHES ---

  static async createBranch(owner: string, repo: string, branch: string, from_branch = 'main'): Promise<any> {
    return await this.call('create_branch', { owner, repo, branch, from_branch });
  }

  // --- PULL REQUESTS ---

  static async listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPullRequest[]> {
    const res = await this.call('list_pull_requests', { owner, repo, state });
    return Array.isArray(res) ? res : [];
  }

  static async getPullRequest(owner: string, repo: string, pull_number: number): Promise<GitHubPullRequest> {
    return await this.call('get_pull_request', { owner, repo, pull_number });
  }

  static async createPullRequest(owner: string, repo: string, title: string, body: string, head: string, base = 'main'): Promise<GitHubPullRequest> {
    return await this.call('create_pull_request', { owner, repo, title, body, head, base });
  }

  static async getPullRequestFiles(owner: string, repo: string, pull_number: number): Promise<any[]> {
    return await this.call('get_pull_request_files', { owner, repo, pull_number });
  }

  static async createPullRequestReview(owner: string, repo: string, pull_number: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string): Promise<any> {
    return await this.call('create_pull_request_review', { owner, repo, pull_number, event, body });
  }

  static async mergePullRequest(owner: string, repo: string, pull_number: number, commit_title?: string): Promise<any> {
    try {
      const args: any = { owner, repo, pull_number };
      if (commit_title) args.commit_title = commit_title;
      return await this.call('merge_pull_request', args);
    } catch (err: any) {
      try {
        const { execSync } = await import('node:child_process');
        execSync(`gh pr merge ${pull_number} --repo ${owner}/${repo} --merge`, { stdio: 'pipe', timeout: 15000 });
        return { merged: true };
      } catch {
        throw err;
      }
    }
  }

  // --- REPOSITORIES ---

  static async searchRepositories(query: string): Promise<any> {
    return await this.call('search_repositories', { query });
  }
}
