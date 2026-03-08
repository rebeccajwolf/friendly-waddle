import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../index';

export interface BrowserRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    retries?: number;
}

export interface BrowserResponse<T = any> {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: T;
    ok: boolean;
}

export class BrowserHTTP {
    private bot: MicrosoftRewardsBot;
    private page: Page | null = null;
    private defaultTimeout = 30000;
    private maxRetries = 3;

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
    }

    /**
     * Set the browser page to use for requests
     */
    setPage(page: Page): void {
        this.page = page;
        this.bot.logger.debug(this.bot.isMobile, 'BROWSER-HTTP', 'Browser page set for HTTP requests');
    }

    /**
     * Check if the browser page is available
     */
    isAvailable(): boolean {
        return this.page !== null && !this.page.isClosed();
    }

    /**
     * Make an HTTP request using Playwright's built-in request API
     * This bypasses the page's JavaScript context and CORS restrictions
     */
    async requestViaPlaywright<T = any>(url: string, options: BrowserRequestOptions = {}): Promise<BrowserResponse<T>> {
        if (!this.isAvailable()) {
            throw new Error('Browser page not available for HTTP requests');
        }

        const { method = 'GET', headers = {}, body, timeout = this.defaultTimeout, retries = this.maxRetries } = options;

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const requestOptions: any = {
                    method,
                    headers,
                    timeout
                };

                if (body) {
                    if (typeof body === 'object') {
                        requestOptions.data = body;
                    } else {
                        requestOptions.data = body;
                    }
                }

                // Use Playwright's request API
                const response = await this.page!.request.fetch(url, requestOptions);

                const status = response.status();
                const statusText = response.statusText();
                const responseHeaders = response.headers();
                
                let data: any;
                const contentType = responseHeaders['content-type'] || '';

                if (contentType.includes('application/json')) {
                    try {
                        data = await response.json();
                    } catch {
                        const text = await response.text();
                        try {
                            data = JSON.parse(text);
                        } catch {
                            data = text;
                        }
                    }
                } else {
                    data = await response.text();
                    try {
                        data = JSON.parse(data);
                    } catch {}
                }

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request successful via Playwright API: ${method} ${url} -> ${status} (attempt ${attempt})`
                );

                return {
                    status,
                    statusText,
                    headers: responseHeaders,
                    data,
                    ok: status >= 200 && status < 300
                } as BrowserResponse<T>;

            } catch (error: any) {
                lastError = error;
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request failed via Playwright API (attempt ${attempt}/${retries}): ${method} ${url} - ${error.message}`
                );

                if (attempt < retries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error(`Request failed after ${retries} attempts: ${method} ${url}`);
    }

    /**
     * Make a GET request - uses Playwright's request API for all requests
     */
    async get<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.requestViaPlaywright<T>(url, { method: 'GET', headers });
    }

    /**
     * Make a POST request
     */
    async post<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.requestViaPlaywright<T>(url, { method: 'POST', headers, body });
    }

    /**
     * Make a PUT request
     */
    async put<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.requestViaPlaywright<T>(url, { method: 'PUT', headers, body });
    }

    /**
     * Make a DELETE request
     */
    async delete<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.requestViaPlaywright<T>(url, { method: 'DELETE', headers });
    }

    /**
     * Check if the browser page is still valid
     */
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