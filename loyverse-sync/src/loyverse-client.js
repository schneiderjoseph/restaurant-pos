'use strict';

/**
 * Minimal Loyverse REST client (PAT Bearer).
 * Cursor pagination + basic 429 backoff.
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class LoyverseClient {
  /**
   * @param {{ token: string, baseUrl: string }} opts
   */
  constructor(opts) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  /**
   * @param {string} path e.g. "/categories"
   * @param {Record<string, string|number|undefined>} [query]
   */
  async get(path, query = {}) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
      });

      if (res.status === 429 && attempt < 8) {
        const retryAfter = Number(res.headers.get('retry-after') || 0);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 500 * 2 ** attempt);
        await sleep(waitMs);
        continue;
      }

      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }

      if (!res.ok) {
        const msg = body?.errors?.[0]?.details || body?.message || text || res.statusText;
        throw new Error(`Loyverse ${res.status} ${path}: ${msg}`);
      }
      return body;
    }
  }

  /**
   * Paginate a list endpoint until cursor is empty.
   * @param {string} path
   * @param {string} listKey e.g. "categories"
   * @param {Record<string, string|number|undefined>} [query]
   * @param {number} [pageDelayMs]
   */
  async listAll(path, listKey, query = {}, pageDelayMs = 120) {
    const all = [];
    let cursor;
    do {
      const page = await this.get(path, { ...query, limit: query.limit || 250, cursor });
      const chunk = Array.isArray(page?.[listKey]) ? page[listKey] : [];
      all.push(...chunk);
      cursor = page?.cursor || null;
      if (cursor) await sleep(pageDelayMs);
    } while (cursor);
    return all;
  }
}

module.exports = { LoyverseClient };
