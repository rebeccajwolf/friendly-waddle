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
     * Make a GET request using fetch within a page that matches the target origin.
     * Creates a temporary page if the current page's origin differs.
     */
    async getViaFetch<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        if (!this.isAvailable()) {
            throw new Error('Browser page not available for HTTP requests');
        }

        const targetOrigin = new URL(url).origin;
        const currentOrigin = this.page!.url() ? new URL(this.page!.url()).origin : null;

        // Decide which page to use: reuse current if origins match, otherwise create a temporary page
        let usedPage: Page = this.page!;
        let tempPage: Page | null = null;

        if (currentOrigin !== targetOrigin) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'BROWSER-HTTP',
                `Origin mismatch (current: ${currentOrigin}, target: ${targetOrigin}), creating temporary page`
            );
            try {
                tempPage = await this.page!.context().newPage();
                // Navigate to the target origin to establish the correct origin for fetch
                // Using 'domcontentloaded' is enough; we don't need full page load
                await tempPage.goto(targetOrigin, { waitUntil: 'domcontentloaded', timeout: this.defaultTimeout });
                usedPage = tempPage;
            } catch (navError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Failed to navigate temporary page to ${targetOrigin}: ${navError instanceof Error ? navError.message : String(navError)}`
                );
                // If navigation fails, fall back to current page (may still fail, but we try)
                if (tempPage) {
                    await tempPage.close().catch(() => {});
                    tempPage = null;
                }
                usedPage = this.page!;
            }
        }

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await usedPage.evaluate(
                    async ({ url, headers, timeout }) => {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), timeout);

                        try {
                            const response = await fetch(url, {
                                method: 'GET',
                                headers: headers || {},
                                credentials: 'include',
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
                                } catch {
                                    data = await response.text();
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
                    { url, headers, timeout: this.defaultTimeout }
                );

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request successful via fetch: ${url} -> ${result.status} (attempt ${attempt})`
                );

                return result as BrowserResponse<T>;

            } catch (error: any) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `Request failed via fetch (attempt ${attempt}/${this.maxRetries}): ${url} - ${error.message}`
                );

                if (attempt < this.maxRetries) {
                    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Request failed after ${this.maxRetries} attempts: ${url}`);
    }

    /**
     * Main GET method - uses fetch in the existing page.
     */
    async get<T = any>(url: string, headers?: Record<string, string>): Promise<BrowserResponse<T>> {
        return this.getViaFetch<T>(url, headers);
    }

    /**
     * POST method (placeholder – can be implemented similarly if needed)
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