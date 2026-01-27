import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Sparkles, Bot, ChevronDown, ChevronRight, Copy, ExternalLink, User, FolderGit, Edit3, Plus, X, Loader2, Check, AlertCircle, FileText, Github } from 'lucide-react';
import type { Command, Skill, AgentDefinition } from '../../../shared/types';

// Default template for new skills
const SKILL_TEMPLATE = `# My Skill

A brief description of what this skill does.

## Usage

Describe how to use this skill and what it accomplishes.

## Instructions

When this skill is invoked:

1. First, do this thing
2. Then, do this other thing
3. Finally, complete the task

## Examples

Example usage patterns or expected outputs.
`;

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

  // Skill action menu state (shown when + is clicked)
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const skillMenuRef = useRef<HTMLDivElement>(null);

  // Skill installation state
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [installSource, setInstallSource] = useState('');
  const [installGlobal, setInstallGlobal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const installInputRef = useRef<HTMLInputElement>(null);

  // Create skill state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillContent, setNewSkillContent] = useState(SKILL_TEMPLATE);
  const [newSkillGlobal, setNewSkillGlobal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string } | null>(null);
  const createNameInputRef = useRef<HTMLInputElement>(null);

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

  // Focus input when dialog opens
  useEffect(() => {
    if (showInstallDialog && installInputRef.current) {
      installInputRef.current.focus();
    }
  }, [showInstallDialog]);

  // Focus input when create dialog opens
  useEffect(() => {
    if (showCreateDialog && createNameInputRef.current) {
      createNameInputRef.current.focus();
    }
  }, [showCreateDialog]);

  // Close skill menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (skillMenuRef.current && !skillMenuRef.current.contains(e.target as Node)) {
        setShowSkillMenu(false);
      }
    };

    if (showSkillMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSkillMenu]);

  // Refresh skills list
  const refreshSkills = async () => {
    try {
      const skls = await window.electronAPI.extensions.scanSkills(projectPath);
      setSkills(skls);
    } catch (err) {
      console.error('[Extensions Explorer] Error refreshing skills:', err);
    }
  };

  // Handle skill installation
  const handleInstallSkill = async () => {
    if (!installSource.trim()) return;

    setInstalling(true);
    setInstallResult(null);

    try {
      const result = await window.electronAPI.extensions.installSkill(installSource.trim(), {
        global: installGlobal,
        projectPath: projectPath,
      });

      if (result.success) {
        setInstallResult({ success: true, message: result.output || 'Skill installed successfully!' });
        // Refresh skills list after successful installation
        await refreshSkills();
        // Reset form after a delay
        setTimeout(() => {
          setShowInstallDialog(false);
          setInstallSource('');
          setInstallResult(null);
        }, 2000);
      } else {
        setInstallResult({ success: false, message: result.error || 'Installation failed' });
      }
    } catch (err) {
      setInstallResult({ success: false, message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setInstalling(false);
    }
  };

  // Handle dialog close
  const handleCloseInstallDialog = () => {
    if (!installing) {
      setShowInstallDialog(false);
      setInstallSource('');
      setInstallResult(null);
    }
  };

  // Handle create skill
  const handleCreateSkill = async () => {
    if (!newSkillName.trim()) return;

    // Validate skill name (alphanumeric, hyphens, underscores only)
    const validName = /^[a-zA-Z0-9_-]+$/.test(newSkillName.trim());
    if (!validName) {
      setCreateResult({ success: false, message: 'Skill name can only contain letters, numbers, hyphens, and underscores' });
      return;
    }

    setCreating(true);
    setCreateResult(null);

    try {
      // Determine the base path
      const basePath = newSkillGlobal
        ? `${await window.electronAPI.app.getPath('home')}/.claude/skills`
        : `${projectPath}/.claude/skills`;

      const skillDir = `${basePath}/${newSkillName.trim()}`;
      const skillFile = `${skillDir}/SKILL.md`;

      // Create directory and write file
      // First, ensure the skills directory exists
      const result = await window.electronAPI.fs.writeFile(skillFile, newSkillContent);

      if (result.success) {
        setCreateResult({ success: true, message: `Skill "${newSkillName}" created successfully!` });
        // Refresh skills list
        await refreshSkills();
        // Reset and close after delay
        setTimeout(() => {
          setShowCreateDialog(false);
          setNewSkillName('');
          setNewSkillContent(SKILL_TEMPLATE);
          setCreateResult(null);
        }, 2000);
      } else {
        setCreateResult({ success: false, message: result.error || 'Failed to create skill' });
      }
    } catch (err) {
      setCreateResult({ success: false, message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setCreating(false);
    }
  };

  // Handle create dialog close
  const handleCloseCreateDialog = () => {
    if (!creating) {
      setShowCreateDialog(false);
      setNewSkillName('');
      setNewSkillContent(SKILL_TEMPLATE);
      setCreateResult(null);
    }
  };

  const handleEditItem = async (item: Command | Skill | AgentDefinition) => {
    const isCommand = 'content' in item;
    const isAgent = 'systemPrompt' in item;

    let filePath: string;

    if (isCommand) {
      // Commands have direct path to .md file
      filePath = (item as Command).path;
    } else if (isAgent) {
      // Agents are stored as .md files in agents directory
      // We need to construct the path
      const agentName = item.name;
      if (item.scope === 'user') {
        // Use ~ for home directory (shell will expand it)
        filePath = `~/.claude/agents/${agentName}.md`;
      } else {
        filePath = `${projectPath}/.claude/agents/${agentName}.md`;
      }
    } else {
      // Skills have path to directory, need to append SKILL.md
      filePath = `${(item as Skill).path}/SKILL.md`;
    }

    // Open file in system default editor
    window.electronAPI.app.openExternal(`file://${filePath}`);
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

    const isAgent = 'systemPrompt' in selectedItem;
    // Commands have .md path, Skills have directory path (content in both now)
    const isCommand = !isAgent && 'content' in selectedItem && (selectedItem as Command).path.endsWith('.md');
    const isSkill = !isAgent && !isCommand;

    return (
      <div className="flex-1 overflow-y-auto border-l border-claude-border">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              {isCommand && <Terminal size={16} className="text-claude-accent" />}
              {isSkill && <Sparkles size={16} className="text-purple-400" />}
              {isAgent && <Bot size={16} className="text-blue-400" />}
              <div>
                <h3 className="text-sm font-mono text-claude-text">
                  {isCommand ? `/${selectedItem.name}` : isAgent ? `@agent-${selectedItem.name}` : (selectedItem as Skill).name}
                </h3>
                <p className="text-xs text-claude-text-secondary mt-1">
                  {selectedItem.scope === 'user' ? 'User Global' : 'Project'}
                  {(isCommand || !isAgent) && ` • ${(selectedItem as Command | Skill).path}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleEditItem(selectedItem)}
                className="p-1 hover:bg-claude-surface text-claude-text-secondary hover:text-claude-accent"
                title="Edit file"
              >
                <Edit3 size={14} />
              </button>
              <button
                onClick={() => copyToClipboard(isCommand ? `/${selectedItem.name}` : `@agent-${selectedItem.name}`)}
                className="p-1 hover:bg-claude-surface text-claude-text-secondary"
                title="Copy usage"
              >
                <Copy size={14} />
              </button>
            </div>
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

          {isSkill && (
            <div>
              <h4 className="text-xs font-mono text-claude-text-secondary uppercase mb-2">SKILL.md</h4>
              <pre className="text-xs text-claude-text bg-claude-surface p-3 overflow-x-auto font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
                {(selectedItem as Skill).content}
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
              {isSkill && `Type /${(selectedItem as Skill).name} to invoke this skill`}
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
          <div className="flex items-center relative">
            <button
              onClick={() => toggleType('skills')}
              className="flex-1 px-3 py-2 flex items-center gap-2 hover:bg-claude-surface transition-colors"
            >
              {expandedType === 'skills' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Sparkles size={14} className="text-purple-400" />
              <span className="text-sm font-mono text-claude-text">Skills</span>
              <span className="text-xs text-claude-text-secondary">({skills.length})</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowSkillMenu(!showSkillMenu);
              }}
              className="px-2 py-2 hover:bg-claude-surface text-claude-text-secondary hover:text-purple-400 transition-colors"
              title="Add skill"
            >
              <Plus size={14} />
            </button>

            {/* Skill action menu */}
            {showSkillMenu && (
              <div
                ref={skillMenuRef}
                className="absolute right-0 top-full mt-1 z-50 bg-claude-bg border border-claude-border shadow-lg min-w-48"
              >
                <button
                  onClick={() => {
                    setShowSkillMenu(false);
                    setShowCreateDialog(true);
                  }}
                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-claude-surface text-left transition-colors"
                >
                  <FileText size={14} className="text-purple-400" />
                  <div>
                    <span className="text-sm text-claude-text">Create New Skill</span>
                    <p className="text-xs text-claude-text-secondary">Write a skill from scratch</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setShowSkillMenu(false);
                    setShowInstallDialog(true);
                  }}
                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-claude-surface text-left transition-colors border-t border-claude-border"
                >
                  <Github size={14} className="text-claude-text-secondary" />
                  <div>
                    <span className="text-sm text-claude-text">Install from GitHub</span>
                    <p className="text-xs text-claude-text-secondary">Clone a skill repository</p>
                  </div>
                </button>
              </div>
            )}
          </div>
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

      {/* Install Skill Dialog */}
      {showInstallDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-claude-bg border border-claude-border w-96 max-w-[90%]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border">
              <div className="flex items-center gap-2">
                <Github size={16} className="text-claude-text-secondary" />
                <span className="text-sm font-mono text-claude-text">Install from GitHub</span>
              </div>
              <button
                onClick={handleCloseInstallDialog}
                className="text-claude-text-secondary hover:text-claude-text transition-colors"
                disabled={installing}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-mono text-claude-text-secondary uppercase mb-2">
                  GitHub Source
                </label>
                <input
                  ref={installInputRef}
                  type="text"
                  value={installSource}
                  onChange={(e) => setInstallSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !installing) {
                      handleInstallSkill();
                    } else if (e.key === 'Escape') {
                      handleCloseInstallDialog();
                    }
                  }}
                  placeholder="e.g., remotion-dev/skills"
                  className="w-full px-3 py-2 bg-claude-surface border border-claude-border text-sm font-mono text-claude-text placeholder:text-claude-text-secondary focus:outline-none focus:border-purple-500"
                  disabled={installing}
                />
                <p className="text-xs text-claude-text-secondary mt-1">
                  Enter a GitHub repo (user/repo) or full URL
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="installGlobal"
                  checked={installGlobal}
                  onChange={(e) => setInstallGlobal(e.target.checked)}
                  disabled={installing}
                  className="accent-purple-500"
                />
                <label htmlFor="installGlobal" className="text-xs text-claude-text-secondary">
                  Install globally (available in all projects)
                </label>
              </div>

              {/* Result message */}
              {installResult && (
                <div className={`flex items-start gap-2 p-3 ${installResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                  {installResult.success ? (
                    <Check size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  )}
                  <p className={`text-xs ${installResult.success ? 'text-green-500' : 'text-red-500'}`}>
                    {installResult.message}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-claude-border">
              <button
                onClick={handleCloseInstallDialog}
                className="px-3 py-1.5 text-xs font-mono text-claude-text-secondary hover:text-claude-text transition-colors"
                disabled={installing}
              >
                Cancel
              </button>
              <button
                onClick={handleInstallSkill}
                disabled={installing || !installSource.trim()}
                className="px-3 py-1.5 text-xs font-mono bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {installing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Plus size={12} />
                    Install
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Skill Dialog */}
      {showCreateDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-claude-bg border border-claude-border w-[600px] max-w-[95%] max-h-[90%] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-purple-400" />
                <span className="text-sm font-mono text-claude-text">Create New Skill</span>
              </div>
              <button
                onClick={handleCloseCreateDialog}
                className="text-claude-text-secondary hover:text-claude-text transition-colors"
                disabled={creating}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              {/* Skill Name */}
              <div>
                <label className="block text-xs font-mono text-claude-text-secondary uppercase mb-2">
                  Skill Name
                </label>
                <input
                  ref={createNameInputRef}
                  type="text"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleCloseCreateDialog();
                    }
                  }}
                  placeholder="my-skill-name"
                  className="w-full px-3 py-2 bg-claude-surface border border-claude-border text-sm font-mono text-claude-text placeholder:text-claude-text-secondary focus:outline-none focus:border-purple-500"
                  disabled={creating}
                />
                <p className="text-xs text-claude-text-secondary mt-1">
                  Use lowercase letters, numbers, hyphens, and underscores
                </p>
              </div>

              {/* Scope Selection */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="skillScope"
                    checked={!newSkillGlobal}
                    onChange={() => setNewSkillGlobal(false)}
                    disabled={creating || !projectPath}
                    className="accent-purple-500"
                  />
                  <FolderGit size={14} className="text-claude-text-secondary" />
                  <span className="text-xs text-claude-text">Project</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="skillScope"
                    checked={newSkillGlobal}
                    onChange={() => setNewSkillGlobal(true)}
                    disabled={creating}
                    className="accent-purple-500"
                  />
                  <User size={14} className="text-claude-text-secondary" />
                  <span className="text-xs text-claude-text">Global (all projects)</span>
                </label>
              </div>

              {/* Skill Content Editor */}
              <div className="flex-1">
                <label className="block text-xs font-mono text-claude-text-secondary uppercase mb-2">
                  SKILL.md Content
                </label>
                <textarea
                  value={newSkillContent}
                  onChange={(e) => setNewSkillContent(e.target.value)}
                  className="w-full h-64 px-3 py-2 bg-claude-surface border border-claude-border text-sm font-mono text-claude-text placeholder:text-claude-text-secondary focus:outline-none focus:border-purple-500 resize-none"
                  disabled={creating}
                  spellCheck={false}
                />
                <p className="text-xs text-claude-text-secondary mt-1">
                  Define your skill's behavior and instructions using Markdown
                </p>
              </div>

              {/* Result message */}
              {createResult && (
                <div className={`flex items-start gap-2 p-3 ${createResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                  {createResult.success ? (
                    <Check size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  )}
                  <p className={`text-xs ${createResult.success ? 'text-green-500' : 'text-red-500'}`}>
                    {createResult.message}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-claude-border flex-shrink-0">
              <button
                onClick={handleCloseCreateDialog}
                className="px-3 py-1.5 text-xs font-mono text-claude-text-secondary hover:text-claude-text transition-colors"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSkill}
                disabled={creating || !newSkillName.trim()}
                className="px-3 py-1.5 text-xs font-mono bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus size={12} />
                    Create Skill
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
