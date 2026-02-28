import type { MicrosoftRewardsBot } from '../index'



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