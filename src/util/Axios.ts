import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { Agent } from 'https'
import { URL } from 'url'
import type { AccountProxy } from '../interface/Account'
import { HostRulesManager } from './HostRules'
import type { MicrosoftRewardsBot } from '../index'

// Track failed IPs globally
const failedIPs: Set<string> = new Set();
const failedDomains: Map<string, number> = new Map();

class AxiosClient {
    private account: AccountProxy
    private hostRules?: HostRulesManager
    private bot?: MicrosoftRewardsBot

    constructor(account: AccountProxy, bot?: MicrosoftRewardsBot) {
        this.account = account
        this.bot = bot
        
        if (bot) {
            this.hostRules = new HostRulesManager(bot)
        }
    }

    private createBrowserAgent(host: string) {
        return new Agent({
            family: 4,
            keepAlive: false,
            maxSockets: 1,
            maxFreeSockets: 1,
            scheduling: 'fifo',
            rejectUnauthorized: false,
            servername: host,
            ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
            honorCipherOrder: true,
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.3'
        });
    }

    private getBrowserHeaders(host: string): Record<string, string> {
        return {
            'Host': host,
            'Connection': 'keep-alive',
            'Cache-Control': 'max-age=0',
            'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Microsoft Edge";v="122"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-User': '?1',
            'Sec-Fetch-Dest': 'document',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9'
        };
    }

    private log(message: string, level: 'info' | 'error' | 'debug' = 'info'): void {
        console.log(`[Axios] ${message}`);
    }

    private async makeRequestWithIP(
        config: AxiosRequestConfig,
        host: string,
        ip: string,
        isRetry: boolean = false
    ): Promise<AxiosResponse> {
        try {
            const urlObj = new URL(config.url!);
            urlObj.hostname = ip;
            
            const browserHeaders = this.getBrowserHeaders(host);
            const finalHeaders = {
                ...browserHeaders,
                ...config.headers,
                'Host': host
            };

            const requestConfig: AxiosRequestConfig = {
                ...config,
                url: urlObj.toString(),
                headers: finalHeaders,
                httpsAgent: this.createBrowserAgent(host),
                timeout: 15000,
                maxRedirects: 5,
                decompress: true,
                validateStatus: (status) => status < 500
            };

            // Handle proxy if configured
            if (this.account.url && this.account.proxyAxios && !isRetry) {
                this.log(`Proxy configured: ${this.account.url}`);
                // Proxy implementation would go here
                // For now, just log that proxy is configured
            }

            const response = await axios(requestConfig);
            return response;
        } catch (error) {
            throw error;
        }
    }

    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        const host = config.headers?.['Host'] as string;
        
        if (!host) {
            return axios(config);
        }

        let currentIp: string | undefined;
        
        if (this.hostRules) {
            currentIp = this.hostRules.getCurrentIP(host);
            if (!currentIp) {
                this.log(`No IP found for ${host}, trying direct connection`);
                return axios(config);
            }
        } else {
            return axios(config);
        }

        try {
            this.log(`Using IP ${currentIp} for ${host}`);
            const response = await this.makeRequestWithIP(config, host, currentIp);
            this.log(`✅ Success for ${host}`);
            
            if (failedDomains.has(host)) {
                failedDomains.delete(host);
            }
            
            return response;
            
        } catch (error: any) {
            this.log(`❌ Failed for ${host} with IP ${currentIp}: ${error.message}`, 'error');
            
            failedIPs.add(currentIp!);
            
            const failCount = failedDomains.get(host) || 0;
            failedDomains.set(host, failCount + 1);
            this.log(`📊 ${host} has failed ${failCount + 1} times`);
            
            if (this.hostRules) {
                this.hostRules.reportFailure(host);
                
                const newIp = this.hostRules.getCurrentIP(host);
                if (newIp && newIp !== currentIp) {
                    this.log(`🔄 Retrying with IP ${newIp}`);
                    
                    try {
                        const retryResponse = await this.makeRequestWithIP(config, host, newIp, true);
                        this.log(`✅ Success for ${host} with IP ${newIp}`);
                        return retryResponse;
                    } catch (retryError: any) {
                        this.log(`❌ Retry failed with IP ${newIp}: ${retryError.message}`, 'error');
                        failedIPs.add(newIp);
                    }
                }
            }
            
            // Use bot logger if available for error tracking
            if (this.bot) {
                this.bot.logger.error(this.bot.isMobile, 'AXIOS-ERROR', 
                    `Request failed for ${host}: ${error.message}`);
            }
            
            throw error;
        }
    }

    public getCurrentIP(hostname: string): string | undefined {
        return this.hostRules?.getCurrentIP(hostname);
    }
    
    public switchIP(hostname: string): void {
        if (this.hostRules) {
            this.hostRules.reportFailure(hostname);
            this.log(`🔄 Manually switching IP for ${hostname}`);
        }
    }
    
    public getAccountProxy(): AccountProxy {
        return this.account;
    }
    
    public getBot(): MicrosoftRewardsBot | undefined {
        return this.bot;
    }
    
    public getFailedIPs(): Set<string> {
        return failedIPs;
    }
    
    public getFailCount(hostname: string): number {
        return failedDomains.get(hostname) || 0;
    }
}

export default AxiosClient;