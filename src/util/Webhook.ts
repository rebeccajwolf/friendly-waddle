import axios from 'axios'
import { URL } from 'url'


import { Config } from '../interface/Config'

// DNS bypass for Discord webhooks using axios
async function createDiscordRequestWithAxios(webhookUrl: string, data: any) {
    const urlObj = new URL(webhookUrl)
    
    // Use environment variable or fallback IPs for Discord
    const discordIP = process.env.DISCORD_API_IP || '162.159.128.233'
    
    // Create URL with IP instead of hostname
    const bypassUrl = `https://${discordIP}${urlObj.pathname}${urlObj.search}`
    
    const request = {
        method: 'POST',
        url: bypassUrl,
        headers: {
            'Host': urlObj.hostname,
            'Content-Type': 'application/json'
        },
        data: data,
        timeout: 10000,
        validateStatus: (status: number) => status >= 200 && status < 300
    }
    
    return await axios(request)
}

export async function Webhook(configData: Config, content: string) {
    const webhook = configData.webhook

    if (!webhook.enabled || webhook.url.length < 10) return

    const data = {
        'content': content
    }

    // Check if this is a Discord webhook and use DNS bypass
    if (webhook.url.includes('discord.com/api/webhooks/')) {
        try {
            await createDiscordRequestWithAxios(webhook.url, data)
        } catch (error) {
            // Fallback to axios if DNS bypass fails
            const request = {
                method: 'POST',
                url: webhook.url,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: data
            }
            await axios(request).catch(() => { })
        }
    } else {
        // Use original axios method for non-Discord webhooks
        const request = {
            method: 'POST',
            url: webhook.url,
            headers: {
                'Content-Type': 'application/json'
            },
            data: data
        }
        await axios(request).catch(() => { })
    }
}