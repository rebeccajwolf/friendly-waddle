import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import https from 'https'
import { URL } from 'url'
import type { AccountProxy } from '../interface/account'
import { HostRulesManager } from './HostRules'
import type { MicrosoftRewardsBot } from '../index'

// Track failed IPs globally
const failedIPs: Set<string> = new Set();
const failedDomains: Map<string, number> = new Map();

class AxiosClient {
    private instance: AxiosInstance
    private account: AccountProxy
    private bot?: MicrosoftRewardsBot
    private hostRules?: HostRulesManager

    constructor(account: AccountProxy, bot?: MicrosoftRewardsBot) {
        this.account = account
        this.bot = bot
        
        if (bot) {
            this.hostRules = new HostRulesManager(bot)
        }

        this.instance = axios.create({
            timeout: 30000,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
                keepAlive: true
            })
        });

        // Interceptor to ensure Host header and logging
        this.instance.interceptors.request.use((config) => {
            if (config.headers && config.headers['Host']) {
                const hostHeader = config.headers['Host'] as string;
                const url = config.url || '';
                const ipMatch = url.match(/\d+\.\d+\.\d+\.\d+/);
                const ip = ipMatch ? ipMatch[0] : 'unknown';
                
                console.log(`[Axios] 📤 Request to ${hostHeader} (${ip})`);
                
                // Check if this IP has failed before
                if (failedIPs.has(ip)) {
                    console.log(`[Axios] ⚠️ This IP ${ip} has failed before, trying next IP...`);
                }
            }
            return config;
        });

        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account)
            this.instance.defaults.httpsAgent = agent
        }

        axiosRetry(this.instance, {
            retries: 5, // Increased to allow more IP switches
            retryDelay: (retryCount) => {
                return 2000 * retryCount; // Simple backoff: 2s, 4s, 6s, 8s, 10s
            },
            shouldResetTimeout: true,
            retryCondition: (error) => {
                // Extract host and IP for tracking
                const host = error?.config?.headers?.['Host'] as string | undefined;
                const url = error?.config?.url || '';
                const ipMatch = url.match(/\d+\.\d+\.\d+\.\d+/);
                const ip = ipMatch ? ipMatch[0] : 'unknown';
                
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                    console.log(`[Axios] ⏱️ Timeout for ${host} at IP ${ip}`);
                    
                    // Track failed IP
                    if (ip !== 'unknown') {
                        failedIPs.add(ip);
                    }
                    
                    // Track failed domain
                    if (host) {
                        const failCount = failedDomains.get(host) || 0;
                        failedDomains.set(host, failCount + 1);
                        console.log(`[Axios] 📊 ${host} has failed ${failCount + 1} times`);
                        
                        // Report failure to HostRulesManager to switch IP
                        if (this.hostRules) {
                            this.hostRules.reportFailure(host);
                            console.log(`[Axios] 🔄 Switching to next IP for ${host}`);
                        }
                    }
                    
                    return true; // Retry with new IP
                }
                
                if (axiosRetry.isNetworkError(error)) {
                    console.log(`[Axios] 🌐 Network error for ${host}: ${error.message}`);
                    
                    // Also report network errors to switch IP
                    if (host && this.hostRules) {
                        this.hostRules.reportFailure(host);
                    }
                    return true;
                }
                
                if (!error.response) {
                    console.log(`[Axios] ❌ No response for ${host}`);
                    
                    // Report no response to switch IP
                    if (host && this.hostRules) {
                        this.hostRules.reportFailure(host);
                    }
                    return true;
                }
                
                const status = error.response.status;
                return status === 429 || (status >= 500 && status <= 599);
            }
        });
        
        // Add response interceptor to track successful IPs
        this.instance.interceptors.response.use((response) => {
            const host = response?.config?.headers?.['Host'] as string | undefined;
            const url = response?.config?.url || '';
            const ipMatch = url.match(/\d+\.\d+\.\d+\.\d+/);
            const ip = ipMatch ? ipMatch[0] : 'unknown';
            
            if (host && ip !== 'unknown') {
                console.log(`[Axios] ✅ Success for ${host} using IP ${ip}`);
                
                // Reset failure count on success
                if (failedDomains.has(host)) {
                    failedDomains.delete(host);
                }
            }
            
            return response;
        });
    }

    private getAgentForProxy(
        proxyConfig: AccountProxy
    ): HttpProxyAgent<string> | HttpsProxyAgent<string> | SocksProxyAgent {
        const { url: baseUrl, port, username, password } = proxyConfig

        let urlObj: URL
        try {
            urlObj = new URL(baseUrl)
        } catch (e) {
            try {
                urlObj = new URL(`http://${baseUrl}`)
            } catch (error) {
                throw new Error(`Invalid proxy URL format: ${baseUrl}`)
            }
        }

        const protocol = urlObj.protocol.toLowerCase()
        let proxyUrl: string

        if (username && password) {
            urlObj.username = encodeURIComponent(username)
            urlObj.password = encodeURIComponent(password)
            urlObj.port = port.toString()
            proxyUrl = urlObj.toString()
        } else {
            proxyUrl = `${protocol}//${urlObj.hostname}:${port}`
        }

        switch (protocol) {
            case 'http:':
                return new HttpProxyAgent(proxyUrl)
            case 'https:':
                return new HttpsProxyAgent(proxyUrl)
            case 'socks4:':
            case 'socks5:':
                return new SocksProxyAgent(proxyUrl)
            default:
                throw new Error(`Unsupported proxy protocol: ${protocol}. Only HTTP(S) and SOCKS4/5 are supported!`)
        }
    }

    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        try {
            if (bypassProxy) {
                const bypassInstance = axios.create({
                    timeout: 30000,
                    httpsAgent: new https.Agent({ rejectUnauthorized: false })
                });
                return await bypassInstance.request(config);
            }
            return await this.instance.request(config);
        } catch (error: any) {
            console.error(`[Axios] ❌ Request failed: ${error.message}`);
            throw error;
        }
    }
    
    // Helper method to get current IP for a domain
    public getCurrentIP(hostname: string): string | undefined {
        return this.hostRules?.getCurrentIP(hostname);
    }
    
    // Helper method to manually switch IP for a domain
    public switchIP(hostname: string): void {
        if (this.hostRules) {
            this.hostRules.reportFailure(hostname);
            console.log(`[Axios] 🔄 Manually switching IP for ${hostname}`);
        }
    }
}

export default AxiosClient;