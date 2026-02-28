import type { MicrosoftRewardsBot } from '../index'

export interface HostRuleResult {
    url: string
    originalHostname?: string
}

export class HostRulesManager {
    private bot: MicrosoftRewardsBot
    private hostRules: Map<string, string[]> = new Map()
    private currentIpIndex: Map<string, number> = new Map()

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.initializeHostRules()
    }

    private initializeHostRules(): void {
        this.hostRules.set('rewards.bing.com', [
            '150.171.30.10',
            '150.171.29.10', 
            '150.171.28.10',
            '150.171.27.10'
        ])
        this.hostRules.set('www.bing.com', [
            '2.18.67.162',
            '2.18.67.135',
            '2.18.67.136'
        ])
        this.hostRules.set('account.microsoft.com', [
            '150.171.30.10',
            '150.171.29.10'
        ])
        this.hostRules.set('prod.rewardsplatform.microsoft.com', [
            '13.107.213.40',
            '13.107.246.40'
        ])
        this.hostRules.set('login.live.com', [
            '13.107.213.40',
            '13.107.246.40'
        ])
        this.hostRules.set('www.bingapis.com', [
            '2.18.67.162',
            '150.171.73.13'
        ])
        this.hostRules.set('api.bing.com', [
            '2.18.67.162',
            '150.171.73.13'
        ])
        this.hostRules.set('discord.com', [
            '162.159.135.232',
            '162.159.128.233',
            '162.159.138.232'
        ])
        this.hostRules.set('gateway.discord.gg', [
            '162.159.136.234',
            '162.159.134.234'
        ])
        this.hostRules.set('cdn.discordapp.com', [
            '162.159.134.233',
            '162.159.129.233'
        ])
        this.hostRules.set('discordapp.com', [
            '162.159.135.232',
            '162.159.128.233'
        ])
        this.hostRules.set('trends.google.com', ['142.250.185.46'])
        this.hostRules.set('wikimedia.org', ['198.35.26.96'])
        this.hostRules.set('www.reddit.com', ['151.101.1.140'])
        this.hostRules.set('raw.githubusercontent.com', ['185.199.108.133'])
    }

    public reportFailure(hostname: string): void {
        const domain = this.findMatchingDomain(hostname);
        if (domain) {
            const currentIndex = this.currentIpIndex.get(domain) || 0;
            const ips = this.hostRules.get(domain) || [];
            const nextIndex = (currentIndex + 1) % ips.length;
            this.currentIpIndex.set(domain, nextIndex);
            console.log(`[HOST-RULES] ${domain} failed, switching to IP ${ips[nextIndex]}`);
        }
    }

    public getCurrentIP(hostname: string): string | undefined {
        const domain = this.findMatchingDomain(hostname);
        if (domain) {
            const ips = this.hostRules.get(domain) || [];
            const currentIndex = this.currentIpIndex.get(domain) || 0;
            return ips[currentIndex];
        }
        return undefined;
    }

    public getHostMapping(hostname: string): string | undefined {
        const ips = this.getCurrentIP(hostname);
        return ips;
    }

    private findMatchingDomain(hostname: string): string | null {
        for (const [domain] of this.hostRules.entries()) {
            if (hostname === domain || hostname.endsWith(`.${domain}`)) {
                return domain;
            }
        }
        return null;
    }

    private isIPv6(host: string): boolean {
        return host.includes(':')
    }

    applyHostRules(url: string): HostRuleResult {
        if (this.hostRules.size === 0) {
            return { url }
        }

        try {
            const urlObj = new URL(url)
            const hostname = urlObj.hostname
            let originalHostname: string | undefined = hostname
            let mappedHost = hostname

            const domain = this.findMatchingDomain(hostname);
            
            if (domain) {
                originalHostname = domain;
                const ips = this.hostRules.get(domain) || [];
                const currentIndex = this.currentIpIndex.get(domain) || 0;
                
                if (ips.length > 0) {
                    const currentIp = ips[currentIndex];
                    if (currentIp) {
                        mappedHost = currentIp;

                        try {
                            if (this.isIPv6(mappedHost)) {
                                urlObj.hostname = `[${mappedHost}]`
                            } else {
                                urlObj.hostname = mappedHost
                            }

                            this.bot.logger.debug(this.bot.isMobile, 'HOST-RULES',
                                `Modified: ${hostname} -> ${mappedHost} (${currentIndex + 1}/${ips.length})`)
                        } catch (error) {
                            this.bot.logger.error(
                                this.bot.isMobile,
                                'HOST-RULES',
                                `Failed to apply host ${mappedHost}: ${error instanceof Error ? error.message : String(error)}`
                            )
                        }
                    }
                }
            }

            const finalUrl = urlObj.toString()
            return { url: finalUrl, originalHostname }
            
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'HOST-RULES',
                `Failed to parse URL ${url}: ${error instanceof Error ? error.message : String(error)}`
            )
            try {
                const hostname = new URL(url).hostname;
                return { url, originalHostname: hostname }
            } catch {
                const match = url.match(/https?:\/\/([^\/]+)/);
                const hostname = match ? match[1] : 'unknown';
                return { url, originalHostname: hostname }
            }
        }
    }

    buildHeaders(baseHeaders: any, urlResult: HostRuleResult, additionalHeaders?: any): any {
        const headers: Record<string, any> = {
            ...baseHeaders,
            ...additionalHeaders
        };

        let hostValue: string | undefined = urlResult.originalHostname;
        
        if (!hostValue) {
            try {
                hostValue = new URL(urlResult.url).hostname;
            } catch {
                const match = urlResult.url.match(/https?:\/\/([^\/]+)/);
                hostValue = match ? match[1] : undefined;
            }
        }

        if (hostValue) {
            headers['Host'] = hostValue;
        }

        return headers;
    }
}