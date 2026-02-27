import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosRequestHeaders } from 'axios'
import axiosRetry from 'axios-retry'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import https from 'https'
import { URL } from 'url'
import type { AccountProxy } from '../interface/Account'

class AxiosClient {
    private instance: AxiosInstance
    private account: AccountProxy

    constructor(account: AccountProxy) {
        this.account = account

        // Create HTTPS agent that ignores certificate errors
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false,  // CRITICAL: Ignore SSL certificate mismatches
            keepAlive: true
        });

        this.instance = axios.create({
            timeout: 30000,
            httpsAgent: httpsAgent,
            transformRequest: [(data, headers) => {
                // CRITICAL: Preserve Host header if it exists
                if (headers && headers['Host']) {
                    // Store it in a way that survives
                    headers['Host'] = headers['Host'];
                }
                return data;
            }]
        });

        // Interceptor to ensure Host header is never dropped
        this.instance.interceptors.request.use((config) => {
            // If there's a Host header in the original request, make sure it's in the final config
            if (config.headers && config.headers['Host']) {
                // Force it to stay
                config.headers['Host'] = config.headers['Host'];
                
                // Log for debugging
                console.log(`[Axios] Sending request to ${config.url} with Host: ${config.headers['Host']}`);
            }
            
            // If using proxy, ensure Host header is preserved
            if (this.account.url && this.account.proxyAxios) {
                // Some proxies strip headers, so we need to be extra careful
                if (config.headers && config.headers['Host']) {
                    // Store in a custom header that proxies won't touch
                    config.headers['X-Original-Host'] = config.headers['Host'];
                }
            }

            // Ensure httpsAgent has rejectUnauthorized: false
            if (!config.httpsAgent) {
                config.httpsAgent = new https.Agent({
                    rejectUnauthorized: false
                });
            }
            
            return config;
        });

        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account)
            this.instance.defaults.httpsAgent = agent
            // Don't set httpAgent for HTTPS requests
        }

        axiosRetry(this.instance, {
            retries: 8,
            retryDelay: (retryCount) => {
                return Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
            },
            shouldResetTimeout: true,
            retryCondition: (error) => {
                // Retry on timeouts and network errors
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                    console.log(`[Axios] Timeout detected, retrying...`);
                    return true;
                }
                if (axiosRetry.isNetworkError(error)) return true;
                if (!error.response) return true;

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
        // Make a copy of headers to prevent modification
        const headers: Record<string, string> = { ...(config.headers as Record<string, string> || {}) };
        const hostHeader = headers['Host'];
        
        // Create a new config with preserved headers
        const finalConfig: AxiosRequestConfig = {
            ...config,
            headers: headers as AxiosRequestHeaders
        };

        // Ensure httpsAgent ignores certificate errors
        if (!finalConfig.httpsAgent) {
            finalConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
        }

        // CRITICAL: If using proxy, we need to be extra careful with headers
        if (this.account.url && this.account.proxyAxios && !bypassProxy) {
            // Some proxies require the Host header to be the original domain
            if (hostHeader) {
                finalConfig.headers = finalConfig.headers || {} as AxiosRequestHeaders;
                (finalConfig.headers as Record<string, string>)['Host'] = hostHeader;
            }
        }

        try {
            if (bypassProxy) {
                const bypassInstance = axios.create({
                    timeout: 30000,
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false
                    }),
                    transformRequest: [(data, headers) => {
                        if (headers && hostHeader) {
                            (headers as Record<string, string>)['Host'] = hostHeader;
                        }
                        return data;
                    }]
                });
                
                axiosRetry(bypassInstance, {
                    retries: 5,
                    retryDelay: axiosRetry.exponentialDelay
                });
                
                return await bypassInstance.request(finalConfig);
            }

            return await this.instance.request(finalConfig);
        } catch (error: any) {
            // Log but don't modify error
            console.error(`[Axios] Request failed: ${error.message}`);
            throw error;
        }
    }
}

export default AxiosClient