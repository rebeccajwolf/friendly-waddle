import type { Page } from 'patchright';
import type { MicrosoftRewardsBot } from '../index';
import cluster from 'cluster';

export interface BrowserRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    retries?: number;
    priority?: 'high' | 'normal' | 'low';
}

export interface BrowserResponse<T = any> {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: T;
    ok: boolean;
}

interface QueuedRequest {
    id: string;
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    priority: 'high' | 'normal' | 'low';
    timestamp: number;
    description: string;
}

export class BrowserHTTP {
    private bot: MicrosoftRewardsBot;
    private page: Page | null = null;
    private defaultTimeout = 30000;
    private maxRetries = 3;
    private isReady = false;
    private requestQueue: QueuedRequest[] = [];
    private processingQueue = false;
    private readonly isWorker = cluster.isWorker;
    private readonly workerId = process.pid;
    private queueStats = {
        totalProcessed: 0,
        totalFailed: 0,
        currentQueueSize: 0
    };

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
        this.bot.logger.info(
            false,
            'BROWSER-HTTP',
            `🚀 BrowserHTTP initialized in ${this.isWorker ? 'worker' : 'master'} process (PID: ${this.workerId})`
        );
    }

    /**
     * Set the browser page to use for requests
     */
    setPage(page: Page): void {
        this.page = page;
        this.isReady = true;
        this.bot.logger.info(
            this.bot.isMobile,
            'BROWSER-HTTP',
            `✅ Browser page set for HTTP requests in ${this.isWorker ? 'worker' : 'master'} process`
        );
        
        // Process any queued requests immediately
        this.processQueue();
    }

    /**
     * Process queued requests in priority order
     */
    private async processQueue(): Promise<void> {
        if (this.processingQueue || !this.isReady) return;
        
        this.processingQueue = true;
        this.queueStats.currentQueueSize = this.requestQueue.length;
        
        if (this.requestQueue.length > 0) {
            this.bot.logger.info(
                this.bot.isMobile,
                'BROWSER-HTTP',
                `📦 Processing ${this.requestQueue.length} queued requests in ${this.isWorker ? 'worker' : 'master'} process`
            );
        }

        // Sort by priority (high first) and then by timestamp (oldest first)
        const priorityOrder = { 'high': 0, 'normal': 1, 'low': 2 };
        this.requestQueue.sort((a, b) => {
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }
            return a.timestamp - b.timestamp;
        });

        while (this.requestQueue.length > 0 && this.isReady) {
            const request = this.requestQueue.shift();
            if (request) {
                try {
                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'BROWSER-HTTP',
                        `⚙️ Processing queued request ${request.id}: ${request.description}`
                    );
                    
                    const result = await request.execute();
                    request.resolve(result);
                    this.queueStats.totalProcessed++;
                    
                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'BROWSER-HTTP',
                        `✅ Queued request ${request.id} completed successfully`
                    );
                } catch (error) {
                    this.queueStats.totalFailed++;
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'BROWSER-HTTP',
                        `❌ Queued request ${request.id} failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                    request.reject(error);
                }
            }
        }

        this.queueStats.currentQueueSize = this.requestQueue.length;
        this.processingQueue = false;
        
        if (this.requestQueue.length > 0) {
            this.processQueue();
        }
    }

    /**
     * Check if the browser page is available in this process
     */
    isAvailable(): boolean {
        return this.isReady && this.page !== null && !this.page.isClosed();
    }

    /**
     * Get queue statistics
     */
    getQueueStats() {
        return {
            ...this.queueStats,
            currentQueueSize: this.requestQueue.length
        };
    }

    /**
     * Make an HTTP request - always queues in workers, rejects in master
     */
    async request<T = any>(url: string, options: BrowserRequestOptions = {}): Promise<BrowserResponse<T>> {
        const { 
            method = 'GET', 
            headers = {}, 
            body, 
            timeout = this.defaultTimeout, 
            retries = this.maxRetries,
            priority = 'normal' 
        } = options;

        // Master process cannot handle browser requests
        if (!this.isWorker) {
            const error = new Error('Master process cannot handle browser requests');
            this.bot.logger.error(
                false,
                'BROWSER-HTTP',
                `❌ ${error.message} - URL: ${url.substring(0, 50)}...`
            );
            throw error;
        }

        // Generate request ID for tracking
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const description = `${method} ${url.substring(0, 50)}...`;

        // If browser is ready, execute immediately
        if (this.isAvailable()) {
            this.bot.logger.debug(
                false,
                'BROWSER-HTTP',
                `⚡ Executing request ${requestId} immediately: ${description}`
            );
            return this.executeRequest<T>(url, method, headers, body, timeout, retries, requestId);
        }

        // Otherwise queue the request
        this.bot.logger.info(
            false,
            'BROWSER-HTTP',
            `📥 Queuing request ${requestId} (priority: ${priority}): ${description} - Browser not ready yet`
        );

        return new Promise((resolve, reject) => {
            const queuedRequest: QueuedRequest = {
                id: requestId,
                execute: () => this.executeRequest<T>(url, method, headers, body, timeout, retries, requestId),
                resolve,
                reject,
                priority,
                timestamp: Date.now(),
                description
            };

            this.requestQueue.push(queuedRequest);
            this.queueStats.currentQueueSize = this.requestQueue.length;

            if (this.isReady && !this.processingQueue) {
                this.processQueue();
            }
        });
    }

    /**
     * Execute the actual request in browser using page.goto for GET requests
     * and fetch for other methods
     */
    private async executeRequest<T>(
        url: string, 
        method: string, 
        headers: Record<string, string>, 
        body: any, 
        timeout: number,
        retries: number,
        requestId: string
    ): Promise<BrowserResponse<T>> {
        let lastError: Error | null = null;
        
        this.bot.logger.debug(
            this.bot.isMobile,
            'BROWSER-HTTP',
            `🚀 Executing ${method} ${url.substring(0, 50)}... in worker ${this.workerId} [${requestId}]`
        );
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const startTime = Date.now();
                
                // For GET requests, use page.goto which handles redirects and cookies better
                if (method === 'GET') {
                    // Set extra HTTP headers if provided
                    if (Object.keys(headers).length > 0) {
                        await this.page!.setExtraHTTPHeaders(headers);
                    }

                    // Navigate to the URL
                    const response = await this.page!.goto(url, {
                        timeout: timeout,
                        waitUntil: 'networkidle',
                        referer: 'https://rewards.bing.com/'
                    });

                    if (!response) {
                        throw new Error('No response received from page');
                    }

                    const status = response.status();
                    const responseHeaders = response.headers();
                    const finalUrl = this.page!.url();

                    // Clear extra headers to avoid affecting subsequent requests
                    await this.page!.setExtraHTTPHeaders({});

                    // Extract data based on content type
                    let data: any;
                    const contentType = responseHeaders['content-type'] || '';

                    if (contentType.includes('application/json')) {
                        try {
                            data = await this.page!.evaluate(() => {
                                const pre = document.querySelector('pre');
                                if (pre) {
                                    try {
                                        return JSON.parse(pre.textContent || '{}');
                                    } catch {}
                                }
                                try {
                                    return JSON.parse(document.body.textContent || '{}');
                                } catch {
                                    return { text: document.body.textContent };
                                }
                            });
                        } catch (e) {
                            this.bot.logger.debug(
                                this.bot.isMobile,
                                'BROWSER-HTTP',
                                `Failed to parse JSON from page: ${e}`
                            );
                            data = { url: finalUrl, status };
                        }
                    } else {
                        data = { url: finalUrl, status };
                    }

                    const duration = Date.now() - startTime;
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'BROWSER-HTTP',
                        `✅ Request ${requestId} successful: ${method} ${url.substring(0, 50)}... -> ${status} (${duration}ms)`,
                        'green'
                    );

                    return {
                        status,
                        statusText: response.statusText(),
                        headers: responseHeaders,
                        data,
                        ok: response.ok()
                    } as BrowserResponse<T>;
                } else {
                    // For POST, PUT, DELETE requests, use fetch
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

                    const duration = Date.now() - startTime;
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'BROWSER-HTTP',
                        `✅ Request ${requestId} successful: ${method} ${url.substring(0, 50)}... -> ${result.status} (${duration}ms)`,
                        'green'
                    );

                    return result as BrowserResponse<T>;
                }

            } catch (error: any) {
                lastError = error;
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-HTTP',
                    `⚠️ Request ${requestId} failed (attempt ${attempt}/${retries}): ${error.message}`
                );

                if (attempt < retries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        const errorMsg = `Request ${requestId} failed after ${retries} attempts`;
        this.bot.logger.error(
            this.bot.isMobile,
            'BROWSER-HTTP',
            `❌ ${errorMsg}: ${lastError?.message}`
        );
        throw lastError || new Error(errorMsg);
    }

    /**
     * Make a GET request - now using page.goto which handles IP addresses better
     */
    async get<T = any>(url: string, headers?: Record<string, string>, priority?: 'high' | 'normal' | 'low'): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'GET', headers, priority });
    }

    /**
     * Make a POST request
     */
    async post<T = any>(url: string, body?: any, headers?: Record<string, string>, priority?: 'high' | 'normal' | 'low'): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'POST', headers, body, priority });
    }

    /**
     * Make a PUT request
     */
    async put<T = any>(url: string, body?: any, headers?: Record<string, string>, priority?: 'high' | 'normal' | 'low'): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'PUT', headers, body, priority });
    }

    /**
     * Make a DELETE request
     */
    async delete<T = any>(url: string, headers?: Record<string, string>, priority?: 'high' | 'normal' | 'low'): Promise<BrowserResponse<T>> {
        return this.request<T>(url, { method: 'DELETE', headers, priority });
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