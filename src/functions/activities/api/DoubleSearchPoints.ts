import type { AxiosRequestConfig } from 'axios'
import { Workers } from '../../Workers'
import { PromotionalItem } from '../../../interface/DashboardData'
import { HostRulesManager } from '../../../util/HostRules'

export class DoubleSearchPoints extends Workers {
    private cookieHeader: string = ''
    private fingerprintHeader: { [x: string]: string } = {}

    private get hostRules(): HostRulesManager {
        return new HostRulesManager(this.bot)
    }

    /**
     * Make a request using either axios or browser HTTP with fallback
     */
    private async makeRequest<T>(
        config: AxiosRequestConfig,
        useProxy: boolean,
        fallbackToBrowser: boolean = true
    ): Promise<T> {
        // Try axios first
        try {
            const response = await this.bot.axios.request(config, useProxy);
            return response.data as T;
        } catch (axiosError) {
            // If axios fails and browser HTTP is available, try that
            if (fallbackToBrowser && this.bot.browserHTTP?.isAvailable()) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DOUBLE-SEARCH-POINTS',
                    `Axios failed, falling back to browser HTTP: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
                );

                try {
                    // Extract method, url, headers from config
                    const method = config.method?.toUpperCase() || 'GET';
                    const url = config.url || '';
                    const headers = config.headers as Record<string, string> || {};
                    
                    // For POST requests with URLSearchParams, convert to object
                    let body = config.data;
                    if (config.data instanceof URLSearchParams) {
                        body = Object.fromEntries(config.data);
                    }

                    // Make request via browser
                    let response;
                    if (method === 'POST') {
                        response = await this.bot.browserHTTP.post<T>(url, body, headers);
                    } else {
                        response = await this.bot.browserHTTP.get<T>(url, headers);
                    }

                    return response.data as T;
                } catch (browserError) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'DOUBLE-SEARCH-POINTS',
                        `Browser HTTP also failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                    );
                    throw browserError;
                }
            }
            throw axiosError;
        }
    }

    public async doDoubleSearchPoints(promotion: PromotionalItem) {
        const offerId = promotion.offerId
        const activityType = promotion.activityType

        try {
            if (!this.bot.requestToken) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'DOUBLE-SEARCH-POINTS',
                    'Skipping: Request token not available, this activity requires it!'
                )
                return
            }

            this.cookieHeader = this.bot.browser.func.buildCookieHeader(
                this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop,
                ['bing.com', 'live.com', 'microsoftonline.com']
            )

            const fingerprintHeaders = { ...this.bot.fingerprint.headers }
            delete fingerprintHeaders['Cookie']
            delete fingerprintHeaders['cookie']
            this.fingerprintHeader = fingerprintHeaders

            this.bot.logger.info(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Starting Double Search Points | offerId=${offerId}`
            )

            this.bot.logger.debug(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Prepared headers | cookieLength=${this.cookieHeader.length} | fingerprintHeaderKeys=${Object.keys(this.fingerprintHeader).length}`
            )

            const formData = new URLSearchParams({
                id: offerId,
                hash: promotion.hash,
                timeZone: '60',
                activityAmount: '1',
                dbs: '0',
                form: '',
                type: activityType,
                __RequestVerificationToken: this.bot.requestToken
            })

            this.bot.logger.debug(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Prepared Double Search Points form data | offerId=${offerId} | hash=${promotion.hash} | timeZone=60 | activityAmount=1 | type=${activityType}`
            )

            const urlResult = this.hostRules.applyHostRules('https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest')
            const refererResult = this.hostRules.applyHostRules('https://rewards.bing.com/')
            const originResult = this.hostRules.applyHostRules('https://rewards.bing.com')

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'POST',
                headers: this.hostRules.buildHeaders(
                    {
                        ...(this.bot.fingerprint?.headers ?? {}),
                        Cookie: this.cookieHeader,
                        Referer: refererResult.url,
                        Origin: originResult.url
                    },
                    urlResult
                ),
                data: formData
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Sending Double Search Points request | offerId=${offerId} | url=${request.url}`
            )

            const responseData = await this.makeRequest<any>(request, true, true)

            this.bot.logger.debug(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Received Double Search Points response | offerId=${offerId}`
            )

            const data = await this.bot.browser.func.getDashboardData()
            const promotionalItem = data.promotionalItems.find(item =>
                item.name.toLowerCase().includes('ww_banner_optin_2x')
            )

            // If OK, should no longer be present in promotionalItems
            if (promotionalItem) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'DOUBLE-SEARCH-POINTS',
                    `Unable to find or activate Double Search Points | offerId=${offerId}`
                )
            } else {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'DOUBLE-SEARCH-POINTS',
                    `Activated Double Search Points | offerId=${offerId}`,
                    'green'
                )
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Waiting after Double Search Points | offerId=${offerId}`
            )

            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'DOUBLE-SEARCH-POINTS',
                `Error in doDoubleSearchPoints | offerId=${offerId} | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}