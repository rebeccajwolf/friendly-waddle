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
                    'URL-REWARD',
                    `Axios failed, falling back to browser HTTP: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
                );

                try {
                    const method = config.method?.toUpperCase() || 'GET';
                    const url = config.url || '';
                    const headers = config.headers as Record<string, string> || {};
                    
                    let body = config.data;
                    if (config.data instanceof URLSearchParams) {
                        body = Object.fromEntries(config.data);
                    }

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
                        'URL-REWARD',
                        `Browser HTTP also failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                    );
                    throw browserError;
                }
            }
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
                'URL-REWARD',
                `Sending UrlReward request | offerId=${offerId} | url=${request.url}`
            )

            // Make request but we don't need to use the response data
            await this.makeRequest<any>(request, true, true)

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