import type { AxiosRequestConfig } from 'axios'
import { randomUUID } from 'crypto'
import type { Promotion } from '../../../interface/AppDashBoardData'
import { Workers } from '../../Workers'
import { HostRulesManager } from '../../../util/HostRules'

export class AppReward extends Workers {
    private get hostRules(): HostRulesManager {
        return new HostRulesManager(this.bot)
    }
    private gainedPoints: number = 0
    private oldBalance: number = this.bot.userData.currentPoints

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
                    'APP-REWARD',
                    `Axios failed, falling back to browser HTTP: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
                );

                try {
                    const method = config.method?.toUpperCase() || 'GET';
                    const url = config.url || '';
                    const headers = config.headers as Record<string, string> || {};
                    
                    // Handle JSON string body
                    let body = config.data;
                    if (typeof body === 'string') {
                        try {
                            body = JSON.parse(body);
                        } catch {
                            // Keep as string if not JSON
                        }
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
                        'APP-REWARD',
                        `Browser HTTP also failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                    );
                    throw browserError;
                }
            }
            throw axiosError;
        }
    }

    public async doAppReward(promotion: Promotion) {
        if (!this.bot.accessToken) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'APP-REWARD',
                'Skipping: App access token not available, this activity requires it!'
            )
            return
        }

        const offerId = promotion.attributes['offerid']

        this.bot.logger.info(
            this.bot.isMobile,
            'APP-REWARD',
            `Starting AppReward | offerId=${offerId} | country=${this.bot.userData.geoLocale} | oldBalance=${this.oldBalance}`
        )

        try {
            const jsonData = {
                id: randomUUID(),
                amount: 1,
                type: 101,
                attributes: {
                    offerid: offerId
                },
                country: this.bot.userData.geoLocale
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'APP-REWARD',
                `Prepared activity payload | offerId=${offerId} | id=${jsonData.id} | amount=${jsonData.amount} | type=${jsonData.type} | country=${jsonData.country}`
            )

            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me/activities')

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'POST',
                headers: this.hostRules.buildHeaders(
                    {
                        Authorization: `Bearer ${this.bot.accessToken}`,
                        'User-Agent':
                            'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2',
                        'Content-Type': 'application/json',
                        'X-Rewards-Country': this.bot.userData.geoLocale,
                        'X-Rewards-Language': 'en',
                        'X-Rewards-ismobile': 'true'
                    },
                    urlResult
                ),
                data: JSON.stringify(jsonData)
            }

            this.bot.logger.debug(
                this.bot.isMobile,
                'APP-REWARD',
                `Sending activity request | offerId=${offerId} | url=${request.url}`
            )

            const responseData = await this.makeRequest<any>(request, true, true)

            this.bot.logger.debug(
                this.bot.isMobile,
                'APP-REWARD',
                `Received activity response | offerId=${offerId}`
            )

            const newBalance = Number(responseData?.response?.balance ?? this.oldBalance)
            this.gainedPoints = newBalance - this.oldBalance

            this.bot.logger.debug(
                this.bot.isMobile,
                'APP-REWARD',
                `Balance delta after AppReward | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance} | gainedPoints=${this.gainedPoints}`
            )

            if (this.gainedPoints > 0) {
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + this.gainedPoints

                this.bot.logger.info(
                    this.bot.isMobile,
                    'APP-REWARD',
                    `Completed AppReward | offerId=${offerId} | gainedPoints=${this.gainedPoints} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'APP-REWARD',
                    `Completed AppReward with no points | offerId=${offerId} | oldBalance=${this.oldBalance} | newBalance=${newBalance}`
                )
            }

            this.bot.logger.debug(this.bot.isMobile, 'APP-REWARD', `Waiting after AppReward | offerId=${offerId}`)

            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 10000))

            this.bot.logger.info(
                this.bot.isMobile,
                'APP-REWARD',
                `Finished AppReward | offerId=${offerId} | finalBalance=${this.bot.userData.currentPoints}`
            )
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'APP-REWARD',
                `Error in doAppReward | offerId=${offerId} | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}