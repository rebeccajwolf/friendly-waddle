import { Page } from 'rebrowser-playwright'
import { load } from 'cheerio'
import { join } from 'path'
import { mkdir } from 'fs/promises'

import { MicrosoftRewardsBot } from '../index'

export default class BrowserUtil {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async takeScreenshot(page: Page, name: string): Promise<void> {
        try {
            // Ensure screenshots directory exists
            const screenshotsDir = join(process.cwd(), 'screenshots')
            await mkdir(screenshotsDir, { recursive: true })

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const filename = `${name}_${timestamp}.png`
            const filepath = join(screenshotsDir, filename)

            // Take screenshot
            await page.screenshot({
                path: filepath,
                fullPage: true
            })

            this.bot.log(this.bot.isMobile, 'SCREENSHOT', `Screenshot saved: ${filename}`)
        } catch (error) {
            this.bot.log(this.bot.isMobile, 'SCREENSHOT', `Failed to take screenshot: ${error}`, 'error')
        }
    }

    async tryDismissAllMessages(page: Page): Promise<boolean> {
        const buttons = [
            { selector: '#acceptButton', label: 'AcceptButton' },
            { selector: '.ext-secondary.ext-button', label: '"Skip for now" Button' },
            { selector: '#iLandingViewAction', label: 'iLandingViewAction' },
            { selector: '#iShowSkip', label: 'iShowSkip' },
            { selector: '#iNext', label: 'iNext' },
            { selector: '#iLooksGood', label: 'iLooksGood' },
            { selector: '#idSIButton9', label: 'idSIButton9' },
            { selector: '.ms-Button.ms-Button--primary', label: 'Primary Button' },
            { selector: '.c-glyph.glyph-cancel', label: 'Mobile Welcome Button' },
            { selector: '.maybe-later', label: 'Mobile Rewards App Banner' },
            { selector: '//div[@id="cookieConsentContainer"]//button[contains(text(), "Accept")]', label: 'Accept Cookie Consent Container' },
            { selector: '#bnp_btn_accept', label: 'Bing Cookie Banner' },
            { selector: '#reward_pivot_earn', label: 'Reward Coupon Accept' }
        ]

        let dismissed = false;
        let isReloading = false;

        try {
            // Function to check a single element with reload handling
            const checkElement = async (button: typeof buttons[0]): Promise<boolean> => {
                if (isReloading) return false;

                try {
                    const element = await page.$(button.selector);
                    if (!element) return false;

                    const isVisible = await element.isVisible().catch(() => false);
                    if (!isVisible) return false;

                    // Set up navigation listener before clicking
                    const navigationPromise = page.waitForNavigation({
                        waitUntil: 'networkidle',
                        timeout: 10000
                    }).catch(() => null);

                    // Click the element
                    await element.click().catch(() => null);
                    
                    // Mark as dismissed and log
                    dismissed = true;
                    this.bot.log(this.bot.isMobile, 'DISMISS-ALL-MESSAGES', `Found message: ${button.label}, dismissed!`);

                    // Check if navigation occurred
                    const didNavigate = await navigationPromise;
                    if (didNavigate) {
                        isReloading = true;
                        await this.waitForPageStability(page);
                        isReloading = false;
                        
                        // After reload, recheck remaining elements
                        return true;
                    }

                    return true;
                } catch {
                    return false;
                }
            };

            // Process elements in batches to handle reloads
            let remainingButtons = [...buttons];
            const maxAttempts = 7; // Maximum number of check cycles
            let attempt = 0;

            while (remainingButtons.length > 0 && attempt < maxAttempts) {
                // Create concurrent checks for current batch
                const checkPromises = remainingButtons.map(button => checkElement(button));

                // Wait for all checks with timeout
                const results = await Promise.race([
                    Promise.all(checkPromises),
                    new Promise<boolean[]>(resolve => 
                        setTimeout(() => resolve(new Array(remainingButtons.length).fill(false)), 5000)
                    )
                ]);

                // Filter out processed buttons
                remainingButtons = remainingButtons.filter((_, index) => !results[index]);

                // If page reloaded, wait before next batch
                if (isReloading) {
                    await this.bot.utils.wait(3000);
                }

                attempt++;
            }

            return dismissed;

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'DISMISS-ALL-MESSAGES', `Error during message dismissal: ${error}`, 'warn');
            return dismissed;
        }
    }

    private async waitForPageStability(page: Page): Promise<void> {
        try {
            // Initial wait for load states
            await Promise.race([
                Promise.all([
                    page.waitForLoadState('domcontentloaded'),
                    page.waitForLoadState('networkidle')
                ]),
                new Promise(resolve => setTimeout(resolve, 10000))
            ]);

            // Check DOM stability
            const isStable = await page.evaluate(() => {
                return new Promise(resolve => {
                    if (document.readyState === 'complete') {
                        resolve(true);
                        return;
                    }

                    const loadHandler = () => {
                        cleanup();
                        resolve(true);
                    };

                    const cleanup = () => {
                        window.removeEventListener('load', loadHandler);
                        clearTimeout(timeoutId);
                    };

                    window.addEventListener('load', loadHandler);
                    const timeoutId = setTimeout(() => {
                        cleanup();
                        resolve(document.readyState === 'complete');
                    }, 10000);
                });
            });

            if (!isStable) {
                this.bot.log(this.bot.isMobile, 'PAGE-STABILITY', 'Page stability check timed out', 'warn');
            }

            // Final short wait to ensure DOM is fully interactive
            await this.bot.utils.wait(3000);

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'PAGE-STABILITY', `Error during stability check: ${error}`, 'warn');
        }
    }

    async getLatestTab(page: Page): Promise<Page> {
        try {
            await this.bot.utils.wait(1000)

            const browser = page.context()
            const pages = browser.pages()
            const newTab = pages[pages.length - 1]

            if (newTab) {
                return newTab
            }

            throw this.bot.log(this.bot.isMobile, 'GET-NEW-TAB', 'Unable to get latest tab', 'error')
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, 'GET-NEW-TAB', 'An error occurred:' + error, 'error')
        }
    }

    async getTabs(page: Page) {
        try {
            const browser = page.context()
            const pages = browser.pages()

            const homeTab = pages[1]
            let homeTabURL: URL

            if (!homeTab) {
                throw this.bot.log(this.bot.isMobile, 'GET-TABS', 'Home tab could not be found!', 'error')

            } else {
                homeTabURL = new URL(homeTab.url())

                if (homeTabURL.hostname !== 'rewards.bing.com') {
                    throw this.bot.log(this.bot.isMobile, 'GET-TABS', 'Reward page hostname is invalid: ' + homeTabURL.host, 'error')
                }
            }

            const workerTab = pages[2]
            if (!workerTab) {
                throw this.bot.log(this.bot.isMobile, 'GET-TABS', 'Worker tab could not be found!', 'error')
            }

            return {
                homeTab: homeTab,
                workerTab: workerTab
            }

        } catch (error) {
            throw this.bot.log(this.bot.isMobile, 'GET-TABS', 'An error occurred:' + error, 'error')
        }
    }

    async reloadBadPage(page: Page): Promise<void> {
        try {
            const html = await page.content().catch(() => '')
            const $ = load(html)

            const isNetworkError = $('body.neterror').length

            if (isNetworkError) {
                this.bot.log(this.bot.isMobile, 'RELOAD-BAD-PAGE', 'Bad page detected, reloading!')
                await page.reload()
            }

        } catch (error) {
            throw this.bot.log(this.bot.isMobile, 'RELOAD-BAD-PAGE', 'An error occurred:' + error, 'error')
        }
    }

}