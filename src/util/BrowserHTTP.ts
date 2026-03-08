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
     * Make a GET request using page.goto (better for authenticated requests)
     */
    async getViaGoto<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        if (!this.isAvailable()) {
            throw new Error('Browser page not available for HTTP requests');
        }

        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Set extra HTTP headers
                if (headers && Object.keys(headers).length > 0) {
                    await this.page!.setExtraHTTPHeaders(headers);
                }

                // Navigate to the URL
                const response = await this.page!.goto(url, {
                    timeout: this.defaultTimeout,
                    waitUntil: 'networkidle'
                });

                if (!response) {
                    throw new Error('No response received');
                }

                // Clear headers to avoid affecting subsequent requests
                await this.page!.setExtraHTTPHeaders({});

                // Get response body
                const content = await this.page!.content();
                let data: any;

                // Try to parse as JSON
                try {
                    // Look for JSON in the page content (often in <pre> tags)
                    const jsonMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
                    if (jsonMatch && jsonMatch[1]) {
                        data = JSON.parse(jsonMatch[1]);
                    } else {
                        // Try parsing the whole content as JSON
                        data = JSON.parse(content);
                    }
                } catch (e) {
                    // If not JSON, return as text
                    data = content;
                }

                const status = response.status();
                
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request successful via goto: ${url} -> ${status} (attempt ${attempt})`
                );

                return {
                    status,
                    statusText: response.statusText(),
                    headers: response.headers(),
                    data,
                    ok: response.ok()
                } as BrowserResponse<T>;

            } catch (error: any) {
                lastError = error;
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request failed via goto (attempt ${attempt}/${this.maxRetries}): ${url} - ${error.message}`
                );

                if (attempt < this.maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error(`Request failed after ${this.maxRetries} attempts: ${url}`);
    }

    /**
     * Make a GET request using fetch (fallback for non-authenticated requests)
     */
    async getViaFetch<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'GET', headers });
    }

    /**
     * Make a GET request - automatically chooses the best method
     */
    async get<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        // For requests with Authorization header, use goto (more reliable)
        if (headers && headers['Authorization']) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'BROWSER-HTTP',
                `Using goto method for authenticated request to ${url}`
            );
            return this.getViaGoto<T>(url, headers);
        }
        
        // For non-authenticated requests, use fetch
        return this.getViaFetch<T>(url, headers);
    }

    /**
     * Make an HTTP request through the browser page using fetch
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
                                mode: 'cors',
                                signal: controller.signal
                            });

                            clearTimeout(timeoutId);

                            const headersObj: Record<string, string> = {};
                            response.headers.forEach((value, key) => {
                                headersObj[key] = value;
                            });

                            const contentType = response.headers.get('content-type') || '';
                            let data: any;

                            if (contentType.includes('application/json')) {
                                try {
                                    data = await response.json();
                                } catch (e) {
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

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request successful via fetch: ${method} ${url} -> ${result.status} (attempt ${attempt})`
                );

                return result as BrowserResponse<T>;

            } catch (error: any) {
                lastError = error;
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request failed via fetch (attempt ${attempt}/${retries}): ${method} ${url} - ${error.message}`
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