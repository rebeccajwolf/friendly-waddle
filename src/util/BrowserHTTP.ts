import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../index';

export interface BrowserRequestOptions {
    method?: string;  // ← Changed: allow any string (matches Axios flexibility)
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
}

export interface BrowserResponse<T = any> {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: T;
    ok: boolean;
}

export class BrowserHTTP {
    private page: Page | null = null;
    private defaultTimeout = 30000;

    constructor() {}  // ← Removed bot param (unused)

    setPage(page: Page): void {
        this.page = page;
    }

    isAvailable(): boolean {
        return this.page !== null && !this.page.isClosed();
    }

    async request<T = any>(url: string, options: BrowserRequestOptions = {}): Promise<BrowserResponse<T>> {
        if (!this.isAvailable()) {
            throw new Error('Browser page not available for HTTP requests');
        }

        const { method = 'GET', headers = {}, body, timeout = this.defaultTimeout } = options;

        try {
            const result = await this.page!.evaluate(
                async ({ url, method, headers, body, timeout }) => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);

                    try {
                        const response = await fetch(url, {
                            method,
                            headers: {
                                'Accept': 'application/json',
                                'Content-Type': 'application/json',
                                ...headers
                            },
                            body: body ? JSON.stringify(body) : undefined,
                            credentials: 'include',
                            mode: 'cors',
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);

                        const headersObj: Record<string, string> = {};
                        response.headers.forEach((value, key) => {
                            headersObj[key] = value;
                        });

                        let data: any = await response.text();
                        try {
                            data = JSON.parse(data);
                        } catch {}

                        return {
                            status: response.status,
                            statusText: response.statusText,
                            headers: headersObj,
                            data,
                            ok: response.ok
                        };
                    } catch (error: any) {
                        clearTimeout(timeoutId);
                        throw new Error(`Fetch failed: ${error.message}`);
                    }
                },
                { url, method, headers, body, timeout }
            );

            return result as BrowserResponse<T>;

        } catch (error: any) {
            throw new Error(`Request failed: ${method} ${url} - ${error.message}`);
        }
    }

    async get<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'GET', headers });
    }

    async post<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'POST', headers, body });
    }

    async put<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'PUT', headers, body });
    }

    async delete<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'DELETE', headers });
    }

    async healthCheck(): Promise<boolean> {
        if (!this.isAvailable()) {
            return false;
        }

        try {
            await this.page!.evaluate(() => document.readyState);
            return true;
        } catch {
            return false;
        }
    }
}