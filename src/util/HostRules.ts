import type { MicrosoftRewardsBot } from '../../index'

export interface HostRuleResult {
    url: string
    originalHostname?: string
}

export class HostRulesManager {
    private hostRulesMap: Map<string, string> | null = null
    private bot: MicrosoftRewardsBot
    private domainIpMap: Map<string, string> = new Map()

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.initializeDomainIpMap()
    }

    private initializeDomainIpMap(): void {
        this.domainIpMap.set('rewards.bing.com', '150.171.27.10')
        this.domainIpMap.set('www.bing.com', '150.171.27.10')
        this.domainIpMap.set('account.microsoft.com', '150.171.27.10')
        this.domainIpMap.set('prod.rewardsplatform.microsoft.com', '52.190.158.80')
        this.domainIpMap.set('trends.google.com', '142.250.185.46')
        this.domainIpMap.set('www.bingapis.com', '150.171.73.13')
        this.domainIpMap.set('api.bing.com', '150.171.73.13')
        this.domainIpMap.set('wikimedia.org', '198.35.26.96')
        this.domainIpMap.set('www.reddit.com', '151.101.1.140')
        this.domainIpMap.set('raw.githubusercontent.com', '185.199.108.133')
        this.domainIpMap.set('discord.com', '162.125.18.133')
    }

    private isIPv4(host: string): boolean {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
        return ipv4Regex.test(host)
    }

    private isIPv6(host: string): boolean {
        return host.includes(':')
    }

    private parseHostRules(): Map<string, string> {
        if (this.hostRulesMap !== null) {
            return this.hostRulesMap
        }

        const hostRules = process.env.CHROME_HOST_RULES || ''
        const rulesMap = new Map<string, string>()

        this.bot.logger.debug(this.bot.isMobile, 'HOST-RULES', `Parsing CHROME_HOST_RULES: "${hostRules}"`)

        if (!hostRules || hostRules.trim().length === 0) {
            this.bot.logger.debug(this.bot.isMobile, 'HOST-RULES', 'No host rules configured')
            this.addMissingDomains(rulesMap)
            this.hostRulesMap = rulesMap
            return rulesMap
        }

        const rules = hostRules
            .split(',')
            .map(r => r.trim())
            .filter(r => r.length > 0)

        for (const rule of rules) {
            const parts = rule.split(/\s+/).filter(p => p.length > 0)

            if (parts.length >= 3 && parts[0]?.toUpperCase() === 'MAP') {
                const originalDomain = parts[1]
                const mappedHost = parts[2]

                if (originalDomain && mappedHost) {
                    const existingValue = rulesMap.get(originalDomain)
                    const isCurrentIPv4 = this.isIPv4(mappedHost)
                    const isExistingIPv6 = existingValue && this.isIPv6(existingValue)

                    // Prefer IPv4 over IPv6
                    if (!existingValue || (isCurrentIPv4 && isExistingIPv6)) {
                        rulesMap.set(originalDomain, mappedHost)
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'HOST-RULES',
                            `Mapped: ${originalDomain} -> ${mappedHost}`
                        )
                    }
                }
            }
        }

        this.addMissingDomains(rulesMap)

        this.bot.logger.info(this.bot.isMobile, 'HOST-RULES', `Loaded ${rulesMap.size} host rules`)
        this.hostRulesMap = rulesMap
        return rulesMap
    }

    private addMissingDomains(rulesMap: Map<string, string>): void {
        for (const [domain, ip] of this.domainIpMap.entries()) {
            if (!rulesMap.has(domain)) {
                rulesMap.set(domain, ip)
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'HOST-RULES',
                    `Added missing domain: ${domain} -> ${ip}`
                )
            }
        }
    }

    applyHostRules(url: string): HostRuleResult {
        const rulesMap = this.parseHostRules()

        if (rulesMap.size === 0) {
            return { url }
        }

        try {
            const urlObj = new URL(url)
            const hostname = urlObj.hostname
            let originalHostname: string | undefined

            for (const [originalDomain, mappedHost] of rulesMap.entries()) {
                const isMatch = hostname === originalDomain || hostname.endsWith(`.${originalDomain}`)

                if (isMatch) {
                    originalHostname = hostname

                    try {
                        if (this.isIPv6(mappedHost)) {
                            urlObj.hostname = `[${mappedHost}]`
                        } else {
                            urlObj.hostname = mappedHost
                        }

                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'HOST-RULES',
                            `Applied rule: ${hostname} -> ${mappedHost}`
                        )
                        break
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            'HOST-RULES',
                            `Failed to apply host ${mappedHost}: ${error instanceof Error ? error.message : String(error)}`
                        )
                    }
                }
            }

            return { url: urlObj.toString(), originalHostname }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'HOST-RULES',
                `Failed to parse URL ${url}: ${error instanceof Error ? error.message : String(error)}`
            )
            return { url }
        }
    }

    buildHeaders(baseHeaders: any, urlResult: HostRuleResult, additionalHeaders?: any): any {
        const headers = {
            ...baseHeaders,
            ...additionalHeaders
        }

        if (urlResult.originalHostname) {
            headers['Host'] = urlResult.originalHostname
        }

        return headers
    }
}
