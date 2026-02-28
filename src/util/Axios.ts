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
    private bot?: MicrosoftRewardsBot  // Keep for future use

    constructor(account: AccountProxy, bot?: MicrosoftRewardsBot) {
        this.account = account
        this.bot = bot  // Store for future use (logging, etc.)
        
        if (bot) {
            this.hostRules = new HostRulesManager(bot)
        }
    }

    // Create a brand new agent for EACH request (like browser)
    private createFreshAgent(host: string) {
        return new Agent({
            family: 4,                    // Force IPv4 only
            keepAlive: false,              // CRITICAL: Don't reuse connections
            maxSockets: 1,                  // Only one socket at a time
            maxFreeSockets: 1,
            scheduling: 'fifo',
            rejectUnauthorized: false,
            servername: host                // Set SNI
        });
    }

    // Log using bot's logger if available
    private log(message: string, level: 'info' | 'error' | 'debug' = 'info'): void {
        if (this.bot) {
            // Use bot's logger if needed
            if (level === 'error') {
                console.error(`[Axios] ${message}`);
            } else {
                console.log(`[Axios] ${message}`);
            }
        } else {
            console.log(`[Axios] ${message}`);
        }
    }

    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        const host = config.headers?.['Host'] as string;
        
        // Get current IP from HostRulesManager
        let targetUrl = config.url;
        let currentIp: string | undefined;
        
        if (host && this.hostRules) {
            currentIp = this.hostRules.getCurrentIP(host);
            if (currentIp) {
                // Replace domain with IP in URL
                try {
                    const urlObj = new URL(config.url!);
                    urlObj.hostname = currentIp;
                    targetUrl = urlObj.toString();
                    this.log(`Using IP ${currentIp} for ${host}`);
                } catch (e) {
                    this.log(`Failed to parse URL: ${config.url}`, 'error');
                }
            }
        }

        // Check if this IP has failed before
        if (currentIp && failedIPs.has(currentIp)) {
            this.log(`⚠️ IP ${currentIp} has failed before, may need rotation`);
        }

        // Handle proxy if needed
        if (this.account.url && this.account.proxyAxios && !bypassProxy) {
            this.log(`Proxy configured: ${this.account.url}`);
            // Proxy implementation would go here
        }

        // CRITICAL: Create fresh axios instance for each request
        const freshInstance = axios.create({
            timeout: 10000,  // Shorter timeout to fail faster
            httpsAgent: this.createFreshAgent(host),
            maxRedirects: 0,
            validateStatus: (status) => status < 500
        });

        try {
            const response = await freshInstance.request({
                ...config,
                url: targetUrl,
                headers: {
                    ...config.headers,
                    'Host': host,  // Ensure Host header is set
                    'Connection': 'close'  // Force connection close
                }
            });
            
            this.log(`✅ Success for ${host}`);
            
            // Reset failure count on success
            if (host && failedDomains.has(host)) {
                failedDomains.delete(host);
            }
            
            return response;
            
        } catch (error: any) {
            this.log(`❌ Failed for ${host}: ${error.message}`, 'error');
            
            // Track failed IP
            if (currentIp && currentIp !== 'unknown') {
                failedIPs.add(currentIp);
            }
            
            // Track failed domain
            if (host) {
                const failCount = failedDomains.get(host) || 0;
                failedDomains.set(host, failCount + 1);
                this.log(`📊 ${host} has failed ${failCount + 1} times`);
            }
            
            // Report failure to rotate IP
            if (host && this.hostRules) {
                this.hostRules.reportFailure(host);
                
                // Get new IP and retry ONCE
                const newIp = this.hostRules.getCurrentIP(host);
                if (newIp && newIp !== currentIp) {
                    this.log(`🔄 Retrying with IP ${newIp}`);
                    try {
                        const urlObj = new URL(config.url!);
                        urlObj.hostname = newIp;
                        
                        const retryInstance = axios.create({
                            timeout: 10000,
                            httpsAgent: this.createFreshAgent(host),
                            maxRedirects: 0,
                            validateStatus: (status) => status < 500
                        });
                        
                        const retryResponse = await retryInstance.request({
                            ...config,
                            url: urlObj.toString(),
                            headers: {
                                ...config.headers,
                                'Host': host,
                                'Connection': 'close'
                            }
                        });
                        
                        this.log(`✅ Success for ${host} with IP ${newIp}`);
                        return retryResponse;
                    } catch (retryError: any) {
                        this.log(`❌ Retry failed: ${retryError.message}`, 'error');
                        // Track the new IP as failed
                        failedIPs.add(newIp);
                    }
                }
            }
            throw error;
        }
    }

    // Helper methods for external use
    public getCurrentIP(hostname: string): string | undefined {
        return this.hostRules?.getCurrentIP(hostname);
    }
    
    public switchIP(hostname: string): void {
        if (this.hostRules) {
            this.hostRules.reportFailure(hostname);
            this.log(`🔄 Manually switching IP for ${hostname}`);
        }
    }
    
    public getFailedIPs(): Set<string> {
        return failedIPs;
    }
    
    public getFailCount(hostname: string): number {
        return failedDomains.get(hostname) || 0;
    }
    
    // Get bot instance for external use
    public getBot(): MicrosoftRewardsBot | undefined {
        return this.bot;
    }
}

export default AxiosClient;