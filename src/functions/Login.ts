import { Page } from 'rebrowser-playwright'
import readline from 'readline'
import * as crypto from 'crypto'
import { AxiosRequestConfig } from 'axios'

import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'

import { OAuth } from '../interface/OAuth'


const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

export class Login {
    private bot: MicrosoftRewardsBot
    private clientId: string = '0000000040170455'
    private authBaseUrl: string = 'https://login.live.com/oauth20_authorize.srf'
    private redirectUrl: string = 'https://login.live.com/oauth20_desktop.srf'
    private tokenUrl: string = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
    private scope: string = 'service::prod.rewardsplatform.microsoft.com::MBI_SSL'
    private maxAuthRetries: number = 7 // Added for auth retries
    private maxLoginRetries: number = 27 // Added for login retries

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async login(page: Page, email: string, password: string) {

        try {
            // Navigate to the Bing login page
            await page.goto('http://rewards.bing.com/signin')

            await this.bot.browser.utils.takeScreenshot(page, 'main-login-page')

            await page.waitForLoadState('domcontentloaded').catch(() => { })

            await this.bot.browser.utils.reloadBadPage(page)

            // await this.bot.browser.utils.takeScreenshot(page, 'main-login-page')

            // Check if account is locked
            await this.checkAccountLocked(page)

            const isLoggedIn = await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 10000 }).then(() => true).catch(() => false)

            if (!isLoggedIn) {
                await this.execLogin(page, email, password)
                this.bot.log(this.bot.isMobile, 'LOGIN', 'Logged into Microsoft successfully')
            } else {
                this.bot.log(this.bot.isMobile, 'LOGIN', 'Already logged in')

                // Check if account is locked
                await this.checkAccountLocked(page)
            }

            // Check if logged in to bing
            await this.checkBingLogin(page)

            // Save session
            await saveSessionData(this.bot.config.sessionPath, page.context(), email, this.bot.isMobile)

            // We're done logging in
            this.bot.log(this.bot.isMobile, 'LOGIN', 'Logged in successfully, saved login session!')

        } catch (error) {
            // Throw and don't continue
            throw this.bot.log(this.bot.isMobile, 'LOGIN', 'An error occurred:' + error, 'error')
        }
    }

    private async execLogin(page: Page, email: string, password: string) {
        let retryCount = 0;
        
        while (retryCount < this.maxLoginRetries) {
            try {
                // Start fresh by going to the signin page
                await page.goto('http://rewards.bing.com/signin')
                
                // Wait for page load and network idle
                await Promise.all([
                    page.waitForLoadState('domcontentloaded'),
                    page.waitForLoadState('networkidle')
                ])
                
                await this.bot.utils.wait(3000)

                // Try to enter email
                let emailSuccess = false;
                try {
                    // Wait for email field to be ready
                    await page.waitForSelector('#i0116', { state: 'visible', timeout: 10000 })
                    
                    // Verify element is interactive
                    const emailReady = await page.evaluate(() => {
                        const element = document.querySelector('#i0116')
                        if (!element) return false
                        const style = window.getComputedStyle(element)
                        return style.display !== 'none' && 
                               style.visibility !== 'hidden' && 
                               style.opacity !== '0'
                    })

                    if (!emailReady) {
                        throw this.bot.log(this.bot.isMobile, 'Email field not interactive', 'error')
                    }

                    await page.fill('#i0116', email)
                    await page.click('#idSIButton9')
                    
                    // Wait for either password field or 2FA display
                    await Promise.race([
                        page.waitForSelector('#i0118', { state: 'visible', timeout: 10000 }),
                        page.waitForSelector('#displaySign', { state: 'visible', timeout: 10000 })
                    ])
                    
                    emailSuccess = true;
                    this.bot.log(this.bot.isMobile, 'LOGIN', 'Email entered successfully')
                } catch (error: any) {
                    this.bot.log(this.bot.isMobile, 'LOGIN', `Email entry failed, attempt ${retryCount + 1}/${this.maxLoginRetries}`, 'warn')
                    retryCount++;
                    if (retryCount >= this.maxLoginRetries) {
                        throw this.bot.log(this.bot.isMobile, `Email entry failed after ${this.maxLoginRetries} attempts`, 'error');
                    }
                    continue;
                }

                if (emailSuccess) {
            await this.bot.browser.utils.reloadBadPage(page)
                    
                    // Try to enter password
                    try {
                        const has2FA = await page.waitForSelector('#displaySign', { timeout: 2000 }).then(() => true).catch(() => false)
                        
                        if (!has2FA) {
                            // Wait for password field to be ready
                            await page.waitForSelector('#i0118', { state: 'visible', timeout: 10000 })
                            
                            // Verify element is interactive
                            const passwordReady = await page.evaluate(() => {
                                const element = document.querySelector('#i0118')
                                if (!element) return false
                                const style = window.getComputedStyle(element)
                                return style.display !== 'none' && 
                                       style.visibility !== 'hidden' && 
                                       style.opacity !== '0'
                            })

                            if (!passwordReady) {
                                throw this.bot.log(this.bot.isMobile, 'Password field not interactive', 'error')
                            }

                            await this.bot.utils.wait(2000)
                            await page.fill('#i0118', password)
                            await this.bot.utils.wait(2000)
                            await page.click('#idSIButton9')
                            await this.bot.utils.wait(2000)
                            this.bot.log(this.bot.isMobile, 'LOGIN', 'Password entered successfully')
                        } else {
                            await this.handle2FA(page)
                        }
                    } catch (error: any) {
                        this.bot.log(this.bot.isMobile, 'LOGIN', `Password entry failed, attempt ${retryCount + 1}/${this.maxLoginRetries}`, 'warn')
                        retryCount++;
                        if (retryCount >= this.maxLoginRetries) {
                            throw this.bot.log(this.bot.isMobile, `Password entry failed after ${this.maxLoginRetries} attempts`, 'error');
                        }
                        continue;
                    }
                }

            // Check if account is locked
            await this.checkAccountLocked(page)
            await this.bot.browser.utils.reloadBadPage(page)
            await this.checkLoggedIn(page) 
                // If we reach here, login was successful
                return;

            } catch (error: any) {
                retryCount++;
                if (retryCount >= this.maxLoginRetries) {
                    throw this.bot.log(this.bot.isMobile, `Login failed after ${this.maxLoginRetries} attempts: ${error.message}`, 'error');
                }
                this.bot.log(this.bot.isMobile, 'LOGIN', `Login attempt ${retryCount}/${this.maxLoginRetries} failed, retrying...`, 'warn')
                await this.bot.utils.wait(3000)
            }
        }
    }

    private async handle2FA(page: Page) {
        try {
            const numberToPress = await this.get2FACode(page)
            if (numberToPress) {
                // Authentictor App verification
                await this.authAppVerification(page, numberToPress)
            } else {
                // SMS verification
                await this.authSMSVerification(page)
            }
        } catch (error) {
            this.bot.log(this.bot.isMobile, 'LOGIN', `2FA handling failed: ${error}`)
        }
    }

    private async get2FACode(page: Page): Promise<string | null> {
        try {
            const element = await page.waitForSelector('#displaySign', { state: 'visible', timeout: 2000 })
            return await element.textContent()
        } catch {
            if (this.bot.config.parallel) {
                this.bot.log(this.bot.isMobile, 'LOGIN', 'Script running in parallel, can only send 1 2FA request per account at a time!', 'log', 'yellow')
                this.bot.log(this.bot.isMobile, 'LOGIN', 'Trying again in 60 seconds! Please wait...', 'log', 'yellow')

                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const button = await page.waitForSelector('button[aria-describedby="pushNotificationsTitle errorDescription"]', { state: 'visible', timeout: 2000 }).catch(() => null)
                    if (button) {
                        await this.bot.utils.wait(60000)
                        await button.click()

                        continue
                    } else {
                        break
                    }
                }
            }

            await page.click('button[aria-describedby="confirmSendTitle"]').catch(() => { })
            await this.bot.utils.wait(2000)
            const element = await page.waitForSelector('#displaySign', { state: 'visible', timeout: 2000 })
            return await element.textContent()
        }
    }

    private async authAppVerification(page: Page, numberToPress: string | null) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                this.bot.log(this.bot.isMobile, 'LOGIN', `Press the number ${numberToPress} on your Authenticator app to approve the login`)
                this.bot.log(this.bot.isMobile, 'LOGIN', 'If you press the wrong number or the "DENY" button, try again in 60 seconds')

                await page.waitForSelector('#i0281', { state: 'detached', timeout: 60000 })

                this.bot.log(this.bot.isMobile, 'LOGIN', 'Login successfully approved!')
                break
            } catch {
                this.bot.log(this.bot.isMobile, 'LOGIN', 'The code is expired. Trying to get a new code...')
                await page.click('button[aria-describedby="pushNotificationsTitle errorDescription"]')
                numberToPress = await this.get2FACode(page)
            }
        }
    }

    private async authSMSVerification(page: Page) {
        this.bot.log(this.bot.isMobile, 'LOGIN', 'SMS 2FA code required. Waiting for user input...')

        const code = await new Promise<string>((resolve) => {
            rl.question('Enter 2FA code:\n', (input) => {
                rl.close()
                resolve(input)
            })
        })

        await page.fill('input[name="otc"]', code)
        await page.keyboard.press('Enter')
        this.bot.log(this.bot.isMobile, 'LOGIN', '2FA code entered successfully')
    }

    private async checkLoggedIn(page: Page) {
        const targetHostname = 'rewards.bing.com'
        const targetPathname = '/'

        // eslint-disable-next-line no-constant-condition
        while (true) {
            await this.bot.browser.utils.tryDismissAllMessages(page)
            const currentURL = new URL(page.url())
            if (currentURL.hostname === targetHostname && currentURL.pathname === targetPathname) {
                break
            }
            await page.reload()
            await this.bot.utils.wait(10000)
        }

        // Wait for login to complete
        await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 10000 })
        this.bot.log(this.bot.isMobile, 'LOGIN', 'Successfully logged into the rewards portal')
    }

    private async checkBingLogin(page: Page): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, 'LOGIN-BING', 'Verifying Bing login')
            await page.goto('https://www.bing.com/fd/auth/signin?action=interactive&provider=windows_live_id&return_url=https%3A%2F%2Fwww.bing.com%2F')

            const maxIterations = 5

            for (let iteration = 1; iteration <= maxIterations; iteration++) {
                const currentUrl = new URL(page.url())

                if (currentUrl.hostname === 'www.bing.com' && currentUrl.pathname === '/') {
                    await this.bot.browser.utils.tryDismissAllMessages(page)

                    const loggedIn = await this.checkBingLoginStatus(page)
                    // If mobile browser, skip this step
                    if (loggedIn || this.bot.isMobile) {
                        this.bot.log(this.bot.isMobile, 'LOGIN-BING', 'Bing login verification passed!')
                        break
                    }
                }

                await this.bot.utils.wait(1000)
            }

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'LOGIN-BING', 'An error occurred:' + error, 'error')
        }
    }

    private async checkBingLoginStatus(page: Page): Promise<boolean> {
        try {
            await page.waitForSelector('#id_n', { timeout: 5000 })
            return true
        } catch (error) {
            return false
        }
    }

    async getMobileAccessToken(page: Page, email: string) {
        const authorizeUrl = new URL(this.authBaseUrl)

        authorizeUrl.searchParams.append('response_type', 'code')
        authorizeUrl.searchParams.append('client_id', this.clientId)
        authorizeUrl.searchParams.append('redirect_uri', this.redirectUrl)
        authorizeUrl.searchParams.append('scope', this.scope)
        authorizeUrl.searchParams.append('state', crypto.randomBytes(16).toString('hex'))
        authorizeUrl.searchParams.append('access_type', 'offline_access')
        authorizeUrl.searchParams.append('login_hint', email)

        let retryCount = 0
        let code: string | null = null
        const maxWaitTime = 180000 // 3 minutes
        const retryDelay = 7000 // 7 seconds

        while (retryCount < this.maxAuthRetries) {
            try {
                // Navigate to the authorization URL
                await page.goto(authorizeUrl.href, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                }).catch(async () => {
                    this.bot.log(this.bot.isMobile, 'LOGIN-APP', 'Page load timeout, retrying...', 'warn')
                    await page.reload({ timeout: 30000 }).catch(() => {
                        /* ignore reload errors */
                    })
                })

                // Wait for page load
                await this.bot.utils.wait(3000)

                // Check if page is stuck loading
                const isLoading = await page.evaluate(() => document.readyState !== 'complete')
                if (isLoading) {
                    await page.evaluate(() => window.stop())
                    await this.bot.utils.wait(2000)
                    retryCount++
                    this.bot.log(this.bot.isMobile, 'LOGIN-APP', `Page load incomplete, retry ${retryCount}/${this.maxAuthRetries}`, 'warn')
                    continue
                }

                // Wait for authorization
                await this.bot.utils.wait(maxWaitTime)
                this.bot.log(this.bot.isMobile, 'LOGIN-APP', 'Waiting for authorization')

                const currentUrl = new URL(page.url())
                if (currentUrl.hostname === 'login.live.com' && currentUrl.pathname === '/oauth20_desktop.srf') {
                    code = currentUrl.searchParams.get('code')
                    if (code) {
                        break
                    }
                }

                // If we reach here, no code was found
                retryCount++
                this.bot.log(this.bot.isMobile, 'LOGIN-APP', `Authorization attempt ${retryCount}/${this.maxAuthRetries} failed, retrying...`, 'warn')
                await this.bot.utils.wait(retryDelay)

            } catch (error) {
                retryCount++
                this.bot.log(this.bot.isMobile, 'LOGIN-APP', `Error during authorization attempt ${retryCount}/${this.maxAuthRetries}: ${error}`, 'warn')
                await this.bot.utils.wait(retryDelay)
            }
        }

        if (!code) {
            throw this.bot.log(this.bot.isMobile, 'LOGIN-APP', 'Failed to obtain authorization code after maximum retries', 'error')
        }

        const body = new URLSearchParams()
        body.append('grant_type', 'authorization_code')
        body.append('client_id', this.clientId)
        body.append('code', code)
        body.append('redirect_uri', this.redirectUrl)

        const tokenRequest: AxiosRequestConfig = {
            url: this.tokenUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: body.toString()
        }

        const tokenResponse = await this.bot.axios.request(tokenRequest)
        const tokenData: OAuth = await tokenResponse.data

        this.bot.log(this.bot.isMobile, 'LOGIN-APP', 'Successfully authorized')
        return tokenData.access_token
    }

    private async checkAccountLocked(page: Page) {
        await this.bot.utils.wait(2000)
        const isLocked = await page.waitForSelector('#serviceAbuseLandingTitle', { state: 'visible', timeout: 1000 }).then(() => true).catch(() => false)
        if (isLocked) {
            throw this.bot.log(this.bot.isMobile, 'CHECK-LOCKED', '@everyone This account has been locked! Remove the account from "accounts.json" and restart!', 'error')
        }
    }
}