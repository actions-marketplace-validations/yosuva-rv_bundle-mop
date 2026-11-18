import { describe, expect, it } from 'vitest';
import { GitHubApiError, GitHubClient } from '../src/github.js';
import type { Comment } from '../src/github.js';

const MARKER = '<!-- bundle-mop:comment -->';

interface Call {
  method: string;
  url: string;
  body?: unknown;
  auth?: string;
}

/** Fake GitHub: serves a comment list (paginated by 100) and records writes. */
function fakeFetch(comments: Comment[], opts: { failWith?: number } = {}) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string>;
    calls.push({ method, url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}), auth: headers.authorization });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (opts.failWith && method !== 'GET') return json(opts.failWith, { message: 'Resource not accessible by integration' });
    if (method === 'GET') {
      const page = Number(new URL(url).searchParams.get('page'));
      return json(200, comments.slice((page - 1) * 100, page * 100));
    }
    if (method === 'PATCH') return json(200, { id: 1, html_url: 'https://github.com/o/r/pull/7#issuecomment-1' });
    return json(201, { id: 2, html_url: 'https://github.com/o/r/pull/7#issuecomment-2' });
  }) as typeof fetch;
  return { impl, calls };
}

const bot = (id: number, body: string): Comment => ({ id, body, html_url: '', user: { login: 'github-actions[bot]', type: 'Bot' } });
const human = (id: number, body: string): Comment => ({ id, body, html_url: '', user: { login: 'someone', type: 'User' } });

describe('GitHubClient.upsertComment', () => {
  it('creates a comment when none has the marker', async () => {
    const f = fakeFetch([human(1, 'LGTM')]);
    const res = await new GitHubClient('tok', 'o/r', 'https://api.github.com', f.impl).upsertComment(7, `${MARKER}\nreport`, MARKER);
    expect(res.action).toBe('created');
    expect(f.calls.at(-1)).toMatchObject({ method: 'POST', url: 'https://api.github.com/repos/o/r/issues/7/comments', body: { body: `${MARKER}\nreport` }, auth: 'Bearer tok' });
  });

  it('updates the existing bot comment', async () => {
    const f = fakeFetch([human(1, 'hi'), bot(42, `${MARKER}\nold`)]);
    const res = await new GitHubClient('tok', 'o/r', 'https://api.github.com', f.impl).upsertComment(7, `${MARKER}\nnew`, MARKER);
    expect(res).toEqual({ action: 'updated', url: 'https://github.com/o/r/pull/7#issuecomment-1' });
    expect(f.calls.at(-1)).toMatchObject({ method: 'PATCH', url: 'https://api.github.com/repos/o/r/issues/comments/42' });
  });

  it('ignores human comments that quote the marker', async () => {
    const f = fakeFetch([human(5, `> ${MARKER}\nquoted`)]);
    expect((await new GitHubClient('t', 'o/r', 'https://api.github.com', f.impl).upsertComment(7, MARKER, MARKER)).action).toBe('created');
  });

  it('finds the bot comment past the first page', async () => {
    const many = [...Array.from({ length: 100 }, (_, i) => human(i + 1, 'x')), bot(500, MARKER)];
    const f = fakeFetch(many);
    await new GitHubClient('t', 'o/r', 'https://api.github.com', f.impl).upsertComment(7, MARKER, MARKER);
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    expect(f.calls.at(-1)?.url).toContain('/issues/comments/500');
  });

  it('surfaces the status for permission errors (fork PRs)', async () => {
    const f = fakeFetch([], { failWith: 403 });
    const err = await new GitHubClient('t', 'o/r', 'https://api.github.com', f.impl).upsertComment(7, MARKER, MARKER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toMatchObject({ status: 403, message: expect.stringContaining('Resource not accessible by integration') });
  });
});
