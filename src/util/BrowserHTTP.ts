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
    private isReady = false;
    private requestQueue: Array<() => Promise<any>> = [];

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
    }

    /**
     * Set the browser page to use for requests
     */
    setPage(page: Page): void {
        this.page = page;
        this.isReady = true;
        this.bot.logger.debug(this.bot.isMobile, 'BROWSER-HTTP', 'Browser page set for HTTP requests');
        
        // Process any queued requests
        this.processQueue();
    }

    /**
     * Process queued requests
     */
    private async processQueue(): Promise<void> {
        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (request) {
                try {
                    await request();
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'BROWSER-HTTP',
                        `Queued request failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }
    }

    /**
     * Check if the browser page is available
     */
    isAvailable(): boolean {
        return this.isReady && this.page !== null && !this.page.isClosed();
    }

    /**
     * Wait for browser to be ready
     */
    async waitForReady(timeoutMs: number = 30000): Promise<boolean> {
        if (this.isAvailable()) return true;
        
        const start = Date.now();
        while (!this.isAvailable()) {
            if (Date.now() - start > timeoutMs) {
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return true;
    }

    /**
     * Make an HTTP request through the browser page
     */
    async request<T = any>(url: string, options: BrowserRequestOptions = {}): Promise<BrowserResponse<T>> {
        const { method = 'GET', headers = {}, body, timeout = this.defaultTimeout, retries = this.maxRetries } = options;

        // If browser is not ready, queue the request
        if (!this.isAvailable()) {
            return new Promise((resolve, reject) => {
                this.requestQueue.push(async () => {
                    try {
                        const result = await this.executeRequest<T>(url, method, headers, body, timeout, retries);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }

        return this.executeRequest<T>(url, method, headers, body, timeout, retries);
    }

    /**
     * Execute the actual request
     */
    private async executeRequest<T>(
        url: string, 
        method: string, 
        headers: Record<string, string>, 
        body: any, 
        timeout: number,
        retries: number
    ): Promise<BrowserResponse<T>> {
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
        return this.request<T>(url, { method: 'GET', headers });
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