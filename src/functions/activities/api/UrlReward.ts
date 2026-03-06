import type { AxiosRequestConfig } from 'axios'
import type { BasePromotion } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'
import { HostRulesManager } from '../../../util/HostRules'

export class UrlReward extends Workers {
    private cookieHeader: string = ''
    private fingerprintHeader: { [x: string]: string } = {}
    private gainedPoints: number = 0
    private oldBalance: number = this.bot.userData.currentPoints

    private get hostRules(): HostRulesManager {
        return new HostRulesManager(this.bot)
    }

    /**
     * Apply host rules to a URL and get the result
     */
    private applyHostRulesToUrl(url: string): { url: string; originalHostname?: string } {
        return this.hostRules.applyHostRules(url);
    }

    /**
     * Make a request using browser HTTP as primary, axios as fallback
     */
    private async makeRequest<T>(
        config: AxiosRequestConfig,
        useProxy: boolean
    ): Promise<T> {
        // Try browser HTTP first if available
        if (this.bot.browserHTTP?.isAvailable()) {
            try {
                const method = config.method?.toUpperCase() || 'GET';
                const url = config.url || '';
                
                // Build headers for browser request
                const headers = { ...config.headers } as Record<string, string>;
                
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Attempting browser HTTP ${method} request to ${url.substring(0, 100)}...`
                );

                let response;
                if (method === 'POST') {
                    // Handle different body types
                    let body = config.data;
                    if (config.data instanceof URLSearchParams) {
                        body = Object.fromEntries(config.data);
                    }
                    response = await this.bot.browserHTTP.post<T>(url, body, headers);
                } else {
                    response = await this.bot.browserHTTP.get<T>(url, headers);
                }

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Browser HTTP request successful: ${method} ${url.substring(0, 100)}... -> ${response.status}`
                );

                return response.data as T;
            } catch (browserError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Browser HTTP failed, falling back to axios: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
                // Fall through to axios
            }
        }

        // Fall back to axios
        try {
            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Falling back to axios request to ${config.url?.substring(0, 100)}...`
            );
            
            const response = await this.bot.axios.request(config, useProxy);
            return response.data as T;
        } catch (axiosError) {
            this.bot.logger.error(
                this.bot.isMobile,
                'URL-REWARD',
                `Axios request failed: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
            );
            throw axiosError;
        }
    }

    public async doUrlReward(promotion: BasePromotion) {
        if (!this.bot.requestToken) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'URL-REWARD',
                'Skipping: Request token not available, this activity requires it!'
            )
            return
        }

        const offerId = promotion.offerId

        this.bot.logger.info(
            this.bot.isMobile,
            'URL-REWARD',
            `Starting UrlReward | offerId=${offerId} | geo=${this.bot.userData.geoLocale} | oldBalance=${this.oldBalance}`
        )

        try {
            this.cookieHeader = this.bot.browser.func.buildCookieHeader(
                this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop,
                ['bing.com', 'live.com', 'microsoftonline.com']
            )

            const fingerprintHeaders = { ...this.bot.fingerprint.headers }
            delete fingerprintHeaders['Cookie']
            delete fingerprintHeaders['cookie']
            this.fingerprintHeader = fingerprintHeaders

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Prepared UrlReward headers | offerId=${offerId} | cookieLength=${this.cookieHeader.length} | fingerprintHeaderKeys=${Object.keys(this.fingerprintHeader).length}`
            )

            const formData = new URLSearchParams({
                id: offerId,
                hash: promotion.hash,
                timeZone: '60',
                activityAmount: '1',
                dbs: '0',
                form: '',
                type: '',
                __RequestVerificationToken: this.bot.requestToken
            })

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Prepared UrlReward form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1`
            )

            // IMPORTANT: Use the DOMAIN NAME, not the IP from hostRules
            // The browser's --host-rules will handle the IP mapping
            const url = 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest';
            
            // Apply host rules to get the URL result (for headers)
            const urlResult = this.applyHostRulesToUrl(url);
            const refererResult = this.applyHostRulesToUrl('https://rewards.bing.com/');
            const originResult = this.applyHostRulesToUrl('https://rewards.bing.com');
            
            // Build headers with host rules - pass the urlResult, not the string
            const headers = this.hostRules.buildHeaders(
                {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.cookieHeader,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                urlResult, // This is a HostRuleResult, not a string
                {
                    Referer: refererResult.url,
                    Origin: originResult.url
                }
            );

            const request: AxiosRequestConfig = {
                url: url, // Use domain name for the URL, not IP
                method: 'POST',
                headers,
                data: formData
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Sending UrlReward request via browser primary | offerId=${offerId} | url=${url}`
            )

            // Make request using browser primary
            await this.makeRequest<any>(request, true)

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Received UrlReward response | offerId=${offerId}`
            )

            const newBalance = await this.bot.browser.func.getCurrentPoints()
            this.gainedPoints = newBalance - this.oldBalance

            this.bot.logger.debug(
                this.bot.isMobile,
                'URL-REWARD',
                `Balance delta after UrlReward | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
            )

            if (this.gainedPoints > 0) {
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

                this.bot.logger.info(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Completed UrlReward | offerId=${offerId} | gainedPoints=${this.gainedPoints} | newBalance=${newBalance}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'URL-REWARD',
                    `Failed UrlReward with no points | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
                )
            }

            this.bot.logger.debug(this.bot.isMobile, 'URL-REWARD', `Waiting after UrlReward | offerId=${offerId}`)

            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'URL-REWARD',
                `Error in doUrlReward | offerId=${promotion.offerId} | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}