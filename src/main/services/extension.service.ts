import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface Command {
  name: string;
  path: string;
  content: string;
  description?: string;
  scope: 'user' | 'project';
}

export interface Skill {
  name: string;
  path: string;
  description?: string;
  scope: 'user' | 'project';
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  disallowedTools?: string[];
  model?: string;
  scope: 'user' | 'project';
}

export class ExtensionService {
  // Find all .claude directories recursively within a project
  private async findClaudeDirs(rootPath: string, maxDepth: number = 3): Promise<string[]> {
    const claudeDirs: string[] = [];

    const scan = async (dir: string, depth: number) => {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dir, entry.name);

          // Skip node_modules, .git, and other common build/cache directories
          if (entry.name === 'node_modules' || entry.name === '.git' ||
              entry.name === 'dist' || entry.name === 'build' ||
              entry.name === '.next' || entry.name === 'target') {
            continue;
          }

          // If this is a .claude directory, add it
          if (entry.name === '.claude') {
            claudeDirs.push(fullPath);
          } else {
            // Otherwise, recurse into subdirectories
            await scan(fullPath, depth + 1);
          }
        }
      } catch (err) {
        // Ignore permission errors, etc.
      }
    };

    await scan(rootPath, 0);
    return claudeDirs;
  }

  async scanCommands(projectPath?: string): Promise<Command[]> {
    const commands: Command[] = [];

    // Scan user commands
    const userCommandsDir = path.join(os.homedir(), '.claude', 'commands');
    console.log('[ExtensionService] Scanning user commands:', userCommandsDir);
    const userCommands = await this.scanCommandsRec(userCommandsDir, 'user', '');
    console.log('[ExtensionService] Found user commands:', userCommands.length);
    commands.push(...userCommands);

    // Scan ALL .claude directories in project tree
    if (projectPath) {
      console.log('[ExtensionService] Finding all .claude directories in:', projectPath);
      const claudeDirs = await this.findClaudeDirs(projectPath);
      console.log('[ExtensionService] Found .claude directories:', claudeDirs);

      for (const claudeDir of claudeDirs) {
        const commandsDir = path.join(claudeDir, 'commands');
        console.log('[ExtensionService] Scanning project commands:', commandsDir);
        const projectCommands = await this.scanCommandsRec(commandsDir, 'project', '');
        console.log('[ExtensionService] Found commands in', commandsDir, ':', projectCommands.length);
        commands.push(...projectCommands);
      }
    } else {
      console.log('[ExtensionService] No projectPath provided for commands scan');
    }

    console.log('[ExtensionService] Total commands:', commands.length, commands.map(c => `${c.name} (${c.scope})`));
    return commands;
  }

  private async scanCommandsRec(dir: string, scope: 'user' | 'project', namespace: string): Promise<Command[]> {
    const commands: Command[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const newNamespace = namespace ? `${namespace}:${entry.name}` : entry.name;
          const subCommands = await this.scanCommandsRec(fullPath, scope, newNamespace);
          commands.push(...subCommands);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const baseName = entry.name.replace('.md', '');
          const name = namespace ? `${namespace}:${baseName}` : baseName;

          const lines = content.split('\n');
          const firstLine = lines[0]?.trim();
          const description = firstLine?.startsWith('<!--') && firstLine.endsWith('-->')
            ? firstLine.replace(/^<!--\s*/, '').replace(/\s*-->$/, '')
            : undefined;

          commands.push({ name, path: fullPath, content, description, scope });
        }
      }
    } catch (err) {
      // Ignore
    }

    return commands;
  }

  async scanSkills(projectPath?: string): Promise<Skill[]> {
    const skills: Skill[] = [];

    const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    console.log('[ExtensionService] Scanning user skills:', userSkillsDir);
    const userSkills = await this.scanSkillsRec(userSkillsDir, 'user');
    console.log('[ExtensionService] Found user skills:', userSkills.length);
    skills.push(...userSkills);

    // Scan ALL .claude directories in project tree
    if (projectPath) {
      console.log('[ExtensionService] Finding all .claude directories in:', projectPath);
      const claudeDirs = await this.findClaudeDirs(projectPath);
      console.log('[ExtensionService] Found .claude directories:', claudeDirs);

      for (const claudeDir of claudeDirs) {
        const skillsDir = path.join(claudeDir, 'skills');
        console.log('[ExtensionService] Scanning project skills:', skillsDir);
        const projectSkills = await this.scanSkillsRec(skillsDir, 'project');
        console.log('[ExtensionService] Found skills in', skillsDir, ':', projectSkills.length);
        skills.push(...projectSkills);
      }
    } else {
      console.log('[ExtensionService] No projectPath provided for skills scan');
    }

    console.log('[ExtensionService] Total skills:', skills.length, skills.map(s => `${s.name} (${s.scope})`));
    return skills;
  }

  private async scanSkillsRec(dir: string, scope: 'user' | 'project'): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = path.join(dir, entry.name);
          const skillFile = path.join(skillDir, 'SKILL.md');

          try {
            const content = await fs.readFile(skillFile, 'utf-8');
            const lines = content.split('\n');
            const firstLine = lines[0]?.trim();
            const description = firstLine?.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : undefined;

            skills.push({ name: entry.name, path: skillDir, description, scope });
          } catch (err) {
            const subSkills = await this.scanSkillsRec(skillDir, scope);
            skills.push(...subSkills);
          }
        }
      }
    } catch (err) {
      // Ignore
    }

    return skills;
  }

  async scanAgents(projectPath?: string): Promise<AgentDefinition[]> {
    const agents: AgentDefinition[] = [];

    const userAgentsDir = path.join(os.homedir(), '.claude', 'agents');
    console.log('[ExtensionService] Scanning user agents:', userAgentsDir);
    const userAgents = await this.scanAgentsRec(userAgentsDir, 'user');
    console.log('[ExtensionService] Found user agents:', userAgents.length);
    agents.push(...userAgents);

    // Scan ALL .claude directories in project tree
    if (projectPath) {
      console.log('[ExtensionService] Finding all .claude directories in:', projectPath);
      const claudeDirs = await this.findClaudeDirs(projectPath);
      console.log('[ExtensionService] Found .claude directories:', claudeDirs);

      for (const claudeDir of claudeDirs) {
        const agentsDir = path.join(claudeDir, 'agents');
        console.log('[ExtensionService] Scanning project agents:', agentsDir);
        const projectAgents = await this.scanAgentsRec(agentsDir, 'project');
        console.log('[ExtensionService] Found agents in', agentsDir, ':', projectAgents.length);
        agents.push(...projectAgents);
      }
    } else {
      console.log('[ExtensionService] No projectPath provided for agents scan');
    }

    console.log('[ExtensionService] Total agents:', agents.length, agents.map(a => `${a.name} (${a.scope})`));
    return agents;
  }

  private async scanAgentsRec(dir: string, scope: 'user' | 'project'): Promise<AgentDefinition[]> {
    const agents: AgentDefinition[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subAgents = await this.scanAgentsRec(fullPath, scope);
          agents.push(...subAgents);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const name = entry.name.replace('.md', '');
          const agent = this.parseAgent(content, name, scope);
          if (agent) {
            agents.push(agent);
          }
        }
      }
    } catch (err) {
      // Ignore
    }

    return agents;
  }

  private parseAgent(content: string, name: string, scope: 'user' | 'project'): AgentDefinition | null {
    const lines = content.split('\n');
    let description = '';
    let systemPrompt = '';
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ')) {
        currentSection = 'description';
        continue;
      } else if (trimmed.startsWith('## System Prompt') || trimmed.startsWith('## Prompt')) {
        currentSection = 'systemPrompt';
        continue;
      }

      if (currentSection === 'description' && trimmed) {
        description += trimmed + ' ';
      } else if (currentSection === 'systemPrompt') {
        systemPrompt += line + '\n';
      }
    }

    if (!description || !systemPrompt) {
      return null;
    }

    return { name, description: description.trim(), systemPrompt: systemPrompt.trim(), scope };
  }

  async getCommandContent(cmdName: string, projPath?: string): Promise<string | null> {
    const cmds = await this.scanCommands(projPath);
    for (const cmd of cmds) {
      if (cmd.name === cmdName) {
        return cmd.content;
      }
    }
    return null;
  }
}

export const extensionService = new ExtensionService();
