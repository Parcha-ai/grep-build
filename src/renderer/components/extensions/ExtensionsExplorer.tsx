import React, { useState, useEffect } from 'react';
import { Terminal, Sparkles, Bot, ChevronDown, ChevronRight, Copy, ExternalLink, User, FolderGit } from 'lucide-react';
import type { Command, Skill, AgentDefinition } from '../../../shared/types';

interface ExtensionsExplorerProps {
  sessionId: string;
  projectPath?: string;
}

type ExtensionType = 'commands' | 'skills' | 'agents';

export default function ExtensionsExplorer({ sessionId, projectPath }: ExtensionsExplorerProps) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedType, setExpandedType] = useState<ExtensionType | null>('commands');
  const [selectedItem, setSelectedItem] = useState<Command | Skill | AgentDefinition | null>(null);
  const [viewingContent, setViewingContent] = useState(false);

  // Load extensions
  useEffect(() => {
    setLoading(true);
    Promise.all([
      window.electronAPI.extensions.scanCommands(projectPath),
      window.electronAPI.extensions.scanSkills(projectPath),
      window.electronAPI.extensions.scanAgents(projectPath),
    ])
      .then(([cmds, skls, agts]) => {
        setCommands(cmds);
        setSkills(skls);
        setAgents(agts);
      })
      .catch(err => {
        console.error('[Extensions Explorer] Error loading:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectPath]);

  const toggleType = (type: ExtensionType) => {
    setExpandedType(expandedType === type ? null : type);
    setSelectedItem(null);
    setViewingContent(false);
  };

  const handleItemClick = (item: Command | Skill | AgentDefinition) => {
    setSelectedItem(item);
    setViewingContent(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const renderCommandList = () => {
    if (commands.length === 0) {
      return (
        <div className="px-3 py-2 text-xs text-claude-text-secondary">
          No commands found. Create <code className="bg-claude-bg px-1">.claude/commands/*.md</code>
        </div>
      );
    }

    return commands.map(cmd => (
      <button
        key={`${cmd.scope}-${cmd.name}`}
        onClick={() => handleItemClick(cmd)}
        className={`w-full px-3 py-2 text-left hover:bg-claude-surface transition-colors ${
          selectedItem === cmd ? 'bg-claude-surface' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-claude-accent">/{cmd.name}</span>
          {cmd.scope === 'user' ? (
            <User size={10} className="text-claude-text-secondary" />
          ) : (
            <FolderGit size={10} className="text-claude-text-secondary" />
          )}
        </div>
        {cmd.description && (
          <p className="text-xs text-claude-text-secondary mt-1 truncate">{cmd.description}</p>
        )}
      </button>
    ));
  };

  const renderSkillList = () => {
    if (skills.length === 0) {
      return (
        <div className="px-3 py-2 text-xs text-claude-text-secondary">
          No skills found. Create <code className="bg-claude-bg px-1">.claude/skills/*/SKILL.md</code>
        </div>
      );
    }

    return skills.map(skill => (
      <button
        key={`${skill.scope}-${skill.name}`}
        onClick={() => handleItemClick(skill)}
        className={`w-full px-3 py-2 text-left hover:bg-claude-surface transition-colors ${
          selectedItem === skill ? 'bg-claude-surface' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-purple-400">/{skill.name}</span>
          {skill.scope === 'user' ? (
            <User size={10} className="text-claude-text-secondary" />
          ) : (
            <FolderGit size={10} className="text-claude-text-secondary" />
          )}
        </div>
        {skill.description && (
          <p className="text-xs text-claude-text-secondary mt-1 truncate">{skill.description}</p>
        )}
      </button>
    ));
  };

  const renderAgentList = () => {
    if (agents.length === 0) {
      return (
        <div className="px-3 py-2 text-xs text-claude-text-secondary">
          No agents found. Create <code className="bg-claude-bg px-1">.claude/agents/*.md</code>
        </div>
      );
    }

    return agents.map(agent => (
      <button
        key={`${agent.scope}-${agent.name}`}
        onClick={() => handleItemClick(agent)}
        className={`w-full px-3 py-2 text-left hover:bg-claude-surface transition-colors ${
          selectedItem === agent ? 'bg-claude-surface' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-claude-text">@agent-{agent.name}</span>
          {agent.scope === 'user' ? (
            <User size={10} className="text-claude-text-secondary" />
          ) : (
            <FolderGit size={10} className="text-claude-text-secondary" />
          )}
        </div>
        <p className="text-xs text-claude-text-secondary mt-1 truncate">{agent.description}</p>
      </button>
    ));
  };

  const renderItemDetails = () => {
    if (!selectedItem || !viewingContent) return null;

    const isCommand = 'content' in selectedItem;
    const isAgent = 'systemPrompt' in selectedItem;

    return (
      <div className="flex-1 overflow-y-auto border-l border-claude-border">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              {isCommand && <Terminal size={16} className="text-claude-accent" />}
              {!isCommand && !isAgent && <Sparkles size={16} className="text-purple-400" />}
              {isAgent && <Bot size={16} className="text-blue-400" />}
              <div>
                <h3 className="text-sm font-mono text-claude-text">
                  {isCommand ? `/${selectedItem.name}` : isAgent ? `@agent-${selectedItem.name}` : selectedItem.name}
                </h3>
                <p className="text-xs text-claude-text-secondary mt-1">
                  {selectedItem.scope === 'user' ? 'User Global' : 'Project'}
                  {(isCommand || !isAgent) && ` • ${(selectedItem as Command | Skill).path}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(isCommand ? `/${selectedItem.name}` : `@agent-${selectedItem.name}`)}
              className="p-1 hover:bg-claude-surface text-claude-text-secondary"
              title="Copy usage"
            >
              <Copy size={14} />
            </button>
          </div>

          {/* Description */}
          {selectedItem.description && (
            <div className="mb-4">
              <h4 className="text-xs font-mono text-claude-text-secondary uppercase mb-2">Description</h4>
              <p className="text-sm text-claude-text">{selectedItem.description}</p>
            </div>
          )}

          {/* Content */}
          {isCommand && (
            <div>
              <h4 className="text-xs font-mono text-claude-text-secondary uppercase mb-2">Prompt</h4>
              <pre className="text-xs text-claude-text bg-claude-surface p-3 overflow-x-auto font-mono whitespace-pre-wrap">
                {(selectedItem as Command).content}
              </pre>
            </div>
          )}

          {isAgent && (
            <div>
              <h4 className="text-xs font-mono text-claude-text-secondary uppercase mb-2">System Prompt</h4>
              <pre className="text-xs text-claude-text bg-claude-surface p-3 overflow-x-auto font-mono whitespace-pre-wrap">
                {(selectedItem as AgentDefinition).systemPrompt}
              </pre>
              {(selectedItem as AgentDefinition).disallowedTools && (
                <div className="mt-4">
                  <h4 className="text-xs font-mono text-claude-text-secondary uppercase mb-2">Disallowed Tools</h4>
                  <div className="flex flex-wrap gap-1">
                    {(selectedItem as AgentDefinition).disallowedTools!.map(tool => (
                      <span key={tool} className="text-xs bg-red-500/20 text-red-400 px-2 py-1">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Usage example */}
          <div className="mt-6 p-3 bg-claude-bg border border-claude-border">
            <h4 className="text-xs font-mono text-claude-text-secondary uppercase mb-2">Usage</h4>
            <p className="text-xs text-claude-text font-mono">
              {isCommand && `Type /${selectedItem.name} in the input to use this command`}
              {isAgent && `Type @agent-${selectedItem.name} in your message to invoke this agent`}
              {!isCommand && !isAgent && `Type /${selectedItem.name} to invoke this skill`}
            </p>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-claude-text-secondary">Loading extensions...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* List Panel */}
      <div className="w-80 border-r border-claude-border overflow-y-auto">
        {/* Commands Section */}
        <div className="border-b border-claude-border">
          <button
            onClick={() => toggleType('commands')}
            className="w-full px-3 py-2 flex items-center gap-2 hover:bg-claude-surface transition-colors"
          >
            {expandedType === 'commands' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Terminal size={14} className="text-claude-accent" />
            <span className="text-sm font-mono text-claude-text">Commands</span>
            <span className="text-xs text-claude-text-secondary">({commands.length})</span>
          </button>
          {expandedType === 'commands' && <div>{renderCommandList()}</div>}
        </div>

        {/* Skills Section */}
        <div className="border-b border-claude-border">
          <button
            onClick={() => toggleType('skills')}
            className="w-full px-3 py-2 flex items-center gap-2 hover:bg-claude-surface transition-colors"
          >
            {expandedType === 'skills' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Sparkles size={14} className="text-purple-400" />
            <span className="text-sm font-mono text-claude-text">Skills</span>
            <span className="text-xs text-claude-text-secondary">({skills.length})</span>
          </button>
          {expandedType === 'skills' && <div>{renderSkillList()}</div>}
        </div>

        {/* Agents Section */}
        <div className="border-b border-claude-border">
          <button
            onClick={() => toggleType('agents')}
            className="w-full px-3 py-2 flex items-center gap-2 hover:bg-claude-surface transition-colors"
          >
            {expandedType === 'agents' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Bot size={14} className="text-blue-400" />
            <span className="text-sm font-mono text-claude-text">Agents</span>
            <span className="text-xs text-claude-text-secondary">({agents.length})</span>
          </button>
          {expandedType === 'agents' && <div>{renderAgentList()}</div>}
        </div>
      </div>

      {/* Details Panel */}
      {viewingContent ? (
        renderItemDetails()
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Terminal size={48} className="mx-auto mb-4 text-claude-text-secondary opacity-50" />
            <p className="text-sm text-claude-text-secondary">Select an extension to view details</p>
          </div>
        </div>
      )}
    </div>
  );
}
