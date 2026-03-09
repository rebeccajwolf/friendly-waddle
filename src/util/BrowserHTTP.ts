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
    private defaultTimeout = 60000; // 60 seconds
    private maxRetries = 5;

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
     * Make a GET request by opening a new page and navigating to the URL.
     * This uses the full browser stack and respects --host-rules.
     */
    async getViaNewPage<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        if (!this.isAvailable()) {
            throw new Error('Browser page not available for HTTP requests');
        }

        const context = this.page!.context();
        let newPage: Page | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Create a new page (tab)
                newPage = await context.newPage();

                // Set extra HTTP headers if provided
                if (headers && Object.keys(headers).length > 0) {
                    await newPage.setExtraHTTPHeaders(headers);
                }

                // Navigate to the URL with a simpler wait condition
                const response = await newPage.goto(url, {
                    timeout: this.defaultTimeout,
                    waitUntil: 'domcontentloaded' // Faster and less prone to hanging
                });

                if (!response) {
                    throw new Error('No response received');
                }

                const status = response.status();
                const statusText = response.statusText();
                const responseHeaders = response.headers();

                // Get response body
                let data: any;
                
                // Try to get JSON from the response directly
                try {
                    data = await response.json();
                } catch {
                    // If not JSON, get as text
                    data = await response.text();
                    // Attempt to parse as JSON in case content-type is wrong
                    try {
                        data = JSON.parse(data);
                    } catch {
                        // Keep as text
                    }
                }

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request successful via new page: ${url} -> ${status} (attempt ${attempt})`
                );

                await newPage.close();

                return {
                    status,
                    statusText,
                    headers: responseHeaders,
                    data,
                    ok: status >= 200 && status < 300
                } as BrowserResponse<T>;

            } catch (error: any) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request failed via new page (attempt ${attempt}/${this.maxRetries}): ${url} - ${error.message}`
                );

                if (newPage) {
                    await newPage.close().catch(() => {});
                }

                if (attempt < this.maxRetries) {
                    // Exponential backoff: 2s, 4s, 8s, 16s
                    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Request failed after ${this.maxRetries} attempts: ${url}`);
    }

    /**
     * Main GET method - uses the new page approach for all requests.
     */
    async get<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.getViaNewPage<T>(url, headers);
    }

    /**
     * POST method (placeholder – not used in current implementation)
     */
    async post<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        throw new Error('POST not implemented in BrowserHTTP yet');
    }

    /**
     * PUT method (placeholder)
     */
    async put<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        throw new Error('PUT not implemented in BrowserHTTP yet');
    }

    /**
     * DELETE method (placeholder)
     */
    async delete<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        throw new Error('DELETE not implemented in BrowserHTTP yet');
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