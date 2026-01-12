import React, { useEffect, useState } from 'react';
import type { Command, Skill, AgentDefinition } from '../../../shared/types';
import { Terminal, Sparkles, Bot } from 'lucide-react';

interface CommandAutocompleteProps {
  query: string; // The text after `/` or `@agent-`
  type: 'command' | 'skill' | 'agent';
  commands: Command[];
  skills: Skill[];
  agents: AgentDefinition[];
  onSelect: (item: Command | Skill | AgentDefinition) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

export default function CommandAutocomplete({
  query,
  type,
  commands,
  skills,
  agents,
  onSelect,
  onClose,
  position,
}: CommandAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter items based on query
  const filteredItems = React.useMemo(() => {
    const lowerQuery = query.toLowerCase();

    if (type === 'command') {
      // Show both commands AND skills for slash notation (combined system)
      const matchedCommands = commands
        .filter(cmd => cmd.name.toLowerCase().includes(lowerQuery))
        .map(cmd => ({ ...cmd, itemType: 'command' as const }));

      const matchedSkills = skills
        .filter(skill => skill.name.toLowerCase().includes(lowerQuery))
        .map(skill => ({ ...skill, itemType: 'skill' as const }));

      return [...matchedCommands, ...matchedSkills].slice(0, 10);
    } else if (type === 'skill') {
      return skills
        .filter(skill => skill.name.toLowerCase().includes(lowerQuery))
        .map(skill => ({ ...skill, itemType: 'skill' as const }))
        .slice(0, 10);
    } else {
      return agents
        .filter(agent => agent.name.toLowerCase().includes(lowerQuery))
        .map(agent => ({ ...agent, itemType: 'agent' as const }))
        .slice(0, 10);
    }
  }, [query, type, commands, skills, agents]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredItems.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % filteredItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            onSelect(filteredItems[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, selectedIndex, onSelect, onClose]);

  if (filteredItems.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bg-claude-surface border border-claude-border shadow-lg z-50 max-h-64 overflow-y-auto"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        minWidth: '300px',
        maxWidth: '500px',
      }}
    >
      {filteredItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        // Use itemType to determine icon for combined command/skill lists
        const itemType = (item as any).itemType || type;
        const Icon = itemType === 'command' ? Terminal : itemType === 'skill' ? Sparkles : Bot;

        return (
          <button
            key={`${itemType}-${item.name}`}
            className={`w-full px-3 py-2 text-left hover:bg-claude-accent/20 transition-colors flex items-start gap-2 ${
              isSelected ? 'bg-claude-accent/20' : ''
            }`}
            onClick={() => onSelect(item)}
          >
            <Icon size={16} className="text-claude-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-claude-text">
                  {itemType === 'agent' ? `@agent-${item.name}` : `/${item.name}`}
                </span>
                <span className="text-xs text-claude-text-secondary">
                  ({item.scope || itemType})
                </span>
              </div>
              {item.description && (
                <p className="text-xs text-claude-text-secondary mt-1 truncate">
                  {item.description}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
