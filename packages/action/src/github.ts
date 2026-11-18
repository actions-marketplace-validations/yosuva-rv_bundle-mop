// Tiny GitHub REST client: just what's needed to create or update one PR comment.

export interface Comment {
  id: number;
  body?: string;
  html_url: string;
  user?: { login: string; type: string } | null;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

type Fetch = typeof fetch;

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly repo: string,
    private readonly apiUrl = 'https://api.github.com',
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'bundle-mop-action',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, init);
    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as { message?: string }).message ?? '';
      } catch {
        // non-JSON error body
      }
      throw new GitHubApiError(res.status, `GitHub API ${method} ${path} failed: ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  }

  async listComments(issue: number): Promise<Comment[]> {
    const all: Comment[] = [];
    for (let page = 1; page <= 50; page++) {
      const batch = await this.request<Comment[]>('GET', `/repos/${this.repo}/issues/${issue}/comments?per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  /** Updates the bot comment that contains `marker`, or creates one. Human comments quoting the marker are ignored. */
  async upsertComment(issue: number, body: string, marker: string): Promise<{ action: 'created' | 'updated'; url: string }> {
    const existing = (await this.listComments(issue)).find((c) => c.user?.type === 'Bot' && c.body?.includes(marker));
    if (existing) {
      const c = await this.request<Comment>('PATCH', `/repos/${this.repo}/issues/comments/${existing.id}`, { body });
      return { action: 'updated', url: c.html_url };
    }
    const c = await this.request<Comment>('POST', `/repos/${this.repo}/issues/${issue}/comments`, { body });
    return { action: 'created', url: c.html_url };
  }
}
