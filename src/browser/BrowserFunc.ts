import type { BrowserContext, Cookie, Page } from 'patchright'
import type { AxiosRequestConfig } from 'axios'

import type { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'
import { HostRulesManager } from '../util/HostRules'
import { BrowserHTTP } from '../util/BrowserHTTP'

import type { Counters, DashboardData } from './../interface/DashboardData'
import type { AppUserData } from '../interface/AppUserData'
import type { XboxDashboardData } from '../interface/XboxDashboardData'
import type { AppEarnablePoints, BrowserEarnablePoints, MissingSearchPoints } from '../interface/Points'
import type { AppDashboardData } from '../interface/AppDashBoardData'

export default class BrowserFunc {
    private bot: MicrosoftRewardsBot
    private hostRules: HostRulesManager
    private browserHTTP: BrowserHTTP  // Keep this - it's used

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.hostRules = new HostRulesManager(bot)
        this.browserHTTP = bot.browserHTTP  // Initialize from bot
    }

    /**
     * Set the browser page for HTTP requests
     */
    setPage(page: Page): void {
        if (!this.browserHTTP) {
            this.browserHTTP = this.bot.browserHTTP;
        }
        if (this.browserHTTP) {
            this.browserHTTP.setPage(page);
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-FUNC', 'Browser page set for HTTP requests');
        } else {
            this.bot.logger.error(this.bot.isMobile, 'BROWSER-FUNC', 'BrowserHTTP not available');
        }
    }

    /**
     * Check if browser HTTP is available
     */
    isBrowserHTTPAvailable(): boolean {
        return this.browserHTTP.isAvailable();
    }

    /**
     * Fetch dashboard data using browser-based HTTP (for blocked domains)
     */
    async getDashboardDataViaBrowser(): Promise<DashboardData> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-FUNC', 'Fetching dashboard data via browser...');
            
            const response = await this.browserHTTP.get<any>(
                'https://rewards.bing.com/api/getuserinfo?type=1'
            );

            if (response.data?.dashboard) {
                this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', 'Dashboard data fetched successfully via browser');
                return response.data.dashboard as DashboardData;
            }
            
            throw new Error('Dashboard data missing from browser response');
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Browser dashboard fetch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Fetch app dashboard data using browser-based HTTP
     */
    async getAppDashboardDataViaBrowser(): Promise<AppDashboardData> {
        try {
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613');
            
            const response = await this.browserHTTP.get<any>(urlResult.url, {
                'Authorization': `Bearer ${this.bot.accessToken}`,
                'User-Agent': 'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
            });

            return response.data as AppDashboardData;
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Browser app dashboard fetch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Fetch Xbox dashboard data using browser-based HTTP
     */
    async getXBoxDashboardDataViaBrowser(): Promise<XboxDashboardData> {
        try {
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6');
            
            const response = await this.browserHTTP.get<any>(urlResult.url, {
                'Authorization': `Bearer ${this.bot.accessToken}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
            });

            return response.data as XboxDashboardData;
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Browser Xbox dashboard fetch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Get app earnable points using browser-based HTTP
     */
    async getAppEarnablePointsViaBrowser(): Promise<AppEarnablePoints> {
        try {
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn'];
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613');
            
            const response = await this.browserHTTP.get<any>(urlResult.url, {
                'Authorization': `Bearer ${this.bot.accessToken}`,
                'X-Rewards-Country': this.bot.userData.geoLocale,
                'X-Rewards-Language': 'en',
                'X-Rewards-ismobile': 'true'
            });

            const userData: AppUserData = response.data;
            const eligibleActivities = userData.response.promotions.filter(x =>
                eligibleOffers.includes(x.attributes.offerid ?? '')
            );

            let readToEarn = 0;
            let checkIn = 0;

            for (const item of eligibleActivities) {
                const attrs = item.attributes;

                if (attrs.type === 'msnreadearn') {
                    const pointMax = parseInt(attrs.pointmax ?? '0');
                    const pointProgress = parseInt(attrs.pointprogress ?? '0');
                    readToEarn = Math.max(0, pointMax - pointProgress);
                } else if (attrs.type === 'checkin') {
                    const progress = parseInt(attrs.progress ?? '0');
                    const checkInDay = progress % 7;
                    const lastUpdated = new Date(attrs.last_updated ?? '');
                    const today = new Date();

                    if (checkInDay < 6 && today.getDate() !== lastUpdated.getDate()) {
                        checkIn = parseInt(attrs[`day_${checkInDay + 1}_points`] ?? '0');
                    }
                }
            }

            return {
                readToEarn,
                checkIn,
                totalEarnablePoints: readToEarn + checkIn
            };
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Browser app earnable points fetch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Enhanced getDashboardData with automatic fallback to browser if axios fails
     */
    async getDashboardData(): Promise<DashboardData> {
        // Try axios first (for domains that work)
        try {
            const urlResult = this.hostRules.applyHostRules('https://rewards.bing.com/api/getuserinfo?type=1');
            const refererResult = this.hostRules.applyHostRules('https://rewards.bing.com/');
            const originResult = this.hostRules.applyHostRules('https://rewards.bing.com');

            const headers = this.hostRules.buildHeaders(
                {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.buildCookieHeader(this.bot.cookies.mobile, [
                        'bing.com',
                        'live.com',
                        'microsoftonline.com'
                    ]),
                    Referer: refererResult.url,
                    Origin: originResult.url
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await this.bot.axios.request(request);

            if (response.data?.dashboard) {
                return response.data.dashboard as DashboardData;
            }
            throw new Error('Dashboard data missing from API response');
        } catch (axiosError) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'GET-DASHBOARD-DATA',
                `Axios failed, falling back to browser: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
            );

            // Fall back to browser-based HTTP
            try {
                return await this.getDashboardDataViaBrowser();
            } catch (browserError) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'GET-DASHBOARD-DATA',
                    `Both axios and browser failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
                throw browserError;
            }
        }
    }

    /**
     * Enhanced getAppDashboardData with automatic fallback to browser
     */
    async getAppDashboardData(): Promise<AppDashboardData> {
        try {
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613');

            const headers = this.hostRules.buildHeaders(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await this.bot.axios.request(request);
            return response.data as AppDashboardData;
        } catch (axiosError) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'GET-APP-DASHBOARD-DATA',
                `Axios failed, falling back to browser: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
            );

            try {
                return await this.getAppDashboardDataViaBrowser();
            } catch (browserError) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'GET-APP-DASHBOARD-DATA',
                    `Both axios and browser failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
                throw browserError;
            }
        }
    }

    /**
     * Enhanced getXBoxDashboardData with automatic fallback to browser
     */
    async getXBoxDashboardData(): Promise<XboxDashboardData> {
        try {
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6');

            const headers = this.hostRules.buildHeaders(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await this.bot.axios.request(request);
            return response.data as XboxDashboardData;
        } catch (axiosError) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'GET-XBOX-DASHBOARD-DATA',
                `Axios failed, falling back to browser: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
            );

            try {
                return await this.getXBoxDashboardDataViaBrowser();
            } catch (browserError) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'GET-XBOX-DASHBOARD-DATA',
                    `Both axios and browser failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
                throw browserError;
            }
        }
    }

    /**
     * Enhanced getAppEarnablePoints with automatic fallback to browser
     */
    async getAppEarnablePoints(): Promise<AppEarnablePoints> {
        try {
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn'];

            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613');

            const headers = this.hostRules.buildHeaders(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'X-Rewards-Country': this.bot.userData.geoLocale,
                    'X-Rewards-Language': 'en',
                    'X-Rewards-ismobile': 'true'
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await this.bot.axios.request(request);
            const userData: AppUserData = response.data;
            const eligibleActivities = userData.response.promotions.filter(x =>
                eligibleOffers.includes(x.attributes.offerid ?? '')
            );

            let readToEarn = 0;
            let checkIn = 0;

            for (const item of eligibleActivities) {
                const attrs = item.attributes;

                if (attrs.type === 'msnreadearn') {
                    const pointMax = parseInt(attrs.pointmax ?? '0');
                    const pointProgress = parseInt(attrs.pointprogress ?? '0');
                    readToEarn = Math.max(0, pointMax - pointProgress);
                } else if (attrs.type === 'checkin') {
                    const progress = parseInt(attrs.progress ?? '0');
                    const checkInDay = progress % 7;
                    const lastUpdated = new Date(attrs.last_updated ?? '');
                    const today = new Date();

                    if (checkInDay < 6 && today.getDate() !== lastUpdated.getDate()) {
                        checkIn = parseInt(attrs[`day_${checkInDay + 1}_points`] ?? '0');
                    }
                }
            }

            return {
                readToEarn,
                checkIn,
                totalEarnablePoints: readToEarn + checkIn
            };
        } catch (axiosError) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'GET-APP-EARNABLE-POINTS',
                `Axios failed, falling back to browser: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
            );

            try {
                return await this.getAppEarnablePointsViaBrowser();
            } catch (browserError) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'GET-APP-EARNABLE-POINTS',
                    `Both axios and browser failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
                throw browserError;
            }
        }
    }

    /**
     * Get search point counters
     */
    async getSearchPoints(): Promise<Counters> {
        const dashboardData = await this.getDashboardData()
        return dashboardData.userStatus.counters
    }

    missingSearchPoints(counters: Counters, isMobile: boolean): MissingSearchPoints {
        const mobileData = counters.mobileSearch?.[0]
        const desktopData = counters.pcSearch?.[0]
        const edgeData = counters.pcSearch?.[1]

        const mobilePoints = mobileData ? Math.max(0, mobileData.pointProgressMax - mobileData.pointProgress) : 0
        const desktopPoints = desktopData ? Math.max(0, desktopData.pointProgressMax - desktopData.pointProgress) : 0
        const edgePoints = edgeData ? Math.max(0, edgeData.pointProgressMax - edgeData.pointProgress) : 0

        const totalPoints = isMobile ? mobilePoints : desktopPoints + edgePoints

        return { mobilePoints, desktopPoints, edgePoints, totalPoints }
    }

    /**
     * Get total earnable points with web browser
     */
    async getBrowserEarnablePoints(): Promise<BrowserEarnablePoints> {
        try {
            const data = await this.getDashboardData()

            const desktopSearchPoints =
                data.userStatus.counters.pcSearch?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0

            const mobileSearchPoints =
                data.userStatus.counters.mobileSearch?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0

            const todayDate = this.bot.utils.getFormattedDate()
            const dailySetPoints =
                data.dailySetPromotions[todayDate]?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0

            const morePromotionsPoints =
                data.morePromotions?.reduce((sum, x) => {
                    if (
                        ['quiz', 'urlreward'].includes(x.promotionType) &&
                        x.exclusiveLockedFeatureStatus !== 'locked'
                    ) {
                        return sum + (x.pointProgressMax - x.pointProgress)
                    }
                    return sum
                }, 0) ?? 0

            const totalEarnablePoints = desktopSearchPoints + mobileSearchPoints + dailySetPoints + morePromotionsPoints

            return {
                dailySetPoints,
                morePromotionsPoints,
                desktopSearchPoints,
                mobileSearchPoints,
                totalEarnablePoints
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-BROWSER-EARNABLE-POINTS',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    /**
     * Get current point amount
     */
    async getCurrentPoints(): Promise<number> {
        try {
            const data = await this.getDashboardData()
            return data.userStatus.availablePoints
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-CURRENT-POINTS',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    async closeBrowser(browser: BrowserContext, email: string) {
        try {
            const cookies = await browser.cookies()

            this.bot.logger.debug(
                this.bot.isMobile,
                'CLOSE-BROWSER',
                `Saving ${cookies.length} cookies to session folder!`
            )
            await saveSessionData(this.bot.config.sessionPath, cookies, email, this.bot.isMobile)

            await this.bot.utils.wait(2000)

            await browser.close()
            this.bot.logger.info(this.bot.isMobile, 'CLOSE-BROWSER', 'Browser closed cleanly!')
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'CLOSE-BROWSER',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    buildCookieHeader(cookies: Cookie[], allowedDomains?: string[]): string {
        return [
            ...new Map(
                cookies
                    .filter(c => {
                        if (!allowedDomains || allowedDomains.length === 0) return true
                        return (
                            typeof c.domain === 'string' &&
                            allowedDomains.some(d => c.domain.toLowerCase().endsWith(d.toLowerCase()))
                        )
                    })
                    .map(c => [c.name, c])
            ).values()
        ]
            .map(c => `${c.name}=${c.value}`)
            .join('; ')
    }
}