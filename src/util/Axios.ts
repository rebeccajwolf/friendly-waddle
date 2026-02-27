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

        this.instance = axios.create({
            timeout: 30000,
            transformRequest: [(data, headers) => {
                if (headers && headers['Host']) {
                    headers['Host'] = headers['Host'];
                }
                return data;
            }]
        });

        // Interceptor to ensure Host header and SNI are set correctly
        this.instance.interceptors.request.use((config) => {
            if (config.headers && config.headers['Host']) {
                const hostHeader = config.headers['Host'] as string;
                
                // Log for debugging
                console.log(`[Axios] Sending request to ${config.url} with Host: ${hostHeader}`);
                
                // CRITICAL: Create HTTPS agent with proper SNI
                config.httpsAgent = new https.Agent({
                    rejectUnauthorized: false,
                    servername: hostHeader,  // Set SNI to match Host header
                    keepAlive: true
                });
            }
            
            return config;
        });

        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account)
            this.instance.defaults.httpsAgent = agent
        }

        axiosRetry(this.instance, {
            retries: 8,
            retryDelay: (retryCount) => {
                return Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
            },
            shouldResetTimeout: true,
            retryCondition: (error) => {
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
        const headers: Record<string, string> = { ...(config.headers as Record<string, string> || {}) };
        const hostHeader = headers['Host'];
        
        const finalConfig: AxiosRequestConfig = {
            ...config,
            headers: headers as AxiosRequestHeaders
        };

        // Set HTTPS agent with proper SNI
        if (hostHeader) {
            finalConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false,
                servername: hostHeader,  // CRITICAL: Set SNI to match Host header
                keepAlive: true
            });
        }

        try {
            if (bypassProxy) {
                const bypassInstance = axios.create({
                    timeout: 30000
                });
                
                axiosRetry(bypassInstance, {
                    retries: 5,
                    retryDelay: axiosRetry.exponentialDelay
                });
                
                return await bypassInstance.request(finalConfig);
            }

            return await this.instance.request(finalConfig);
        } catch (error: any) {
            console.error(`[Axios] Request failed: ${error.message}`);
            throw error;
        }
    }
}

export default AxiosClient