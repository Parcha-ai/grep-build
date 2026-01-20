import { Stagehand, type Page } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { cdpProxyService } from './cdp-proxy.service';
import { browserService } from './browser.service';

export interface StagehandActionResult {
  success: boolean;
  message?: string;
  screenshot?: string; // base64 encoded PNG
  error?: string;
}

export interface StagehandExtractResult<T = unknown> {
  success: boolean;
  data?: T;
  screenshot?: string;
  error?: string;
}

export interface StagehandObserveResult {
  success: boolean;
  actions?: Array<{
    selector: string;
    description: string;
    suggestedAction: string;
  }>;
  screenshot?: string;
  error?: string;
}

export interface StagehandAgentResult {
  success: boolean;
  message?: string;
  actions?: Array<{ type: string; description: string }>;
  screenshot?: string;
  error?: string;
}

export interface StagehandSnapshot {
  url: string;
  title: string;
  screenshot: string; // base64 encoded PNG
  html: string;
  timestamp: Date;
}

/**
 * Service for AI-powered browser automation using Stagehand V3
 * Replaces the CDP-based BrowserService with natural language capabilities
 */
export class StagehandService {
  private stagehand: Stagehand | null = null;
  private isInitializing = false;
  private anthropicApiKey: string | null = null;
  private googleApiKey: string | null = null;
  private connectedToWebview = false; // Track if we're connected to webview or own browser

  /**
   * Set the Anthropic API key for Stagehand's AI features
   */
  setApiKey(apiKey: string): void {
    this.anthropicApiKey = apiKey;
  }

  /**
   * Set the Google API key for Gemini models
   */
  setGoogleApiKey(apiKey: string): void {
    this.googleApiKey = apiKey;
  }

  /**
   * Initialize Stagehand instance
   * Creates a new browser instance in local mode
   */
  async init(): Promise<void> {
    if (this.stagehand) {
      return; // Already initialized
    }

    if (this.isInitializing) {
      // Wait for existing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.isInitializing = true;

    try {
      console.log('[Stagehand] Initializing with Electron webview...');

      // Set API keys in environment
      // Stagehand uses GOOGLE_GENERATIVE_AI_API_KEY for Gemini models
      if (this.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = this.anthropicApiKey;
      }
      if (this.googleApiKey) {
        process.env.GOOGLE_API_KEY = this.googleApiKey;
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = this.googleApiKey;
      }

      // Try to connect to webview via CDP proxy
      // Retry a few times since webview might not be created yet
      let cdpUrl: string | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        console.log('[Stagehand] Checking for webview via CDP proxy (attempt', attempt + 1, ')');

        cdpUrl = await this.findWebviewCdpUrl();
        if (cdpUrl) {
          console.log('[Stagehand] Using webview CDP URL:', cdpUrl);
          break;
        }

        if (attempt < 4) {
          console.log('[Stagehand] No webview found yet, waiting...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        }
      }

      if (!cdpUrl) {
        console.log('[Stagehand] No webview CDP found, will launch own browser');
      }

      this.stagehand = new Stagehand({
        env: 'LOCAL',
        localBrowserLaunchOptions: cdpUrl ? {
          cdpUrl, // Connect to existing webview
        } : {
          headless: true, // Fallback: launch own browser
        },
        model: 'google/gemini-2.5-flash', // Gemini 2.5 Flash - recommended stable model
        domSettleTimeout: 3000, // Wait for DOM to stabilize
        verbose: 1,
      });

      await this.stagehand.init();
      this.connectedToWebview = !!cdpUrl;
      console.log('[Stagehand] Browser initialized successfully', cdpUrl ? '(connected to webview)' : '(own browser)');
    } catch (error) {
      console.error('[Stagehand] Failed to initialize:', error);
      this.stagehand = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Check if Stagehand is initialized and ready
   */
  isReady(): boolean {
    return this.stagehand !== null;
  }

  /**
   * Get the active page from Stagehand context
   */
  private getPage(): Page | undefined {
    if (!this.stagehand) return undefined;
    return this.stagehand.context.activePage();
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<StagehandActionResult> {
    // Retry logic for destroyed browser
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensureInitialized();

        const page = this.getPage();
        if (!page) {
          return { success: false, error: 'No active page available' };
        }

        console.log('[Stagehand] Navigating to:', url);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait a bit for dynamic content
        await new Promise(resolve => setTimeout(resolve, 1000));

        const screenshot = await this.captureScreenshot();

        return {
          success: true,
          message: `Navigated to ${url}`,
          screenshot,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Stagehand] Navigation error (attempt', attempt + 1, '):', errorMsg);

        // If browser was destroyed, force reinit and retry
        if (errorMsg.includes('destroyed') || errorMsg.includes('-32000')) {
          console.log('[Stagehand] Browser destroyed, forcing reinitialization...');
          this.stagehand = null;
          this.connectedToWebview = false;
          if (attempt < 1) continue; // Retry
        }

        return {
          success: false,
          error: errorMsg,
        };
      }
    }
    return { success: false, error: 'Navigation failed after retries' };
  }

  /**
   * Execute a natural language action
   * Uses Stagehand's AI to interpret and execute the action
   */
  async act(instruction: string): Promise<StagehandActionResult> {
    // Retry logic for destroyed browser
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensureInitialized();

        console.log('[Stagehand] Executing action:', instruction);
        await this.stagehand!.act(instruction);

        // Wait for any resulting page changes
        await new Promise(resolve => setTimeout(resolve, 500));

        const screenshot = await this.captureScreenshot();

        return {
          success: true,
          message: `Executed: ${instruction}`,
          screenshot,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Stagehand] Action error (attempt', attempt + 1, '):', errorMsg);

        // If browser was destroyed, force reinit and retry
        if (errorMsg.includes('destroyed') || errorMsg.includes('-32000')) {
          console.log('[Stagehand] Browser destroyed, forcing reinitialization...');
          this.stagehand = null;
          this.connectedToWebview = false;
          if (attempt < 1) continue; // Retry
        }

        return {
          success: false,
          error: errorMsg,
        };
      }
    }
    return { success: false, error: 'Action failed after retries' };
  }

  /**
   * Extract structured data from the page
   * Uses Stagehand's AI to understand and extract data based on a schema
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async extract<T = unknown>(instruction: string, schema: any): Promise<StagehandExtractResult<T>> {
    try {
      await this.ensureInitialized();

      console.log('[Stagehand] Extracting data:', instruction);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.stagehand!.extract(instruction, schema as any);

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        data: data as T,
        screenshot,
      };
    } catch (error) {
      console.error('[Stagehand] Extract error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Observe available actions on the page
   * Returns a list of interactive elements and suggested actions
   */
  async observe(instruction?: string): Promise<StagehandObserveResult> {
    try {
      await this.ensureInitialized();

      console.log('[Stagehand] Observing page:', instruction || 'all elements');
      // observe() requires a string instruction
      const observeInstruction = instruction || 'Find all interactive elements on the page';
      const actions = await this.stagehand!.observe(observeInstruction);

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        actions: actions.map(a => ({
          selector: a.selector,
          description: a.description,
          suggestedAction: 'click', // Default suggested action
        })),
        screenshot,
      };
    } catch (error) {
      console.error('[Stagehand] Observe error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute a multi-step task using Stagehand's autonomous agent
   */
  async agent(task: string): Promise<StagehandAgentResult> {
    try {
      await this.ensureInitialized();

      console.log('[Stagehand] Agent executing task:', task);
      const agentInstance = this.stagehand!.agent();

      const result = await agentInstance.execute(task);

      const screenshot = await this.captureScreenshot();

      // Handle the result - it could be AgentResult or AgentStreamResult
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyResult = result as any;

      return {
        success: anyResult.success ?? true,
        message: anyResult.message ?? 'Task completed',
        actions: anyResult.actions?.map((a: { type?: string; description?: string }) => ({
          type: a.type || 'action',
          description: a.description || String(a),
        })) ?? [],
        screenshot,
      };
    } catch (error) {
      console.error('[Stagehand] Agent error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Capture a full page snapshot including screenshot and HTML
   */
  async captureSnapshot(): Promise<StagehandSnapshot | null> {
    try {
      await this.ensureInitialized();

      const page = this.getPage();
      if (!page) return null;

      const url = page.url();
      const title = await page.title();
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
      const screenshot = screenshotBuffer.toString('base64');

      return {
        url,
        title,
        screenshot,
        html,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('[Stagehand] Snapshot error:', error);
      return null;
    }
  }

  /**
   * Capture just a screenshot
   */
  async captureScreenshot(): Promise<string | undefined> {
    try {
      const page = this.getPage();
      if (!page) return undefined;

      const screenshotBuffer = await page.screenshot({
        type: 'png',
        fullPage: false,
      });
      return screenshotBuffer.toString('base64');
    } catch (error) {
      console.error('[Stagehand] Screenshot error:', error);
      return undefined;
    }
  }

  /**
   * Get current page info
   */
  async getPageInfo(): Promise<{ url: string; title: string } | null> {
    try {
      const page = this.getPage();
      if (!page) return null;

      return {
        url: page.url(),
        title: await page.title(),
      };
    } catch (error) {
      console.error('[Stagehand] Page info error:', error);
      return null;
    }
  }

  /**
   * Get page HTML
   */
  async getHTML(): Promise<string | null> {
    try {
      const page = this.getPage();
      if (!page) return null;
      return await page.evaluate(() => document.documentElement.outerHTML);
    } catch (error) {
      console.error('[Stagehand] HTML error:', error);
      return null;
    }
  }

  /**
   * Click on an element using a CSS selector (fallback for when AI isn't needed)
   */
  async click(selector: string): Promise<StagehandActionResult> {
    try {
      await this.ensureInitialized();

      const page = this.getPage();
      if (!page) {
        return { success: false, error: 'No active page available' };
      }

      console.log('[Stagehand] Clicking selector:', selector);
      await page.locator(selector).click();

      await new Promise(resolve => setTimeout(resolve, 500));
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        message: `Clicked: ${selector}`,
        screenshot,
      };
    } catch (error) {
      console.error('[Stagehand] Click error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Type text into an element (fallback for when AI isn't needed)
   */
  async type(selector: string, text: string): Promise<StagehandActionResult> {
    try {
      await this.ensureInitialized();

      const page = this.getPage();
      if (!page) {
        return { success: false, error: 'No active page available' };
      }

      console.log('[Stagehand] Typing into selector:', selector);
      await page.locator(selector).fill(text);

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        message: `Typed into: ${selector}`,
        screenshot,
      };
    } catch (error) {
      console.error('[Stagehand] Type error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract text from the page or an element
   */
  async extractText(selector?: string): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      await this.ensureInitialized();

      const page = this.getPage();
      if (!page) {
        return { success: false, error: 'No active page available' };
      }

      let text: string;

      if (selector) {
        // Use evaluate to get text content of element
        text = await page.evaluate((sel: string) => {
          const element = document.querySelector(sel);
          return element ? element.textContent || '' : '';
        }, selector);
      } else {
        text = await page.evaluate(() => document.body.innerText);
      }

      return { success: true, text };
    } catch (error) {
      console.error('[Stagehand] Extract text error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch (error) {
        console.error('[Stagehand] Close error:', error);
      }
      this.stagehand = null;
      this.connectedToWebview = false;
    }
  }

  /**
   * Check if a webview is available via CDP proxy
   */
  private async findWebviewCdpUrl(): Promise<string | undefined> {
    // First check if CDP proxy is running
    if (!cdpProxyService.isRunning()) {
      console.log('[Stagehand] CDP proxy not running');
      return undefined;
    }

    // Get available webview targets from the proxy
    const targets = cdpProxyService.getTargets();
    console.log('[Stagehand] CDP proxy targets:', targets.length);

    if (targets.length > 0) {
      // Use the first available webview
      const target = targets[0];
      console.log('[Stagehand] Found webview target via proxy:', target.url);
      return target.webSocketDebuggerUrl;
    }

    // Fallback: check if there's a registered session we can use
    const sessionId = browserService.getFirstSessionId();
    if (sessionId) {
      const wsUrl = cdpProxyService.getWebSocketUrl(sessionId);
      if (wsUrl) {
        console.log('[Stagehand] Using session webview via proxy:', sessionId);
        return wsUrl;
      }
    }

    return undefined;
  }

  /**
   * Reconnect to the webview if available
   * Call this when the webview might now be available
   */
  async reconnectToWebview(): Promise<boolean> {
    console.log('[Stagehand] Checking for webview to reconnect...');

    const cdpUrl = await this.findWebviewCdpUrl();
    if (!cdpUrl) {
      console.log('[Stagehand] No webview found for reconnection');
      return false;
    }

    console.log('[Stagehand] Found webview, reconnecting:', cdpUrl);

    // Close existing browser
    await this.close();

    // Reinitialize with webview
    this.isInitializing = true;
    try {
      if (this.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = this.anthropicApiKey;
      }
      if (this.googleApiKey) {
        process.env.GOOGLE_API_KEY = this.googleApiKey;
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = this.googleApiKey;
      }

      this.stagehand = new Stagehand({
        env: 'LOCAL',
        localBrowserLaunchOptions: {
          cdpUrl,
        },
        model: 'google/gemini-2.5-flash',
        domSettleTimeout: 3000,
        verbose: 1,
      });

      await this.stagehand.init();
      this.connectedToWebview = true;
      console.log('[Stagehand] Successfully reconnected to webview');
      return true;
    } catch (error) {
      console.error('[Stagehand] Failed to reconnect to webview:', error);
      this.stagehand = null;
      this.connectedToWebview = false;
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Ensure Stagehand is initialized before operations
   * If not connected to webview, try to reconnect
   */
  private async ensureInitialized(): Promise<void> {
    // Check if we need to initialize or reinitialize
    let needsInit = !this.stagehand;

    // If we have stagehand, verify the browser/page is still alive
    if (this.stagehand && !needsInit) {
      try {
        const page = this.stagehand.context.activePage();
        if (!page) {
          needsInit = true;
        } else {
          // Try to access the page to see if it's still alive
          await page.url();
        }
      } catch (error) {
        console.log('[Stagehand] Browser appears destroyed, will reinitialize:', error);
        needsInit = true;
        // Clean up the dead reference
        try {
          await this.stagehand?.close();
        } catch {
          // Ignore close errors on dead browser
        }
        this.stagehand = null;
        this.connectedToWebview = false;
      }
    }

    if (needsInit) {
      await this.init();
    } else if (!this.connectedToWebview) {
      // Already have own browser, but check if webview is now available
      const cdpUrl = await this.findWebviewCdpUrl();
      if (cdpUrl) {
        console.log('[Stagehand] Webview now available, switching from own browser');
        await this.reconnectToWebview();
      }
    }
  }
}

export const stagehandService = new StagehandService();
