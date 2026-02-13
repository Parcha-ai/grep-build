/* eslint-disable @typescript-eslint/no-explicit-any */
import { webContents } from 'electron';
import { browserService } from './browser.service';

/**
 * Computer Use API action types (Anthropic spec: computer_20251124)
 */
export type ComputerAction =
  | { action: 'screenshot' }
  | { action: 'left_click'; coordinate: [number, number] }
  | { action: 'right_click'; coordinate: [number, number] }
  | { action: 'middle_click'; coordinate: [number, number] }
  | { action: 'double_click'; coordinate: [number, number] }
  | { action: 'triple_click'; coordinate: [number, number] }
  | { action: 'left_mouse_down'; coordinate: [number, number] }
  | { action: 'left_mouse_up'; coordinate: [number, number] }
  | { action: 'type'; text: string }
  | { action: 'key'; text: string } // Key name (e.g., 'Enter', 'Tab', 'Escape')
  | { action: 'mouse_move'; coordinate: [number, number] }
  | { action: 'scroll'; scroll_direction: 'up' | 'down' | 'left' | 'right'; scroll_amount?: number }
  | { action: 'left_click_drag'; coordinate: [number, number]; coordinate_end: [number, number] }
  | { action: 'hold_key'; text: string; duration: number }
  | { action: 'wait'; duration: number };

export interface ActionResult {
  success: boolean;
  message: string;
  screenshot?: string; // base64 PNG
  error?: string;
}

/**
 * Service for Computer Use API - screenshot-based browser automation
 * Uses Claude's vision capabilities for visual interaction with browsers
 *
 * Architecture:
 * - Virtual coordinate space: 1024x768 (fixed)
 * - Actual screen space: webContents.getBounds() (variable)
 * - Action execution: CDP commands via Electron debugger API
 * - Screenshot capture: Page.captureScreenshot (CDP)
 */
export class ComputerUseService {
  // Virtual screen dimensions (Computer Use API spec)
  private readonly VIRTUAL_WIDTH = 1024;
  private readonly VIRTUAL_HEIGHT = 768;

  // CDP command timeout (30 seconds)
  private static readonly COMMAND_TIMEOUT_MS = 30000;

  // Retry configuration
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 1000;

  /**
   * Execute a Computer Use API action
   *
   * @param sessionId - Session ID for browser context
   * @param action - Computer Use action to execute
   * @returns Action result with success status, message, and optional screenshot
   */
  async executeAction(sessionId: string, action: ComputerAction): Promise<ActionResult> {
    try {
      console.log('[Computer Use] Executing action:', action.action, 'for session:', sessionId);

      // Route to appropriate handler
      switch (action.action) {
        case 'screenshot':
          return await this.handleScreenshot(sessionId);

        case 'left_click':
          return await this.handleLeftClick(sessionId, action.coordinate);

        case 'right_click':
          return await this.handleRightClick(sessionId, action.coordinate);

        case 'middle_click':
          return await this.handleMiddleClick(sessionId, action.coordinate);

        case 'double_click':
          return await this.handleDoubleClick(sessionId, action.coordinate);

        case 'triple_click':
          return await this.handleTripleClick(sessionId, action.coordinate);

        case 'left_mouse_down':
          return await this.handleMouseDown(sessionId, action.coordinate);

        case 'left_mouse_up':
          return await this.handleMouseUp(sessionId, action.coordinate);

        case 'type':
          return await this.handleType(sessionId, action.text);

        case 'key':
          return await this.handleKey(sessionId, action.text);

        case 'mouse_move':
          return await this.handleMouseMove(sessionId, action.coordinate);

        case 'scroll':
          return await this.handleScroll(sessionId, {
            direction: action.scroll_direction,
            amount: action.scroll_amount || 5
          });

        case 'left_click_drag':
          return await this.handleLeftClickDrag(
            sessionId,
            action.coordinate,
            action.coordinate_end
          );

        case 'hold_key':
          return await this.handleHoldKey(sessionId, action.text, action.duration);

        case 'wait':
          return await this.handleWait(action.duration);

        default:
          return {
            success: false,
            message: `Unknown action: ${(action as any).action}`,
            error: 'UNKNOWN_ACTION'
          };
      }
    } catch (error) {
      console.error('[Computer Use] Action failed:', error);
      return {
        success: false,
        message: `Action failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Capture screenshot of browser
   */
  private async handleScreenshot(sessionId: string): Promise<ActionResult> {
    try {
      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: 'Screenshot captured successfully',
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle left click action
   */
  private async handleLeftClick(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      // Validate coordinates
      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]. Must be within virtual bounds [0-${this.VIRTUAL_WIDTH}, 0-${this.VIRTUAL_HEIGHT}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);

      // Scale to actual screen coordinates
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      console.log(`[Computer Use] Left click at virtual [${virtualX}, ${virtualY}] → screen [${screenX}, ${screenY}]`);

      // Execute click via CDP
      await this.executeWithRetry(() => this.dispatchClick(wc, screenX, screenY, 'left', 1));

      // Capture screenshot after action
      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Clicked at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Click failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle right click action
   */
  private async handleRightClick(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() => this.dispatchClick(wc, screenX, screenY, 'right', 1));

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Right clicked at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Right click failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle middle click action
   */
  private async handleMiddleClick(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() => this.dispatchClick(wc, screenX, screenY, 'middle', 1));

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Middle clicked at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Middle click failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle double click action
   */
  private async handleDoubleClick(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() => this.dispatchClick(wc, screenX, screenY, 'left', 2));

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Double clicked at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Double click failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle triple click action
   */
  private async handleTripleClick(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() => this.dispatchClick(wc, screenX, screenY, 'left', 3));

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Triple clicked at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Triple click failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle mouse down action (press without release)
   */
  private async handleMouseDown(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: screenX,
          y: screenY,
          button: 'left',
          clickCount: 1
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Mouse down at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Mouse down failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle mouse up action (release)
   */
  private async handleMouseUp(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: screenX,
          y: screenY,
          button: 'left',
          clickCount: 1
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Mouse up at [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Mouse up failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle type action (type text into focused element)
   */
  private async handleType(sessionId: string, text: string): Promise<ActionResult> {
    try {
      const wc = this.getWebContents(sessionId);

      console.log(`[Computer Use] Typing text: "${text}"`);

      // Type each character using CDP Input.dispatchKeyEvent
      for (const char of text) {
        await this.executeWithRetry(() =>
          wc.debugger.sendCommand('Input.dispatchKeyEvent', {
            type: 'char',
            text: char
          })
        );
      }

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Typed: "${text}"`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Type failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle key press action (single key like Enter, Tab, Escape)
   */
  private async handleKey(sessionId: string, keyName: string): Promise<ActionResult> {
    try {
      const wc = this.getWebContents(sessionId);

      console.log(`[Computer Use] Pressing key: ${keyName}`);

      // Map key names to CDP key codes
      const key = this.mapKeyName(keyName);

      // Press and release key
      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: key.key,
          code: key.code,
          windowsVirtualKeyCode: key.keyCode
        })
      );

      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: key.key,
          code: key.code,
          windowsVirtualKeyCode: key.keyCode
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Pressed key: ${keyName}`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Key press failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle mouse move action
   */
  private async handleMouseMove(sessionId: string, coordinate: [number, number]): Promise<ActionResult> {
    try {
      const [virtualX, virtualY] = coordinate;

      if (!this.validateCoordinates(virtualX, virtualY)) {
        return {
          success: false,
          message: `Invalid coordinates: [${virtualX}, ${virtualY}]`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);
      const [screenX, screenY] = this.scaleCoordinatesToScreen(virtualX, virtualY, bounds.width, bounds.height);

      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: screenX,
          y: screenY
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Moved mouse to [${virtualX}, ${virtualY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Mouse move failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle scroll action
   */
  private async handleScroll(
    sessionId: string,
    params: { direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  ): Promise<ActionResult> {
    try {
      const wc = this.getWebContents(sessionId);

      const { direction, amount } = params;

      // Calculate scroll delta (negative for up/left, positive for down/right)
      const scrollMultiplier = 120; // Standard mouse wheel delta
      const deltaX = direction === 'left' ? -amount * scrollMultiplier :
                     direction === 'right' ? amount * scrollMultiplier : 0;
      const deltaY = direction === 'up' ? -amount * scrollMultiplier :
                     direction === 'down' ? amount * scrollMultiplier : 0;

      console.log(`[Computer Use] Scrolling ${direction} by ${amount} (deltaX: ${deltaX}, deltaY: ${deltaY})`);

      // Get current mouse position (center of screen for scroll)
      const bounds = await this.getViewportBounds(wc);
      const centerX = Math.round(bounds.width / 2);
      const centerY = Math.round(bounds.height / 2);

      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: centerX,
          y: centerY,
          deltaX,
          deltaY
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Scrolled ${direction} by ${amount}`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Scroll failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle click and drag action
   */
  private async handleLeftClickDrag(
    sessionId: string,
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ): Promise<ActionResult> {
    try {
      const [startX, startY] = startCoordinate;
      const [endX, endY] = endCoordinate;

      if (!this.validateCoordinates(startX, startY) || !this.validateCoordinates(endX, endY)) {
        return {
          success: false,
          message: `Invalid coordinates`,
          error: 'INVALID_COORDINATES'
        };
      }

      const wc = this.getWebContents(sessionId);
      const bounds = await this.getViewportBounds(wc);

      const [screenStartX, screenStartY] = this.scaleCoordinatesToScreen(startX, startY, bounds.width, bounds.height);
      const [screenEndX, screenEndY] = this.scaleCoordinatesToScreen(endX, endY, bounds.width, bounds.height);

      console.log(`[Computer Use] Dragging from [${startX}, ${startY}] to [${endX}, ${endY}]`);

      // Mouse down at start
      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: screenStartX,
          y: screenStartY,
          button: 'left',
          clickCount: 1
        })
      );

      // Move to end
      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: screenEndX,
          y: screenEndY,
          button: 'left'
        })
      );

      // Mouse up at end
      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: screenEndX,
          y: screenEndY,
          button: 'left',
          clickCount: 1
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Dragged from [${startX}, ${startY}] to [${endX}, ${endY}]`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Drag failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle hold key action (hold key for duration)
   */
  private async handleHoldKey(sessionId: string, keyName: string, duration: number): Promise<ActionResult> {
    try {
      const wc = this.getWebContents(sessionId);

      const key = this.mapKeyName(keyName);

      console.log(`[Computer Use] Holding key: ${keyName} for ${duration}s`);

      // Press key down
      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: key.key,
          code: key.code,
          windowsVirtualKeyCode: key.keyCode
        })
      );

      // Wait
      await new Promise(resolve => setTimeout(resolve, duration * 1000));

      // Release key
      await this.executeWithRetry(() =>
        wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: key.key,
          code: key.code,
          windowsVirtualKeyCode: key.keyCode
        })
      );

      const screenshot = await this.captureScreenshot(sessionId);

      return {
        success: true,
        message: `Held key ${keyName} for ${duration}s`,
        screenshot
      };
    } catch (error) {
      return {
        success: false,
        message: `Hold key failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle wait action
   */
  private async handleWait(duration: number): Promise<ActionResult> {
    console.log(`[Computer Use] Waiting for ${duration}s`);
    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    return {
      success: true,
      message: `Waited ${duration}s`
    };
  }

  // ============ HELPER METHODS ============

  /**
   * Capture screenshot via CDP
   */
  private async captureScreenshot(sessionId: string): Promise<string> {
    const wc = this.getWebContents(sessionId);

    const result = await this.executeWithRetry(() =>
      wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        quality: 80
      })
    );

    return result.data; // base64 PNG
  }

  /**
   * Get viewport bounds via CDP
   * Returns actual screen dimensions for coordinate scaling
   */
  private async getViewportBounds(wc: Electron.WebContents): Promise<{ width: number; height: number }> {
    try {
      // Use CDP to get layout metrics (includes viewport size)
      const metrics = await wc.debugger.sendCommand('Page.getLayoutMetrics');

      // Use the layoutViewport dimensions (actual rendered size)
      const width = metrics.layoutViewport?.clientWidth || this.VIRTUAL_WIDTH;
      const height = metrics.layoutViewport?.clientHeight || this.VIRTUAL_HEIGHT;

      return { width, height };
    } catch (error) {
      // Fallback to virtual dimensions if CDP fails
      console.warn('[Computer Use] Failed to get viewport bounds, using virtual dimensions:', error);
      return { width: this.VIRTUAL_WIDTH, height: this.VIRTUAL_HEIGHT };
    }
  }

  /**
   * Get webContents for session
   */
  private getWebContents(sessionId: string): Electron.WebContents {
    const webContentsId = browserService.getWebContentsId(sessionId);

    if (!webContentsId) {
      throw new Error(`No browser found for session: ${sessionId}`);
    }

    const wc = webContents.fromId(webContentsId);

    if (!wc) {
      throw new Error(`WebContents destroyed for session: ${sessionId}`);
    }

    // Ensure debugger is attached
    if (!wc.debugger.isAttached()) {
      throw new Error(`Debugger not attached for session: ${sessionId}`);
    }

    return wc;
  }

  /**
   * Execute CDP click command
   */
  private async dispatchClick(
    wc: Electron.WebContents,
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle',
    clickCount: number
  ): Promise<void> {
    // Press
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount
    });

    // Release
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount
    });
  }

  /**
   * Scale virtual coordinates to actual screen coordinates
   */
  private scaleCoordinatesToScreen(
    virtualX: number,
    virtualY: number,
    actualWidth: number,
    actualHeight: number
  ): [number, number] {
    const scaleX = actualWidth / this.VIRTUAL_WIDTH;
    const scaleY = actualHeight / this.VIRTUAL_HEIGHT;

    return [
      Math.round(virtualX * scaleX),
      Math.round(virtualY * scaleY)
    ];
  }

  /**
   * Validate coordinates are within virtual bounds
   */
  private validateCoordinates(x: number, y: number): boolean {
    return x >= 0 && x <= this.VIRTUAL_WIDTH && y >= 0 && y <= this.VIRTUAL_HEIGHT;
  }

  /**
   * Map key name to CDP key codes
   * Handles common key names from Computer Use API
   */
  private mapKeyName(keyName: string): { key: string; code: string; keyCode: number } {
    const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
      'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
      'Return': { key: 'Enter', code: 'Enter', keyCode: 13 },
      'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
      'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
      'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
      'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      'Home': { key: 'Home', code: 'Home', keyCode: 36 },
      'End': { key: 'End', code: 'End', keyCode: 35 },
      'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
      'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      'Space': { key: ' ', code: 'Space', keyCode: 32 },
      'Shift': { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
      'Control': { key: 'Control', code: 'ControlLeft', keyCode: 17 },
      'Alt': { key: 'Alt', code: 'AltLeft', keyCode: 18 },
      'Meta': { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
      'Command': { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
    };

    // Return mapped key or use keyName as-is for single characters
    return keyMap[keyName] || { key: keyName, code: `Key${keyName.toUpperCase()}`, keyCode: keyName.charCodeAt(0) };
  }

  /**
   * Execute CDP command with retry logic
   */
  private async executeWithRetry<T>(fn: () => Promise<T>, retries = ComputerUseService.MAX_RETRIES): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[Computer Use] Command failed (attempt ${i + 1}/${retries}):`, lastError.message);

        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, ComputerUseService.RETRY_DELAY_MS));
        }
      }
    }

    throw lastError || new Error('Command failed after retries');
  }
}

// Export singleton instance
export const computerUseService = new ComputerUseService();
