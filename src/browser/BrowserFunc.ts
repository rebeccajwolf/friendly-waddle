import type { BrowserContext, Cookie } from 'patchright'
import type { AxiosRequestConfig } from 'axios'

import type { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'

import type { Counters, DashboardData } from './../interface/DashboardData'
import type { AppUserData } from '../interface/AppUserData'
import type { XboxDashboardData } from '../interface/XboxDashboardData'
import type { AppEarnablePoints, BrowserEarnablePoints, MissingSearchPoints } from '../interface/Points'
import type { AppDashboardData } from '../interface/AppDashBoardData'

export default class BrowserFunc {
    private bot: MicrosoftRewardsBot
    private hostRulesMap: Map<string, string> | null = null

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    private parseHostRules(): Map<string, string> {
        if (this.hostRulesMap !== null) {
            return this.hostRulesMap
        }

        const hostRules = process.env.CHROME_HOST_RULES || ''
        const rulesMap = new Map<string, string>()

        if (this.bot.logger && this.bot.config) {
            this.bot.logger.info(
                this.bot.isMobile,
                'PARSE-HOST-RULES',
                `Raw CHROME_HOST_RULES env: "${hostRules}"`
            )
        }

        if (!hostRules || hostRules.trim().length === 0) {
            if (this.bot.logger && this.bot.config) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'PARSE-HOST-RULES',
                    'CHROME_HOST_RULES not configured or empty'
                )
            }
            this.hostRulesMap = rulesMap
            return rulesMap
        }

        const rules = hostRules.split(',').map(r => r.trim()).filter(r => r.length > 0)

        if (this.bot.logger && this.bot.config) {
            this.bot.logger.info(
                this.bot.isMobile,
                'PARSE-HOST-RULES',
                `Found ${rules.length} rules to parse`
            )
        }

        for (const rule of rules) {
            const parts = rule.split(/\s+/).filter(p => p.length > 0)

            if (this.bot.logger && this.bot.config) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'PARSE-HOST-RULES',
                    `Processing rule: "${rule}" | Parts count: ${parts.length}`
                )
            }

            if (parts.length >= 3 && parts[0] && parts[0].toUpperCase() === 'MAP') {
                const originalDomain = parts[1]
                const mappedHost = parts[2]

                if (originalDomain && mappedHost) {
                    const existingValue = rulesMap.get(originalDomain)
                    const isCurrentIPv4 = this.isIPv4(mappedHost)
                    const isExistingIPv6 = existingValue && this.isIPv6(existingValue)
                    const shouldUpdate = !existingValue || isCurrentIPv4

                    if (shouldUpdate) {
                        rulesMap.set(originalDomain, mappedHost)

                        if (this.bot.logger && this.bot.config) {
                            if (existingValue && isCurrentIPv4 && isExistingIPv6) {
                                this.bot.logger.debug(
                                    this.bot.isMobile,
                                    'PARSE-HOST-RULES',
                                    `Replacing IPv6 ${existingValue} with IPv4 ${mappedHost} for ${originalDomain}`
                                )
                            } else {
                                this.bot.logger.info(
                                    this.bot.isMobile,
                                    'PARSE-HOST-RULES',
                                    `✓ Successfully parsed: ${originalDomain} -> ${mappedHost}`
                                )
                            }
                        }
                    } else if (this.bot.logger && this.bot.config) {
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'PARSE-HOST-RULES',
                            `Skipping IPv6 ${mappedHost} for ${originalDomain}, keeping existing IPv4 ${existingValue}`
                        )
                    }
                }
            } else {
                if (this.bot.logger && this.bot.config) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'PARSE-HOST-RULES',
                        `✗ Invalid format: "${rule}" | Expected: MAP domain ip | Parts: ${parts.join(', ')}`
                    )
                }
            }
        }

        if (this.bot.logger && this.bot.config) {
            this.bot.logger.info(
                this.bot.isMobile,
                'PARSE-HOST-RULES',
                `✓ COMPLETED: Parsed ${rulesMap.size} host rules total`
            )

            if (rulesMap.size > 0) {
                const rulesDebug = Array.from(rulesMap.entries())
                    .map(([domain, ip]) => `${domain}->${ip}`)
                    .join(' | ')
                this.bot.logger.info(
                    this.bot.isMobile,
                    'PARSE-HOST-RULES',
                    `Host rules mapping: ${rulesDebug}`
                )
            }
        }

        this.hostRulesMap = rulesMap
        return rulesMap
    }

    private applyHostRules(url: string): string {
        const rulesMap = this.parseHostRules()

        if (rulesMap.size === 0) {
            if (this.bot.logger && this.bot.config) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'APPLY-HOST-RULES',
                    `No host rules configured, using original URL: ${url}`
                )
            }
            return url
        }

        try {
            const urlObj = new URL(url)
            const hostname = urlObj.hostname

            if (this.bot.logger && this.bot.config) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'APPLY-HOST-RULES',
                    `Processing URL: ${url} | Hostname: ${hostname}`
                )
            }

            let ruleApplied = false

            for (const [originalDomain, mappedHost] of rulesMap.entries()) {
                const isMatch = hostname === originalDomain || hostname.endsWith(`.${originalDomain}`)

                if (this.bot.logger && this.bot.config) {
                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'APPLY-HOST-RULES',
                        `Checking rule: ${originalDomain} -> ${mappedHost} | Match: ${isMatch}`
                    )
                }

                if (isMatch) {
                    const originalUrl = urlObj.toString()

                    try {
                        if (this.isIPv6(mappedHost)) {
                            urlObj.hostname = `[${mappedHost}]`
                        } else {
                            urlObj.hostname = mappedHost
                        }

                        const transformedUrl = urlObj.toString()

                        if (this.bot.logger && this.bot.config) {
                            this.bot.logger.info(
                                this.bot.isMobile,
                                'APPLY-HOST-RULES',
                                `✓ RULE APPLIED: ${originalDomain} -> ${mappedHost} | Original: ${originalUrl} | Transformed: ${transformedUrl}`
                            )
                        }

                        ruleApplied = true
                        break
                    } catch (hostError) {
                        if (this.bot.logger && this.bot.config) {
                            this.bot.logger.error(
                                this.bot.isMobile,
                                'APPLY-HOST-RULES',
                                `Failed to apply host: ${mappedHost} | Error: ${hostError instanceof Error ? hostError.message : String(hostError)}`
                            )
                        }
                    }
                }
            }

            if (!ruleApplied) {
                if (this.bot.logger && this.bot.config) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'APPLY-HOST-RULES',
                        `No matching rule found for hostname: ${hostname} | URL: ${url}`
                    )
                }
            }

            return urlObj.toString()
        } catch (error) {
            if (this.bot.logger && this.bot.config) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'APPLY-HOST-RULES',
                    `Failed to parse URL: ${url} | Error: ${error instanceof Error ? error.message : String(error)}`
                )
            }
            return url
        }
    }

    private isIPv4(host: string): boolean {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
        return ipv4Regex.test(host)
    }

    private isIPv6(host: string): boolean {
        return host.includes(':')
    }

    /**
     * Fetch user desktop dashboard data
     * @returns {DashboardData} Object of user bing rewards dashboard data
     */
    async getDashboardData(): Promise<DashboardData> {
        try {
            const request: AxiosRequestConfig = {
                url: this.applyHostRules('https://rewards.bing.com/api/getuserinfo?type=1'),
                method: 'GET',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.buildCookieHeader(this.bot.cookies.mobile, [
                        'bing.com',
                        'live.com',
                        'microsoftonline.com'
                    ]),
                    Referer: this.applyHostRules('https://rewards.bing.com/'),
                    Origin: this.applyHostRules('https://rewards.bing.com')
                }
            }

            const response = await this.bot.axios.request(request)

            if (response.data?.dashboard) {
                return response.data.dashboard as DashboardData
            }
            throw new Error('Dashboard data missing from API response')
        } catch (error) {
            this.bot.logger.warn(this.bot.isMobile, 'GET-DASHBOARD-DATA', 'API failed, trying HTML fallback')

            // Try using script from dashboard page
            try {
                const request: AxiosRequestConfig = {
                    url: this.applyHostRules(this.bot.config.baseURL),
                    method: 'GET',
                    headers: {
                        ...(this.bot.fingerprint?.headers ?? {}),
                        Cookie: this.buildCookieHeader(this.bot.cookies.mobile),
                        Referer: this.applyHostRules('https://rewards.bing.com/'),
                        Origin: this.applyHostRules('https://rewards.bing.com')
                    }
                }

                const response = await this.bot.axios.request(request)
                const match = response.data.match(/var\s+dashboard\s*=\s*({.*?});/s)

                if (!match?.[1]) {
                    throw new Error('Dashboard script not found in HTML')
                }

                return JSON.parse(match[1]) as DashboardData
            } catch (fallbackError) {
                // If both fail
                this.bot.logger.error(this.bot.isMobile, 'GET-DASHBOARD-DATA', 'Failed to get dashboard data')
                throw fallbackError
            }
        }
    }

    /**
     * Fetch user app dashboard data
     * @returns {AppDashboardData} Object of user bing rewards dashboard data
     */
    async getAppDashboardData(): Promise<AppDashboardData> {
        try {
            const request: AxiosRequestConfig = {
                url: this.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613'),
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Bing/32.5.431027001 (com.microsoft.bing; build:431027001; iOS 17.6.1) Alamofire/5.10.2'
                }
            }

            const response = await this.bot.axios.request(request)
            return response.data as AppDashboardData
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-APP-DASHBOARD-DATA',
                `Error fetching dashboard data: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    /**
     * Fetch user xbox dashboard data
     * @returns {XboxDashboardData} Object of user bing rewards dashboard data
     */
    async getXBoxDashboardData(): Promise<XboxDashboardData> {
        try {
            const request: AxiosRequestConfig = {
                url: this.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6'),
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One X) AppleWebKit/537.36 (KHTML, like Gecko) Edge/18.19041'
                }
            }

            const response = await this.bot.axios.request(request)
            return response.data as XboxDashboardData
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-XBOX-DASHBOARD-DATA',
                `Error fetching dashboard data: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    /**
     * Get search point counters
     */
    async getSearchPoints(): Promise<Counters> {
        const dashboardData = await this.getDashboardData() // Always fetch newest data

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
     * Get total earnable points with mobile app
     */
    async getAppEarnablePoints(): Promise<AppEarnablePoints> {
        try {
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn']

            const request: AxiosRequestConfig = {
                url: this.applyHostRules('https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613'),
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.bot.accessToken}`,
                    'X-Rewards-Country': this.bot.userData.geoLocale,
                    'X-Rewards-Language': 'en',
                    'X-Rewards-ismobile': 'true'
                }
            }

            const response = await this.bot.axios.request(request)
            const userData: AppUserData = response.data
            const eligibleActivities = userData.response.promotions.filter(x =>
                eligibleOffers.includes(x.attributes.offerid ?? '')
            )

            let readToEarn = 0
            let checkIn = 0

            for (const item of eligibleActivities) {
                const attrs = item.attributes

                if (attrs.type === 'msnreadearn') {
                    const pointMax = parseInt(attrs.pointmax ?? '0')
                    const pointProgress = parseInt(attrs.pointprogress ?? '0')
                    readToEarn = Math.max(0, pointMax - pointProgress)
                } else if (attrs.type === 'checkin') {
                    const progress = parseInt(attrs.progress ?? '0')
                    const checkInDay = progress % 7
                    const lastUpdated = new Date(attrs.last_updated ?? '')
                    const today = new Date()

                    if (checkInDay < 6 && today.getDate() !== lastUpdated.getDate()) {
                        checkIn = parseInt(attrs[`day_${checkInDay + 1}_points`] ?? '0')
                    }
                }
            }

            const totalEarnablePoints = readToEarn + checkIn

            return {
                readToEarn,
                checkIn,
                totalEarnablePoints
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-APP-EARNABLE-POINTS',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }
    /**
     * Get current point amount
     * @returns {number} Current total point amount
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

            // Save cookies
            this.bot.logger.debug(
                this.bot.isMobile,
                'CLOSE-BROWSER',
                `Saving ${cookies.length} cookies to session folder!`
            )
            await saveSessionData(this.bot.config.sessionPath, cookies, email, this.bot.isMobile)

            await this.bot.utils.wait(2000)

            // Close browser
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
