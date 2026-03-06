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
     * Make an HTTP request through the browser page
     */
    async request<T = any>(url: string, options: BrowserRequestOptions = {}): Promise<BrowserResponse<T>> {
        if (!this.isAvailable()) {
            throw new Error('Browser page not available for HTTP requests');
        }

        const { method = 'GET', headers = {}, body, timeout = this.defaultTimeout, retries = this.maxRetries } = options;

        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
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
                                signal: controller.signal
                            });

                            clearTimeout(timeoutId);

                            const contentType = response.headers.get('content-type') || '';
                            let data: any;

                            if (contentType.includes('application/json')) {
                                data = await response.json();
                            } else {
                                data = await response.text();
                            }

                            return {
                                status: response.status,
                                statusText: response.statusText,
                                headers: Object.fromEntries(response.headers.entries()),
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

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request successful: ${method} ${url} -> ${result.status} (attempt ${attempt})`
                );

                return result as BrowserResponse<T>;

            } catch (error: any) {
                lastError = error;
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request failed (attempt ${attempt}/${retries}): ${method} ${url} - ${error.message}`
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
     * Make a GET request
     */
    async get<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'GET', headers});
    }

    /**
     * Make a POST request
     */
    async post<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'POST', headers, body });
    }

    /**
     * Make a PUT request
     */
    async put<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'PUT', headers, body });
    }

    /**
     * Make a DELETE request
     */
    async delete<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'DELETE', headers });
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