import React, { useState } from 'react';
import { useSessionStore } from '../../stores/session.store';

interface MessageQueuePanelProps {
  sessionId: string;
}

export const MessageQueuePanel: React.FC<MessageQueuePanelProps> = ({ sessionId }) => {
  const { messageQueue, removeFromQueue, editQueuedMessage, moveToFront, clearQueue, interruptAndSend } = useSessionStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  const queue = messageQueue[sessionId] || [];

  if (queue.length === 0) {
    return null; // Don't render if queue is empty
  }

  const handleEdit = (id: string, currentMessage: string) => {
    setEditingId(id);
    setEditText(currentMessage);
  };

  const handleSaveEdit = (id: string) => {
    if (editText.trim()) {
      editQueuedMessage(sessionId, id, editText.trim());
    }
    setEditingId(null);
    setEditText('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleInterrupt = (message: string, attachments?: unknown[]) => {
    if (confirm('Stop current message and send this immediately?')) {
      interruptAndSend(sessionId, message, attachments);
    }
  };

  const handleClearAll = () => {
    if (confirm(`Clear all ${queue.length} queued messages?`)) {
      clearQueue(sessionId);
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const truncateMessage = (msg: string, maxLength = 100) => {
    return msg.length > maxLength ? msg.substring(0, maxLength) + '...' : msg;
  };

  return (
    <div className="border-t border-gray-700 bg-gray-800/50">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-gray-700/30"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">
            {isExpanded ? '▼' : '▶'} Message Queue
          </span>
          <span className="px-2 py-0.5 text-xs bg-blue-500/20 border border-blue-500/50 rounded-full text-blue-300">
            {queue.length} {queue.length === 1 ? 'message' : 'messages'}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClearAll();
          }}
          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 hover:bg-red-500/10 rounded"
        >
          Clear All
        </button>
      </div>

      {/* Queue List */}
      {isExpanded && (
        <div className="max-h-60 overflow-y-auto">
          {queue.map((item, index) => (
            <div
              key={item.id}
              className={`px-4 py-3 border-t border-gray-700/50 ${
                index === 0 ? 'bg-blue-500/5' : 'bg-gray-800/30'
              }`}
            >
              {/* Message Label */}
              <div className="flex items-center gap-2 mb-2">
                {index === 0 && (
                  <span className="px-2 py-0.5 text-xs bg-green-500/20 border border-green-500/50 rounded text-green-300">
                    Next Up
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>

              {/* Message Content or Edit Input */}
              {editingId === item.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-500"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(item.id)}
                      className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-300 mb-3 whitespace-pre-wrap">
                    {truncateMessage(item.message)}
                  </p>

                  {/* Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleEdit(item.id, item.message)}
                      className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded flex items-center gap-1"
                      title="Edit message"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => removeFromQueue(sessionId, item.id)}
                      className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded flex items-center gap-1"
                      title="Cancel message"
                    >
                      ❌ Cancel
                    </button>
                    {index !== 0 && (
                      <button
                        onClick={() => moveToFront(sessionId, item.id)}
                        className="px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded flex items-center gap-1"
                        title="Move to front of queue"
                      >
                        ⬆️ Move to Front
                      </button>
                    )}
                    <button
                      onClick={() => handleInterrupt(item.message, item.attachments)}
                      className="px-2 py-1 text-xs bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded flex items-center gap-1"
                      title="Interrupt current message and send this now"
                    >
                      ⚡ Send Now
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
