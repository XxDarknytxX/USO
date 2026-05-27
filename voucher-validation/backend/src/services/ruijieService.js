// src/services/ruijieService.js
import fetch from 'node-fetch';

class RuijieService {
  constructor() {
    this.baseUrl = process.env.RUIJIE_API_BASE_URL;
    this.appId = process.env.RUIJIE_APP_ID;
    this.appSecret = process.env.RUIJIE_APP_SECRET;
    this.groupId = process.env.RUIJIE_GROUP_ID;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  buildUrl(path) {
    const base = this.baseUrl?.replace(/\/+$/, '') || '';
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const tokenUrl = this.buildUrl(
        `/oauth20/client/access_token?token=d63dss0a81e4415a889ac5b78fsc904a`
      );

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: this.appId, secret: this.appSecret }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const data = await response.json();

      const okCode = data?.code === 0 || data?.code === 200;

      const token =
        data?.data?.access_token ??
        data?.access_token ??
        data?.accessToken ??
        null;

      if (!okCode || !token) {
        console.error('Unexpected token payload:', JSON.stringify(data));
        throw new Error('Token response missing access token');
      }

      this.accessToken = token;

      const ttlSec =
        data?.data?.expires_in ??
        data?.expires_in ??
        data?.expireIn ??
        7200;
      this.tokenExpiry = Date.now() + ttlSec * 1000;

      return this.accessToken;
    } catch (error) {
      console.error('Failed to get access token:', error);
      throw error;
    }
  }

  // ── Read APIs (documented & working) ────────────────────────

  /**
   * 2.3.3 Query Voucher List
   * GET /open/auth/voucher/getList/{groupId}
   */
  async getVouchers(start = 0, pageSize = 100, _retried = false) {
    try {
      const accessToken = await this.getAccessToken();

      const voucherUrl = this.buildUrl(`/open/auth/voucher/getList/${this.groupId}`);
      const url = new URL(voucherUrl);
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('start', String(start));
      url.searchParams.append('pageSize', String(pageSize));
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) {
        // code 3 = "Login timeout" — token expired, clear cache and retry once
        if (this.isTokenExpired(data) && !_retried) {
          console.log('Ruijie token expired (Login timeout) in getVouchers, refreshing...');
          this.invalidateToken();
          return this.getVouchers(start, pageSize, true);
        }
        console.error('Voucher list payload not OK:', JSON.stringify(data));
        throw new Error(data?.msg || 'Voucher list error');
      }

      const list = data?.list ?? data?.voucherData?.list ?? [];
      const count = data?.count ?? data?.voucherData?.count ?? 0;
      return { vouchers: list, total: count, hasMore: start + pageSize < count };
    } catch (error) {
      console.error('Failed to fetch vouchers:', error);
      throw error;
    }
  }

  async getAllVouchers() {
    const allVouchers = [];
    let start = 0;
    const pageSize = 100;
    let hasMore = true;
    while (hasMore) {
      const result = await this.getVouchers(start, pageSize);
      allVouchers.push(...result.vouchers);
      hasMore = result.hasMore;
      start += pageSize;
      if (hasMore) await new Promise(r => setTimeout(r, 100));
    }
    return allVouchers;
  }

  /**
   * Get User Group List (profiles)
   * GET /intl/usergroup/list/{groupId}?pageIndex=0&pageSize=100&access_token=...
   * Returns profiles with id (userGroupId) and authProfileId (profile UUID for voucher creation)
   */
  /**
   * Invalidate the cached token so the next call to getAccessToken() fetches a fresh one.
   * Call this when the Ruijie API returns code 3 ("Login timeout").
   */
  invalidateToken() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Check if an API response indicates an expired/invalid token.
   */
  isTokenExpired(data) {
    return data?.code === 3 || (data?.msg || '').toLowerCase().includes('login timeout');
  }

  async getUserGroups(_retried = false) {
    try {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/intl/usergroup/list/${this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('pageIndex', '0');
      url.searchParams.append('pageSize', '100');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) {
        if (this.isTokenExpired(data) && !_retried) {
          console.log('Ruijie token expired (Login timeout) in getUserGroups, refreshing...');
          this.invalidateToken();
          return this.getUserGroups(true);
        }
        throw new Error(data?.msg || 'Get user groups failed');
      }

      const list = data?.data ?? [];
      return { cloudSync: true, data: list };
    } catch (error) {
      console.error('Failed to fetch user groups:', error);
      return { cloudSync: false, data: [] };
    }
  }

  async testConnection() {
    try {
      const token = await this.getAccessToken();
      return { success: true, hasToken: !!token, message: 'API connection successful' };
    } catch (error) {
      return { success: false, error: error.message, message: 'API connection failed' };
    }
  }

  // ── Write APIs ──────────────────────────────────────────────

  /**
   * Wrapper for cloud write operations.
   * If the endpoint doesn't exist (404/405), falls back gracefully.
   */
  async _tryCloudOperation(operationName, fn, _retried = false) {
    try {
      const result = await fn();
      return { cloudSync: true, ...result };
    } catch (error) {
      const msg = error.message || '';
      // Retry once on token expiry
      if ((msg.toLowerCase().includes('login timeout') || msg.includes('code 3')) && !_retried) {
        console.log(`Ruijie token expired in ${operationName}, refreshing and retrying...`);
        this.invalidateToken();
        return this._tryCloudOperation(operationName, fn, true);
      }
      if (msg.includes('404') || msg.includes('405') || msg.includes('Not Found') || msg.includes('Method Not Allowed')) {
        console.warn(`Ruijie API does not support "${operationName}", operating locally only`);
        return { cloudSync: false, localOnly: true };
      }
      throw error;
    }
  }

  /**
   * 2.3.1 Generate Voucher
   * POST /open/auth/voucher/create/{groupId}
   * Body: { quantity, profile, userGroupId, firstName?, lastName?, email?, phone?, comment? }
   */
  async createVoucher(payload) {
    return this._tryCloudOperation('createVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/create/${this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      // API requires: quantity, profile (profileId UUID), userGroupId
      const body = {
        quantity: payload.quantity || 1,
        profile: payload.profile,
        userGroupId: payload.userGroupId,
      };
      // Optional user fields
      if (payload.firstName) body.firstName = payload.firstName;
      if (payload.lastName) body.lastName = payload.lastName;
      if (payload.email) body.email = payload.email;
      if (payload.phone) body.phone = payload.phone;
      if (payload.comment) body.comment = payload.comment;

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Create voucher failed');

      // Response: { voucherData: { count, list: [{ uuid, codeNo, status, profileId, expiryTime, limitClients, ... }] } }
      const voucherData = data?.voucherData ?? data;
      return { data: voucherData };
    });
  }

  /**
   * 2.3.2 Receive Customized Voucher
   * POST /open/auth/voucher/customerCreate/{groupId}/{code}
   * Body: { groupId, profile, userGroupId }
   */
  async createCustomVoucher(code, payload) {
    return this._tryCloudOperation('createCustomVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/customerCreate/${this.groupId}/${code}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const body = {
        groupId: String(this.groupId),
        profile: payload.profile,
        userGroupId: payload.userGroupId,
      };

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Create custom voucher failed');
      return { data };
    });
  }

  // ── Speculative APIs (not in docs, graceful fallback) ──────

  async updateVoucher(uuid, payload) {
    return this._tryCloudOperation('updateVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/update/${this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, ...payload }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Update voucher failed');
      return { data };
    });
  }

  async deleteVouchers(uuids) {
    return this._tryCloudOperation('deleteVouchers', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/delete/${this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuids }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Delete vouchers failed');
      return { data };
    });
  }

  async disableVoucher(uuid) {
    return this._tryCloudOperation('disableVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/disable/${this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Disable voucher failed');
      return { data };
    });
  }

  async enableVoucher(uuid) {
    return this._tryCloudOperation('enableVoucher', async () => {
      const accessToken = await this.getAccessToken();
      const url = new URL(this.buildUrl(`/open/auth/voucher/enable/${this.groupId}`));
      url.searchParams.append('access_token', accessToken);
      if (process.env.RUIJIE_TENANT_ID) {
        url.searchParams.append('tenantId', process.env.RUIJIE_TENANT_ID);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = await response.json();
      const okCode = data?.code === 0 || data?.code === 200;
      if (!okCode) throw new Error(data?.msg || 'Enable voucher failed');
      return { data };
    });
  }
}

export default RuijieService;
