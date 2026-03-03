import type { AxiosRequestConfig } from 'axios'
import { randomBytes } from 'crypto'
import { Workers } from '../../Workers'
import { HostRulesManager } from '../../../util/HostRules'

export class ReadToEarn extends Workers {
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
                    'READ-TO-EARN',
                    `Axios failed, falling back to browser HTTP: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
                );

                try {
                    const method = config.method?.toUpperCase() || 'GET';
                    const url = config.url || '';
                    const headers = config.headers as Record<string, string> || {};
                    
                    let body = config.data;
                    if (typeof body === 'string') {
                        try {
                            body = JSON.parse(body);
                        } catch {
                            // Keep as string if not JSON
                        }
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
                        'READ-TO-EARN',
                        `Browser HTTP also failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                    );
                    throw browserError;
                }
            }
            throw axiosError;
        }
    }

    public async doReadToEarn() {
        if (!this.bot.accessToken) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'READ-TO-EARN',
                'Skipping: App access token not available, this activity requires it!'
            )
            return
        }

        const delayMin = this.bot.config.searchSettings.readDelay.min
        const delayMax = this.bot.config.searchSettings.readDelay.max
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(
            this.bot.isMobile,
            'READ-TO-EARN',
            `Starting Read to Earn | geo=${this.bot.userData.geoLocale} | delayRange=${delayMin}-${delayMax} | currentPoints=${startBalance}`
        )

        try {
            const jsonData = {
                amount: 1,
                id: '1',
                type: 101,
                attributes: {
                    offerid: 'ENUS_readarticle3_30points'
                },
                country: this.bot.userData.geoLocale
            }

            const articleCount = 10
            let totalGained = 0
            let articlesRead = 0
            let oldBalance = startBalance

            for (let i = 0; i < articleCount; ++i) {
                jsonData.id = randomBytes(64).toString('hex')

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Submitting Read to Earn activity | article=${i + 1}/${articleCount} | id=${jsonData.id} | country=${jsonData.country}`
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

                const responseData = await this.makeRequest<any>(request, true, true)

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Received Read to Earn response | article=${i + 1}/${articleCount}`
                )

                const newBalance = Number(responseData?.response?.balance ?? oldBalance)
                const gainedPoints = newBalance - oldBalance

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Balance delta after article | article=${i + 1}/${articleCount} | oldBalance=${oldBalance} | newBalance=${newBalance} | gainedPoints=${gainedPoints}`
                )

                if (gainedPoints <= 0) {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'READ-TO-EARN',
                        `No points gained, stopping Read to Earn | article=${i + 1}/${articleCount} | oldBalance=${oldBalance} | newBalance=${newBalance}`
                    )
                    break
                }

                // Update point tracking
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints
                totalGained += gainedPoints
                articlesRead = i + 1
                oldBalance = newBalance

                this.bot.logger.info(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Read article ${i + 1}/${articleCount} | gainedPoints=${gainedPoints} | newBalance=${newBalance}`,
                    'green'
                )

                // Wait random delay between articles
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Waiting between articles | article=${i + 1}/${articleCount} | delayRange=${delayMin}-${delayMax}`
                )

                await this.bot.utils.wait(this.bot.utils.randomDelay(delayMin, delayMax))
            }

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)

            this.bot.logger.info(
                this.bot.isMobile,
                'READ-TO-EARN',
                `Completed Read to Earn | articlesRead=${articlesRead} | totalGained=${totalGained} | startBalance=${startBalance} | finalBalance=${finalBalance}`
            )
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'READ-TO-EARN',
                `Error during Read to Earn | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}