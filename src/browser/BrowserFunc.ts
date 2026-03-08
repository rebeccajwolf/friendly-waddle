import type { BrowserContext, Cookie, Page } from 'patchright'
import type { AxiosRequestConfig } from 'axios'

import type { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'
import { HostRulesManager } from '../util/HostRules'
import { BrowserHTTP } from '../util/BrowserHTTP'
import { safeRequest } from '../util/safeAxios'

import type { Counters, DashboardData } from './../interface/DashboardData'
import type { AppUserData } from '../interface/AppUserData'
import type { XboxDashboardData } from '../interface/XboxDashboardData'
import type { AppEarnablePoints, BrowserEarnablePoints, MissingSearchPoints } from '../interface/Points'
import type { AppDashboardData } from '../interface/AppDashBoardData'

export default class BrowserFunc {
    private bot: MicrosoftRewardsBot
    private hostRules: HostRulesManager
    private browserHTTP: BrowserHTTP

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.hostRules = new HostRulesManager(bot)
        this.browserHTTP = bot.browserHTTP
    }

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

    isBrowserHTTPAvailable(): boolean {
        return this.browserHTTP.isAvailable();
    }

    private applyHostRulesToUrl(url: string): { url: string; originalHostname?: string } {
        return this.hostRules.applyHostRules(url);
    }

    private buildHeadersWithHostRules(baseHeaders: any, url: string, additionalHeaders?: any): any {
        const urlResult = this.applyHostRulesToUrl(url);
        return this.hostRules.buildHeaders(baseHeaders, urlResult, additionalHeaders);
    }

    async getDashboardDataViaBrowser(): Promise<DashboardData> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER-FUNC', 'Fetching dashboard data via browser...');
            
            const url = 'https://rewards.bing.com/api/getuserinfo?type=1';
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `Using plain URL for dashboard: ${url}`);
            
            const headers = this.buildHeadersWithHostRules(
                {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.buildCookieHeader(this.bot.cookies.mobile, [
                        'bing.com',
                        'live.com',
                        'microsoftonline.com'
                    ])
                },
                url
            );

            this.bot.logger.debug(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Fetching dashboard via browser with URL: ${url}`
            );

            const response = await this.browserHTTP.get<any>(url, headers);
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `Dashboard response status: ${response.status}`);
            
            if (response.data && typeof response.data === 'object') {
                if (response.data.dashboard) {
                    this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', 'Dashboard data fetched successfully via browser');
                    return response.data.dashboard as DashboardData;
                }
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

    async getAppDashboardDataViaBrowser(): Promise<AppDashboardData> {
        try {
            const url = 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613';
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `Using plain URL for app dashboard: ${url}`);
            
            const headers = this.buildHeadersWithHostRules(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                },
                url
            );

            this.bot.logger.debug(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Fetching app dashboard via browser with URL: ${url}`
            );

            const response = await this.browserHTTP.get<any>(url, headers);
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `App dashboard response status: ${response.status}`);

            if (response.status === 200) {
                return response.data as AppDashboardData;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Browser app dashboard fetch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    async getXBoxDashboardDataViaBrowser(): Promise<XboxDashboardData> {
        try {
            const url = 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6';
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `Using plain URL for Xbox dashboard: ${url}`);
            
            const headers = this.buildHeadersWithHostRules(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
                },
                url
            );

            this.bot.logger.debug(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Fetching Xbox dashboard via browser with URL: ${url}`
            );

            const response = await this.browserHTTP.get<any>(url, headers);
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `Xbox dashboard response status: ${response.status}`);

            if (response.status === 200) {
                return response.data as XboxDashboardData;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Browser Xbox dashboard fetch failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    async getAppEarnablePointsViaBrowser(): Promise<AppEarnablePoints> {
        try {
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn'];
            
            const url = 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613';
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `Using plain URL for app earnable points: ${url}`);
            
            const headers = this.buildHeadersWithHostRules(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                },
                url
            );

            this.bot.logger.debug(
                this.bot.isMobile,
                'BROWSER-FUNC',
                `Fetching app earnable points via browser with URL: ${url}`
            );

            const response = await this.browserHTTP.get<any>(url, headers);
            
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FUNC', `App earnable points response status: ${response.status}`);

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
    
    
    async getDashboardData(): Promise<DashboardData> {
        if (this.browserHTTP.isAvailable()) {
            try {
                this.bot.logger.debug(this.bot.isMobile, 'GET-DASHBOARD-DATA', 'Attempting browser HTTP first...');
                return await this.getDashboardDataViaBrowser();
            } catch (browserError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'GET-DASHBOARD-DATA',
                    `Browser HTTP failed, falling back to safeRequest: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
            }
        }

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

            const response = await safeRequest(this.bot, urlResult.url, request);

            if (response.data?.dashboard) {
                return response.data.dashboard as DashboardData;
            }
            throw new Error('Dashboard data missing from API response');
        } catch (safeError) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-DASHBOARD-DATA',
                `Both browser and safeRequest failed: ${safeError instanceof Error ? safeError.message : String(safeError)}`
            );
            throw safeError;
        }
    }

    async getAppDashboardData(): Promise<AppDashboardData> {
        if (this.browserHTTP.isAvailable()) {
            try {
                this.bot.logger.debug(this.bot.isMobile, 'GET-APP-DASHBOARD-DATA', 'Attempting browser HTTP first...');
                return await this.getAppDashboardDataViaBrowser();
            } catch (browserError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'GET-APP-DASHBOARD-DATA',
                    `Browser HTTP failed, falling back to safeRequest: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
            }
        }

        try {
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613');

            const headers = this.hostRules.buildHeaders(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await safeRequest(this.bot, urlResult.url, request);
            return response.data as AppDashboardData;
        } catch (safeError) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-APP-DASHBOARD-DATA',
                `Both browser and safeRequest failed: ${safeError instanceof Error ? safeError.message : String(safeError)}`
            );
            throw safeError;
        }
    }

    async getXBoxDashboardData(): Promise<XboxDashboardData> {
        if (this.browserHTTP.isAvailable()) {
            try {
                this.bot.logger.debug(this.bot.isMobile, 'GET-XBOX-DASHBOARD-DATA', 'Attempting browser HTTP first...');
                return await this.getXBoxDashboardDataViaBrowser();
            } catch (browserError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'GET-XBOX-DASHBOARD-DATA',
                    `Browser HTTP failed, falling back to safeRequest: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
            }
        }

        try {
            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6');

            const headers = this.hostRules.buildHeaders(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await safeRequest(this.bot, urlResult.url, request);
            return response.data as XboxDashboardData;
        } catch (safeError) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-XBOX-DASHBOARD-DATA',
                `Both browser and safeRequest failed: ${safeError instanceof Error ? safeError.message : String(safeError)}`
            );
            throw safeError;
        }
    }

    async getAppEarnablePoints(): Promise<AppEarnablePoints> {
        if (this.browserHTTP.isAvailable()) {
            try {
                this.bot.logger.debug(this.bot.isMobile, 'GET-APP-EARNABLE-POINTS', 'Attempting browser HTTP first...');
                return await this.getAppEarnablePointsViaBrowser();
            } catch (browserError) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'GET-APP-EARNABLE-POINTS',
                    `Browser HTTP failed, falling back to safeRequest: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
            }
        }

        try {
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn'];

            const urlResult = this.hostRules.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613');

            const headers = this.hostRules.buildHeaders(
                {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent': 'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                },
                urlResult
            );

            const request: AxiosRequestConfig = {
                url: urlResult.url,
                method: 'GET',
                headers
            };

            const response = await safeRequest(this.bot, urlResult.url, request);
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
        } catch (safeError) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-APP-EARNABLE-POINTS',
                `Both browser and safeRequest failed: ${safeError instanceof Error ? safeError.message : String(safeError)}`
            );
            throw safeError;
        }
    }

    async getSearchPoints(): Promise<Counters> {
        const dashboardData = await this.getDashboardData();
        return dashboardData.userStatus.counters;
    }

    missingSearchPoints(counters: Counters, isMobile: boolean): MissingSearchPoints {
        const mobileData = counters.mobileSearch?.[0];
        const desktopData = counters.pcSearch?.[0];
        const edgeData = counters.pcSearch?.[1];

        const mobilePoints = mobileData ? Math.max(0, mobileData.pointProgressMax - mobileData.pointProgress) : 0;
        const desktopPoints = desktopData ? Math.max(0, desktopData.pointProgressMax - desktopData.pointProgress) : 0;
        const edgePoints = edgeData ? Math.max(0, edgeData.pointProgressMax - edgeData.pointProgress) : 0;

        const totalPoints = isMobile ? mobilePoints : desktopPoints + edgePoints;

        return { mobilePoints, desktopPoints, edgePoints, totalPoints };
    }

    async getBrowserEarnablePoints(): Promise<BrowserEarnablePoints> {
        try {
            const data = await this.getDashboardData();

            const desktopSearchPoints =
                data.userStatus.counters.pcSearch?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0;

            const mobileSearchPoints =
                data.userStatus.counters.mobileSearch?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0;

            const todayDate = this.bot.utils.getFormattedDate();
            const dailySetPoints =
                data.dailySetPromotions[todayDate]?.reduce(
                    (sum, x) => sum + (x.pointProgressMax - x.pointProgress),
                    0
                ) ?? 0;

            const morePromotionsPoints =
                data.morePromotions?.reduce((sum, x) => {
                    if (
                        ['quiz', 'urlreward'].includes(x.promotionType) &&
                        x.exclusiveLockedFeatureStatus !== 'locked'
                    ) {
                        return sum + (x.pointProgressMax - x.pointProgress);
                    }
                    return sum;
                }, 0) ?? 0;

            const totalEarnablePoints = desktopSearchPoints + mobileSearchPoints + dailySetPoints + morePromotionsPoints;

            return {
                dailySetPoints,
                morePromotionsPoints,
                desktopSearchPoints,
                mobileSearchPoints,
                totalEarnablePoints
            };
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-BROWSER-EARNABLE-POINTS',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    async getCurrentPoints(): Promise<number> {
        try {
            const data = await this.getDashboardData();
            return data.userStatus.availablePoints;
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-CURRENT-POINTS',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    async closeBrowser(browser: BrowserContext, email: string) {
        try {
            const cookies = await browser.cookies();

            this.bot.logger.debug(
                this.bot.isMobile,
                'CLOSE-BROWSER',
                `Saving ${cookies.length} cookies to session folder!`
            );
            await saveSessionData(this.bot.config.sessionPath, cookies, email, this.bot.isMobile);

            await this.bot.utils.wait(2000);

            await browser.close();
            this.bot.logger.info(this.bot.isMobile, 'CLOSE-BROWSER', 'Browser closed cleanly!');
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'CLOSE-BROWSER',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    buildCookieHeader(cookies: Cookie[], allowedDomains?: string[]): string {
        return [
            ...new Map(
                cookies
                    .filter(c => {
                        if (!allowedDomains || allowedDomains.length === 0) return true;
                        return (
                            typeof c.domain === 'string' &&
                            allowedDomains.some(d => c.domain.toLowerCase().endsWith(d.toLowerCase()))
                        );
                    })
                    .map(c => [c.name, c])
            ).values()
        ]
            .map(c => `\( {c.name}= \){c.value}`)
            .join('; ');
    }
}