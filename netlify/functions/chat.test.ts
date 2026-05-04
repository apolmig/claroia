import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chat from './chat';
import models from './models';

const originalAllowed = process.env.NETLIFY_ALLOWED_ENDPOINTS;
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Netlify BYOK functions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.NETLIFY_ALLOWED_ENDPOINTS = 'https://api.openai.com/v1';
  });

  afterEach(() => {
    process.env.NETLIFY_ALLOWED_ENDPOINTS = originalAllowed;
  });

  it('rejects chat requests without a user API key', async () => {
    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://api.openai.com/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(response.status).toBe(401);
  });

  it('rejects non-HTTPS endpoints', async () => {
    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: { 'x-user-api-key': 'secret' },
      body: JSON.stringify({ endpoint: 'http://api.openai.com/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('HTTPS') });
  });

  it('rejects endpoints that only match the allowlist by string prefix', async () => {
    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: { 'x-user-api-key': 'secret' },
      body: JSON.stringify({ endpoint: 'https://api.openai.com.evil.test/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not allowed') });
  });

  it('rejects private network endpoints even when allowlisted by configuration', async () => {
    process.env.NETLIFY_ALLOWED_ENDPOINTS = 'https://127.0.0.1/v1';

    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: { 'x-user-api-key': 'secret' },
      body: JSON.stringify({ endpoint: 'https://127.0.0.1/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Private network') });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects oversized message payloads before forwarding', async () => {
    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: { 'x-user-api-key': 'secret' },
      body: JSON.stringify({ endpoint: 'https://api.openai.com/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'x'.repeat(50_001) }] })
    }));

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards allowed BYOK chat requests without logging or storing secrets', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-api-key': 'secret' },
      body: JSON.stringify({ endpoint: 'https://api.openai.com/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }], params: { max_tokens: 10 } })
    }));

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer secret' })
    }));
  });

  it('does not proxy upstream error bodies back to the browser', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'provider leaked prompt text' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    }));

    const response = await chat(new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-api-key': 'secret' },
      body: JSON.stringify({ endpoint: 'https://api.openai.com/v1', model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Upstream request failed (400).' });
  });

  it('rejects model discovery without a user API key', async () => {
    const response = await models(new Request('https://example.test/api/models', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://api.openai.com/v1/models' })
    }));

    expect(response.status).toBe(401);
  });
});
