import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { Agent } from 'https'
import { URL } from 'url'
import type { AccountProxy } from '../interface/Account'
import { HostRulesManager } from './HostRules'
import type { MicrosoftRewardsBot } from '../index'

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
        if (host && this.hostRules) {
            const ip = this.hostRules.getCurrentIP(host);
            if (ip) {
                // Replace domain with IP in URL
                const urlObj = new URL(config.url!);
                urlObj.hostname = ip;
                targetUrl = urlObj.toString();
                console.log(`[Axios] Using IP ${ip} for ${host}`);
            }
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
            
            console.log(`[Axios] ✅ Success for ${host}`);
            return response;
            
        } catch (error: any) {
            console.log(`[Axios] ❌ Failed for ${host}: ${error.message}`);
            
            // Report failure to rotate IP
            if (host && this.hostRules) {
                this.hostRules.reportFailure(host);
                
                // Get new IP and retry ONCE
                const newIp = this.hostRules.getCurrentIP(host);
                if (newIp) {
                    console.log(`[Axios] 🔄 Retrying with IP ${newIp}`);
                    const urlObj = new URL(config.url!);
                    urlObj.hostname = newIp;
                    
                    const retryInstance = axios.create({
                        timeout: 10000,
                        httpsAgent: this.createFreshAgent(host),
                        maxRedirects: 0
                    });
                    
                    return await retryInstance.request({
                        ...config,
                        url: urlObj.toString(),
                        headers: {
                            ...config.headers,
                            'Host': host,
                            'Connection': 'close'
                        }
                    });
                }
            }
            throw error;
        }
    }
}

export default AxiosClient;