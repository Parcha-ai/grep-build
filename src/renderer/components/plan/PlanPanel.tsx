import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, FileText, Trash2, Check, XCircle } from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import { useSessionStore } from '../../stores/session.store';

export default function PlanPanel() {
  const { togglePlanPanel, sessionPlanContent, clearPlanContent } = useUIStore();
  const { activeSessionId, pendingPlanApproval, approvePlan, rejectPlan } = useSessionStore();

  const planContent = activeSessionId ? sessionPlanContent[activeSessionId] : null;
  const pendingApproval = activeSessionId ? pendingPlanApproval[activeSessionId] : null;

  const handleClear = () => {
    if (activeSessionId) {
      clearPlanContent(activeSessionId);
    }
  };

  const handleApprove = async () => {
    if (activeSessionId) {
      await approvePlan(activeSessionId);
    }
  };

  const handleReject = async () => {
    if (activeSessionId) {
      await rejectPlan(activeSessionId);
    }
  };

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-claude-border bg-claude-surface">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-claude-accent" />
          <span className="text-sm font-medium">Plan</span>
          {pendingApproval && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
              Awaiting Approval
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {planContent && !pendingApproval && (
            <button
              onClick={handleClear}
              className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
              title="Clear plan"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={togglePlanPanel}
            className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Approval buttons - shown when there's a pending approval */}
      {pendingApproval && (
        <div className="px-4 py-3 border-b border-claude-border bg-claude-surface/50">
          <p className="text-sm text-claude-text-secondary mb-3">
            Claude has created a plan and is waiting for your approval to proceed.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-medium text-sm transition-colors"
            >
              <Check size={16} />
              Approve Plan
            </button>
            <button
              onClick={handleReject}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-claude-surface hover:bg-claude-bg border border-claude-border text-claude-text font-medium text-sm transition-colors"
            >
              <XCircle size={16} />
              Reject
            </button>
          </div>
          {pendingApproval.allowedPrompts && pendingApproval.allowedPrompts.length > 0 && (
            <div className="mt-3 pt-3 border-t border-claude-border">
              <p className="text-xs text-claude-text-secondary mb-2">Requested permissions:</p>
              <ul className="text-xs text-claude-text-secondary space-y-1">
                {pendingApproval.allowedPrompts.map((prompt, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-claude-accent">•</span>
                    {prompt.prompt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {planContent ? (
          <div className="prose prose-invert prose-sm max-w-none font-mono">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Custom styling for plan content
                h1: ({ children }) => (
                  <h1 className="text-lg font-bold text-claude-text border-b border-claude-border pb-2 mb-4">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-bold text-claude-text mt-6 mb-2">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-bold text-claude-text mt-4 mb-2">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-claude-text-secondary leading-relaxed my-2">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-outside ml-4 my-2 space-y-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-outside ml-4 my-2 space-y-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-sm text-claude-text-secondary">
                    {children}
                  </li>
                ),
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const isBlock = String(children).includes('\n') || match;
                  if (isBlock) {
                    return (
                      <div className="overflow-hidden border border-claude-border my-2" style={{ borderRadius: 0 }}>
                        {match && (
                          <div className="px-2 py-1 text-xs font-bold font-mono bg-claude-surface border-b border-claude-border text-claude-text-secondary uppercase tracking-wider">
                            {match[1]}
                          </div>
                        )}
                        <pre className="p-3 bg-claude-bg m-0 overflow-x-auto">
                          <code className="text-xs font-mono text-claude-text" {...props}>
                            {children}
                          </code>
                        </pre>
                      </div>
                    );
                  }
                  return (
                    <code
                      className="px-1 py-0.5 text-xs font-mono bg-claude-surface text-claude-accent"
                      style={{ borderRadius: 0 }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-claude-accent pl-3 my-2 text-claude-text-secondary italic">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="w-full text-sm border-collapse border border-claude-border">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-claude-border bg-claude-surface px-2 py-1 text-left font-bold text-claude-text">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-claude-border px-2 py-1 text-claude-text-secondary">
                    {children}
                  </td>
                ),
                hr: () => <hr className="border-claude-border my-4" />,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-claude-accent hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                // Task list support
                input: ({ type, checked, ...props }) => {
                  if (type === 'checkbox') {
                    return (
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        className="mr-2 accent-claude-accent"
                        {...props}
                      />
                    );
                  }
                  return <input type={type} {...props} />;
                },
              }}
            >
              {planContent}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-claude-text-secondary">
            <FileText size={32} className="mb-3 opacity-50" />
            <p className="text-sm font-mono">No plan created yet</p>
            <p className="text-xs font-mono mt-1 opacity-70">
              Switch to Plan mode to generate a plan
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
