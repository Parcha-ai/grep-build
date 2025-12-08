import Store from 'electron-store';
import crypto from 'crypto';
import type { GitHubUser, GitHubRepo } from '../../shared/types';

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

export class AuthService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  private pkceVerifier: string | null = null;

  // These should come from environment variables in production
  private readonly CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
  private readonly CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
  private readonly REDIRECT_URI = 'grep://oauth/callback';

  constructor() {
    this.store = new Store({
      name: 'grep-auth',
      encryptionKey: 'grep-secure-v1',
    });
  }

  private generatePKCE(): PKCEPair {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  async initiateOAuth(): Promise<string> {
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    this.pkceVerifier = codeVerifier;

    const state = crypto.randomBytes(16).toString('hex');
    this.store.set('oauth_state', state);

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', this.CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', this.REDIRECT_URI);
    authUrl.searchParams.set('scope', 'repo read:user user:email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return authUrl.toString();
  }

  async exchangeCode(code: string): Promise<AuthTokens> {
    if (!this.pkceVerifier) {
      throw new Error('PKCE verifier not found');
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.CLIENT_ID,
        client_secret: this.CLIENT_SECRET,
        code,
        redirect_uri: this.REDIRECT_URI,
        code_verifier: this.pkceVerifier,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange authorization code');
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    const tokens: AuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };

    // Store tokens securely
    this.store.set('tokens', tokens);
    this.pkceVerifier = null;

    return tokens;
  }

  async logout(): Promise<void> {
    this.store.delete('tokens');
    this.store.delete('user');
    this.store.delete('oauth_state');
  }

  getAccessToken(): string | null {
    const tokens = this.store.get('tokens') as AuthTokens | undefined;
    return tokens?.accessToken || null;
  }

  async getUser(): Promise<GitHubUser | null> {
    const accessToken = this.getAccessToken();
    if (!accessToken) return null;

    // Check cached user
    const cachedUser = this.store.get('user') as GitHubUser | undefined;
    if (cachedUser) return cachedUser;

    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          await this.logout();
          return null;
        }
        throw new Error('Failed to fetch user');
      }

      const data = await response.json();

      const user: GitHubUser = {
        id: data.id,
        login: data.login,
        name: data.name || data.login,
        email: data.email || '',
        avatarUrl: data.avatar_url,
      };

      this.store.set('user', user);
      return user;
    } catch (error) {
      console.error('Error fetching user:', error);
      return null;
    }
  }

  async getRepos(): Promise<GitHubRepo[]> {
    const accessToken = this.getAccessToken();
    if (!accessToken) return [];

    try {
      const response = await fetch(
        'https://api.github.com/user/repos?sort=updated&per_page=100',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch repos');
      }

      const data = await response.json();

      return data.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description || '',
        private: repo.private,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url,
        defaultBranch: repo.default_branch,
        updatedAt: repo.updated_at,
      }));
    } catch (error) {
      console.error('Error fetching repos:', error);
      return [];
    }
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }
}
