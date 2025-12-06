import React, { useRef, useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Target,
  Code,
  X,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import type { Session, DOMElementContext } from '../../../shared/types';

interface BrowserPreviewProps {
  session: Session;
}

export default function BrowserPreview({ session }: BrowserPreviewProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [url, setUrl] = useState(`http://localhost:${session.ports.web}`);
  const [inputUrl, setInputUrl] = useState(url);
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const { isInspectorActive, setInspectorActive, setSelectedElement } = useUIStore();

  // Handle webview events
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDidStartLoading = () => setIsLoading(true);
    const handleDidStopLoading = () => {
      setIsLoading(false);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };
    const handleDidNavigate = (e: Electron.DidNavigateEvent) => {
      setUrl(e.url);
      setInputUrl(e.url);
    };

    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);
    webview.addEventListener('did-navigate', handleDidNavigate as any);
    webview.addEventListener('did-navigate-in-page', handleDidNavigate as any);

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
      webview.removeEventListener('did-navigate', handleDidNavigate as any);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate as any);
    };
  }, []);

  // Handle inspector mode
  useEffect(() => {
    if (isInspectorActive && webviewRef.current) {
      injectInspector();
    }
  }, [isInspectorActive]);

  const injectInspector = async () => {
    const webview = webviewRef.current;
    if (!webview) return;

    // Inject inspector script
    await webview.executeJavaScript(`
      (function() {
        // Remove existing inspector
        const existing = document.getElementById('claudette-inspector');
        if (existing) existing.remove();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'claudette-inspector';
        overlay.style.cssText = 'position:fixed;pointer-events:none;background:rgba(59,130,246,0.3);border:2px solid #3b82f6;z-index:999999;transition:all 0.1s ease;';
        document.body.appendChild(overlay);

        // Create info tooltip
        const tooltip = document.createElement('div');
        tooltip.id = 'claudette-inspector-tooltip';
        tooltip.style.cssText = 'position:fixed;background:#1a1a1a;color:#fff;padding:4px 8px;font-size:12px;font-family:monospace;border-radius:4px;z-index:1000000;pointer-events:none;max-width:300px;word-break:break-all;';
        document.body.appendChild(tooltip);

        document.body.style.cursor = 'crosshair';

        function getSelector(el) {
          const parts = [];
          while (el && el !== document.body) {
            let selector = el.tagName.toLowerCase();
            if (el.id) selector += '#' + el.id;
            else if (el.className) selector += '.' + el.className.split(' ').filter(Boolean).join('.');
            parts.unshift(selector);
            el = el.parentElement;
          }
          return parts.join(' > ');
        }

        function handleMove(e) {
          const el = e.target;
          const rect = el.getBoundingClientRect();
          overlay.style.top = rect.top + 'px';
          overlay.style.left = rect.left + 'px';
          overlay.style.width = rect.width + 'px';
          overlay.style.height = rect.height + 'px';

          const selector = getSelector(el);
          tooltip.textContent = selector;
          tooltip.style.top = Math.min(rect.top - 30, window.innerHeight - 40) + 'px';
          tooltip.style.left = Math.min(rect.left, window.innerWidth - 310) + 'px';
        }

        function handleClick(e) {
          e.preventDefault();
          e.stopPropagation();

          const el = e.target;
          const selector = getSelector(el);

          const context = {
            tagName: el.tagName.toLowerCase(),
            id: el.id,
            className: el.className,
            selector: selector,
            innerHTML: el.innerHTML.slice(0, 500),
            outerHTML: el.outerHTML.slice(0, 1000),
            textContent: el.textContent?.slice(0, 500),
            attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value })),
          };

          window.postMessage({ type: 'claudette-element-selected', context }, '*');

          // Cleanup
          document.body.style.cursor = '';
          overlay.remove();
          tooltip.remove();
          document.removeEventListener('mouseover', handleMove);
          document.removeEventListener('click', handleClick, true);
        }

        document.addEventListener('mouseover', handleMove);
        document.addEventListener('click', handleClick, true);
      })();
    `);

    // Listen for selection
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'claudette-element-selected') {
        setSelectedElement(event.data.context);
        setInspectorActive(false);
      }
    };

    webview.addEventListener('ipc-message', (event: Electron.IpcMessageEvent) => {
      if (event.channel === 'element-selected') {
        setSelectedElement(event.args[0]);
        setInspectorActive(false);
      }
    });
  };

  const cancelInspector = async () => {
    setInspectorActive(false);
    if (webviewRef.current) {
      await webviewRef.current.executeJavaScript(`
        document.body.style.cursor = '';
        document.getElementById('claudette-inspector')?.remove();
        document.getElementById('claudette-inspector-tooltip')?.remove();
      `);
    }
  };

  const navigate = (targetUrl: string) => {
    if (!targetUrl.startsWith('http')) {
      targetUrl = 'http://' + targetUrl;
    }
    setUrl(targetUrl);
    setInputUrl(targetUrl);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(inputUrl);
  };

  if (session.status !== 'running') {
    return (
      <div className="h-full flex items-center justify-center bg-claude-bg text-claude-text-secondary">
        <p>Start the session to preview</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Toolbar */}
      <div className="h-10 flex items-center gap-2 px-2 bg-claude-surface border-b border-claude-border">
        {/* Navigation */}
        <button
          onClick={() => webviewRef.current?.goBack()}
          disabled={!canGoBack}
          className="p-1.5 rounded hover:bg-claude-bg transition-colors disabled:opacity-30"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          disabled={!canGoForward}
          className="p-1.5 rounded hover:bg-claude-bg transition-colors disabled:opacity-30"
        >
          <ArrowRight size={16} />
        </button>
        <button
          onClick={() => webviewRef.current?.reload()}
          className="p-1.5 rounded hover:bg-claude-bg transition-colors"
        >
          <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            className="w-full px-3 py-1 bg-claude-bg border border-claude-border rounded text-sm focus:outline-none focus:border-claude-accent font-mono"
          />
        </form>

        {/* Actions */}
        <button
          onClick={() => setInspectorActive(true)}
          className={`p-1.5 rounded transition-colors ${
            isInspectorActive
              ? 'bg-blue-600 text-white'
              : 'hover:bg-claude-bg'
          }`}
          title="Select element"
        >
          <Target size={16} />
        </button>
        <button
          onClick={() => webviewRef.current?.openDevTools()}
          className="p-1.5 rounded hover:bg-claude-bg transition-colors"
          title="Open DevTools"
        >
          <Code size={16} />
        </button>
        <button
          onClick={() => window.electronAPI.app.openExternal(url)}
          className="p-1.5 rounded hover:bg-claude-bg transition-colors"
          title="Open in browser"
        >
          <ExternalLink size={16} />
        </button>
      </div>

      {/* Inspector mode banner */}
      {isInspectorActive && (
        <div className="h-8 flex items-center justify-center gap-2 bg-blue-600 text-white text-sm">
          <Target size={14} />
          <span>Click any element to select it</span>
          <button
            onClick={cancelInspector}
            className="ml-2 p-0.5 rounded hover:bg-blue-500"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Webview */}
      <div className="flex-1 relative">
        <webview
          ref={webviewRef}
          src={url}
          className="absolute inset-0 w-full h-full"
          webpreferences="contextIsolation=yes"
        />
      </div>
    </div>
  );
}
