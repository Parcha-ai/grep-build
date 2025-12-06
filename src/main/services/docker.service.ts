import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { v4 as uuid } from 'uuid';
import type { Session, PortAllocation, ContainerStats } from '../../shared/types';

const BASE_PORT = 10000;
const PORTS_PER_SESSION = 10;

export class DockerService {
  private docker: Docker;
  private allocatedPorts: Set<number> = new Set();

  constructor() {
    this.docker = new Docker();
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string }> {
    try {
      const info = await this.docker.info();
      return { available: true, version: info.ServerVersion };
    } catch {
      return { available: false };
    }
  }

  allocatePorts(sessionIndex: number): PortAllocation {
    const basePort = BASE_PORT + (sessionIndex * PORTS_PER_SESSION);
    const ports: PortAllocation = {
      web: basePort,
      api: basePort + 1,
      debug: basePort + 2,
    };

    // Track allocated ports
    this.allocatedPorts.add(ports.web);
    this.allocatedPorts.add(ports.api);
    this.allocatedPorts.add(ports.debug);

    return ports;
  }

  releasePorts(ports: PortAllocation): void {
    this.allocatedPorts.delete(ports.web);
    this.allocatedPorts.delete(ports.api);
    this.allocatedPorts.delete(ports.debug);
  }

  async generateComposeFile(session: Session): Promise<string> {
    const composeConfig = {
      version: '3.8',
      services: {
        'claude-session': {
          build: {
            context: session.repoPath,
            dockerfile: 'Dockerfile',
          },
          container_name: `claudette-${session.id}`,
          volumes: [
            `${session.worktreePath}:/workspace:delegated`,
          ],
          working_dir: '/workspace',
          environment: [
            `CLAUDE_SESSION_ID=${session.id}`,
            'TERM=xterm-256color',
          ],
          ports: [
            `${session.ports.web}:3000`,
            `${session.ports.api}:8000`,
            `${session.ports.debug}:9229`,
          ],
          networks: ['claudette'],
          stdin_open: true,
          tty: true,
        },
      },
      networks: {
        claudette: {
          driver: 'bridge',
        },
      },
    };

    const composePath = path.join(session.worktreePath, '.claudette', 'docker-compose.yml');
    await fs.mkdir(path.dirname(composePath), { recursive: true });
    await fs.writeFile(composePath, yaml.stringify(composeConfig));

    return composePath;
  }

  async createDefaultDockerfile(repoPath: string): Promise<void> {
    const dockerfilePath = path.join(repoPath, 'Dockerfile.claudette');

    try {
      await fs.access(dockerfilePath);
      return; // File already exists
    } catch {
      // File doesn't exist, create it
    }

    const dockerfile = `FROM node:20-slim

# Install essential tools
RUN apt-get update && apt-get install -y \\
    git \\
    curl \\
    wget \\
    vim \\
    nano \\
    htop \\
    jq \\
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -ms /bin/bash claude
USER claude
WORKDIR /workspace

# Set up nice prompt
ENV PS1='\\[\\033[01;32m\\]claudette\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '

# Default command - keep container running
CMD ["sleep", "infinity"]
`;

    await fs.writeFile(dockerfilePath, dockerfile);
  }

  async startContainer(session: Session): Promise<string> {
    const containerName = `claudette-${session.id}`;

    // Check if container already exists
    try {
      const existing = this.docker.getContainer(containerName);
      const info = await existing.inspect();
      if (info.State.Running) {
        return info.Id;
      }
      // Start existing stopped container
      await existing.start();
      return info.Id;
    } catch {
      // Container doesn't exist, create it
    }

    // Determine Dockerfile to use
    let dockerfile = 'Dockerfile.claudette';
    try {
      await fs.access(path.join(session.repoPath, 'Dockerfile'));
      dockerfile = 'Dockerfile';
    } catch {
      // Use default claudette dockerfile
      await this.createDefaultDockerfile(session.repoPath);
    }

    // Build image
    const imageName = `claudette-session-${session.id}`;
    const buildStream = await this.docker.buildImage(
      {
        context: session.repoPath,
        src: [dockerfile],
      },
      { t: imageName, dockerfile }
    );

    // Wait for build to complete
    await new Promise((resolve, reject) => {
      this.docker.modem.followProgress(buildStream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });

    // Create and start container
    const container = await this.docker.createContainer({
      name: containerName,
      Image: imageName,
      Tty: true,
      OpenStdin: true,
      WorkingDir: '/workspace',
      Env: [
        `CLAUDE_SESSION_ID=${session.id}`,
        'TERM=xterm-256color',
      ],
      HostConfig: {
        Binds: [`${session.worktreePath}:/workspace:delegated`],
        PortBindings: {
          '3000/tcp': [{ HostPort: String(session.ports.web) }],
          '8000/tcp': [{ HostPort: String(session.ports.api) }],
          '9229/tcp': [{ HostPort: String(session.ports.debug) }],
        },
        Memory: 4 * 1024 * 1024 * 1024, // 4GB
        CpuQuota: 200000, // 2 CPUs
      },
      ExposedPorts: {
        '3000/tcp': {},
        '8000/tcp': {},
        '9229/tcp': {},
      },
    });

    await container.start();
    return container.id;
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 });
    } catch (error: any) {
      if (error.statusCode !== 304) { // Not modified = already stopped
        throw error;
      }
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }
  }

  async getContainerStats(containerId: string): Promise<ContainerStats> {
    const container = this.docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
                     stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage -
                        stats.precpu_stats.system_cpu_usage;
    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

    return {
      cpuPercent,
      memoryUsage: stats.memory_stats.usage,
      memoryLimit: stats.memory_stats.limit,
      networkRx: stats.networks?.eth0?.rx_bytes || 0,
      networkTx: stats.networks?.eth0?.tx_bytes || 0,
    };
  }

  async exec(containerId: string, command: string): Promise<{ stdout: string; stderr: string }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      stream.on('data', (chunk: Buffer) => {
        // Docker multiplexes stdout and stderr
        const header = chunk.slice(0, 8);
        const type = header[0];
        const payload = chunk.slice(8).toString();

        if (type === 1) {
          stdout += payload;
        } else if (type === 2) {
          stderr += payload;
        }
      });

      stream.on('end', () => resolve({ stdout, stderr }));
      stream.on('error', reject);
    });
  }

  async attachToContainer(containerId: string): Promise<NodeJS.ReadWriteStream> {
    const container = this.docker.getContainer(containerId);
    return container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
    });
  }
}
