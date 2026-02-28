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
                    console.log(`[Axios] Using IP ${currentIp} for ${host}`);
                } catch (e) {
                    console.log(`[Axios] Failed to parse URL: ${config.url}`);
                }
            }
        }

        // Check if this IP has failed before
        if (currentIp && failedIPs.has(currentIp)) {
            console.log(`[Axios] ⚠️ IP ${currentIp} has failed before, may need rotation`);
        }

        // CRITICAL: Create fresh axios instance for each request
        const freshInstance = axios.create({
            timeout: 10000,  // Shorter timeout to fail faster
            httpsAgent: this.createFreshAgent(host),
            maxRedirects: 0,
            validateStatus: (status) => status < 500
        });

        // Handle proxy if needed
        if (this.account.url && this.account.proxyAxios && !bypassProxy) {
            // Proxy handling would go here
            console.log(`[Axios] Using proxy: ${this.account.url}`);
        }

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
            
            console.log(`[Axios] ✅ Success for ${host}`);
            
            // Reset failure count on success
            if (host && failedDomains.has(host)) {
                failedDomains.delete(host);
            }
            
            return response;
            
        } catch (error: any) {
            console.log(`[Axios] ❌ Failed for ${host}: ${error.message}`);
            
            // Track failed IP
            if (currentIp && currentIp !== 'unknown') {
                failedIPs.add(currentIp);
            }
            
            // Track failed domain
            if (host) {
                const failCount = failedDomains.get(host) || 0;
                failedDomains.set(host, failCount + 1);
                console.log(`[Axios] 📊 ${host} has failed ${failCount + 1} times`);
            }
            
            // Report failure to rotate IP
            if (host && this.hostRules) {
                this.hostRules.reportFailure(host);
                
                // Get new IP and retry ONCE
                const newIp = this.hostRules.getCurrentIP(host);
                if (newIp && newIp !== currentIp) {
                    console.log(`[Axios] 🔄 Retrying with IP ${newIp}`);
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
                        
                        console.log(`[Axios] ✅ Success for ${host} with IP ${newIp}`);
                        return retryResponse;
                    } catch (retryError: any) {
                        console.log(`[Axios] ❌ Retry failed: ${retryError.message}`);
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
            console.log(`[Axios] 🔄 Manually switching IP for ${hostname}`);
        }
    }
    
    public getFailedIPs(): Set<string> {
        return failedIPs;
    }
    
    public getFailCount(hostname: string): number {
        return failedDomains.get(hostname) || 0;
    }
}

export default AxiosClient;