import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import https from 'https'
import { URL } from 'url'
import type { AccountProxy } from '../interface/Account'

// Track failed IPs globally
const failedIPs: Set<string> = new Set();
const failedDomains: Map<string, number> = new Map();

class AxiosClient {
    private instance: AxiosInstance
    private account: AccountProxy

    constructor(account: AccountProxy) {
        this.account = account

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
                    console.log(`[Axios] ⚠️ This IP ${ip} has failed before, consider updating cache`);
                }
            }
            return config;
        });

        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account)
            this.instance.defaults.httpsAgent = agent
        }

        axiosRetry(this.instance, {
            retries: 3, // Reduced from 8 to fail faster
            retryDelay: (retryCount) => {
                return 2000 * retryCount; // Simple backoff: 2s, 4s, 6s
            },
            shouldResetTimeout: true,
            retryCondition: (error) => {
                // Extract host and IP for tracking
                const host = error?.config?.headers?.['Host'];
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
                    }
                    
                    return true; // Retry
                }
                
                if (axiosRetry.isNetworkError(error)) {
                    console.log(`[Axios] 🌐 Network error for ${host}: ${error.message}`);
                    return true;
                }
                
                if (!error.response) {
                    console.log(`[Axios] ❌ No response for ${host}`);
                    return true;
                }
                
                const status = error.response.status;
                return status === 429 || (status >= 500 && status <= 599);
            }
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
}

export default AxiosClient;