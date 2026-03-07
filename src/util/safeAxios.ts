import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { MicrosoftRewardsBot } from '../index';
import type { BrowserResponse } from './BrowserHTTP';

export async function safeRequest<T = any>(
    bot: MicrosoftRewardsBot,
    url: string,
    config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T> | BrowserResponse<T>> {
    try {
        return await axios(url, config);
    } catch (error: any) {
        const blockedErrors = ['ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EPERM', 'ECONNREFUSED'];

        if (blockedErrors.includes(error.code) && bot.browserHTTP?.isAvailable()) {
            bot.logger.warn(false, 'SAFE-AXIOS', `Axios failed (${error.code}) for ${url} — falling back to browserHTTP`);
            
            // Convert Axios config to BrowserHTTP options (simple mapping)
            const browserOptions = {
                method: config.method || 'GET',
                headers: config.headers,
                body: config.data,
                timeout: config.timeout || 30000
            };

            return await bot.browserHTTP.request<T>(url, browserOptions);
        }

        throw error;
    }
}