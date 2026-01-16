import WebSocket from 'ws';
import Store from 'electron-store';
import { EventEmitter } from 'events';
import { EMBEDDED_KEYS } from '../../shared/config/embedded-keys';

/**
 * ElevenLabs Conversational AI WebSocket Events
 * Note: ElevenLabs uses nested event objects like { type: 'x', x_event: { ... } }
 */
interface UserTranscriptEvent {
  type: 'user_transcript';
  user_transcription_event: {
    user_transcript: string;
    is_final?: boolean;
    event_id?: number;
  };
}

interface AgentResponseEvent {
  type: 'agent_response';
  agent_response_event: {
    agent_response: string;
    event_id: number;
  };
}

interface AudioResponseEvent {
  type: 'audio';
  audio_event: {
    audio_base_64: string;
    event_id: number;
  };
}

interface PingEvent {
  type: 'ping';
  ping_event: {
    event_id: number;
    ping_ms: number;
  };
}

interface InterruptionEvent {
  type: 'interruption';
  interruption_event: {
    reason: string;
  };
}

interface ClientToolCallEvent {
  type: 'client_tool_call';
  client_tool_call: {
    tool_call_id: string;
    tool_name: string;
    parameters: Record<string, unknown>;
  };
}

interface ConversationInitClientData {
  type: 'conversation_initiation_client_data';
  conversation_initiation_client_data?: {
    conversation_config_override?: {
      agent?: {
        prompt?: {
          prompt: string;
        };
      };
    };
    custom_llm_extra_body?: Record<string, unknown>;
  };
}

type ElevenLabsServerEvent =
  | UserTranscriptEvent
  | AgentResponseEvent
  | AudioResponseEvent
  | PingEvent
  | InterruptionEvent
  | ClientToolCallEvent
  | { type: string; [key: string]: unknown };

export interface VoiceSessionConfig {
  agentId: string;
  systemPrompt?: string;
  sessionContext?: Record<string, unknown>;
}

/**
 * ElevenLabs Voice Service
 *
 * Handles bidirectional voice communication using ElevenLabs Conversational AI.
 * - Receives user audio → transcribes → emits transcript
 * - Receives text to speak → returns audio chunks
 */
export class ElevenLabsVoiceService extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private agentId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private intentionalDisconnect = false;

  constructor() {
    super();
    this.store = new Store({ name: 'claudette-settings' });
  }

  /**
   * Get ElevenLabs API key (user-provided or embedded)
   */
  private getApiKey(): string | undefined {
    const userKey = this.store.get('elevenLabsApiKey') as string | undefined;
    if (userKey) return userKey;
    return EMBEDDED_KEYS.elevenLabs || undefined;
  }

  /**
   * Update the agent's system prompt via the ElevenLabs API
   */
  async updateAgentPrompt(agentId: string, prompt: string): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    console.log('[ElevenLabsVoice] Updating agent prompt for:', agentId);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${agentId}`,
      {
        method: 'PATCH',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation_config: {
            agent: {
              prompt: {
                prompt: prompt,
              },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[ElevenLabsVoice] Failed to update agent prompt:', error);
      throw new Error(`Failed to update agent prompt: ${error}`);
    }

    console.log('[ElevenLabsVoice] Agent prompt updated successfully');
  }

  /**
   * Get a signed URL for WebSocket connection (for private agents)
   */
  private async getSignedUrl(agentId: string): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get signed URL: ${error}`);
    }

    const data = await response.json();
    return data.signed_url;
  }

  /**
   * Connect to ElevenLabs Conversational AI
   */
  async connect(config: VoiceSessionConfig): Promise<void> {
    const { agentId, systemPrompt, sessionContext } = config;
    this.agentId = agentId;
    this.intentionalDisconnect = false;

    return new Promise(async (resolve, reject) => {
      try {
        // For public agents, connect directly; for private, get signed URL
        let wsUrl: string;
        try {
          wsUrl = await this.getSignedUrl(agentId);
          console.log('[ElevenLabsVoice] Got signed URL');
        } catch {
          // Fallback to direct connection for public agents
          wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
          console.log('[ElevenLabsVoice] Using direct connection URL');
        }

        console.log('[ElevenLabsVoice] Connecting to:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          console.log('[ElevenLabsVoice] WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // Send conversation initiation data with optional config
          const initData: ConversationInitClientData = {
            type: 'conversation_initiation_client_data',
          };

          if (systemPrompt || sessionContext) {
            initData.conversation_initiation_client_data = {};

            if (systemPrompt) {
              initData.conversation_initiation_client_data.conversation_config_override = {
                agent: {
                  prompt: {
                    prompt: systemPrompt,
                  },
                },
              };
            }

            if (sessionContext) {
              initData.conversation_initiation_client_data.custom_llm_extra_body = sessionContext;
            }
          }

          this.ws?.send(JSON.stringify(initData));
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const event = JSON.parse(data.toString()) as ElevenLabsServerEvent;
            this.handleServerEvent(event);
          } catch (e) {
            console.error('[ElevenLabsVoice] Failed to parse message:', e);
          }
        });

        this.ws.on('error', (error) => {
          console.error('[ElevenLabsVoice] WebSocket error:', error);
          this.emit('error', error.message);
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.ws.on('close', (code, reason) => {
          console.log('[ElevenLabsVoice] WebSocket closed:', code, reason.toString());
          this.isConnected = false;
          this.ws = null;

          if (!this.intentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 5000);
            console.log(`[ElevenLabsVoice] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
            this.emit('reconnecting', { attempt: this.reconnectAttempts, maxAttempts: this.maxReconnectAttempts });

            setTimeout(async () => {
              try {
                await this.connect(config);
                this.emit('reconnected');
              } catch (error) {
                console.error('[ElevenLabsVoice] Reconnection failed:', error);
                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                  this.emit('reconnect_failed');
                  this.emit('disconnected');
                }
              }
            }, delay);
          } else {
            this.emit('disconnected');
          }
        });

      } catch (error) {
        console.error('[ElevenLabsVoice] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle server events
   */
  private handleServerEvent(event: ElevenLabsServerEvent): void {
    console.log('[ElevenLabsVoice] Received event:', event.type, JSON.stringify(event).slice(0, 500));

    switch (event.type) {
      case 'user_transcript': {
        const transcriptEvent = event as UserTranscriptEvent;
        const text = transcriptEvent.user_transcription_event?.user_transcript || '';
        // ElevenLabs user_transcript events are "finalized speech-to-text results"
        // They don't have an is_final field - they ARE final
        // However, "..." indicates interim silence, so treat those as non-final
        const isFinal = text.trim() !== '' && text.trim() !== '...';
        console.log('[ElevenLabsVoice] User transcript:', text, 'final:', isFinal);
        this.emit('user_transcript', {
          text,
          isFinal,
        });
        break;
      }

      case 'agent_response': {
        const responseEvent = event as AgentResponseEvent;
        const text = responseEvent.agent_response_event?.agent_response || '';
        console.log('[ElevenLabsVoice] Agent response:', text);
        this.emit('agent_response', text);
        break;
      }

      case 'audio': {
        const audioEvent = event as AudioResponseEvent;
        // Decode base64 audio and emit
        const audioBuffer = Buffer.from(audioEvent.audio_event.audio_base_64, 'base64');
        this.emit('audio', {
          data: audioBuffer,
          eventId: audioEvent.audio_event.event_id,
        });
        break;
      }

      case 'ping': {
        const pingEvent = event as PingEvent;
        // Respond to ping to keep connection alive
        setTimeout(() => {
          this.sendMessage({
            type: 'pong',
            event_id: pingEvent.ping_event.event_id,
          });
        }, pingEvent.ping_event.ping_ms);
        break;
      }

      case 'interruption': {
        const interruptEvent = event as InterruptionEvent;
        console.log('[ElevenLabsVoice] Interruption:', interruptEvent.interruption_event.reason);
        this.emit('interruption', interruptEvent.interruption_event.reason);
        break;
      }

      case 'client_tool_call': {
        const toolEvent = event as ClientToolCallEvent;
        console.log('[ElevenLabsVoice] Tool call:', toolEvent.client_tool_call.tool_name, toolEvent.client_tool_call.parameters);
        this.emit('client_tool_call', {
          toolCallId: toolEvent.client_tool_call.tool_call_id,
          toolName: toolEvent.client_tool_call.tool_name,
          parameters: toolEvent.client_tool_call.parameters,
        });
        break;
      }

      default:
        console.log('[ElevenLabsVoice] Unknown event type:', event.type);
    }
  }

  /**
   * Send a message to the WebSocket
   */
  private sendMessage(message: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ElevenLabsVoice] Cannot send message, WebSocket not connected');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send audio data for speech-to-text
   * Audio should be 16kHz PCM16 mono, base64 encoded
   */
  sendAudio(audioData: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ElevenLabsVoice] Cannot send audio, WebSocket not connected');
      return;
    }

    const base64Audio = audioData.toString('base64');
    this.sendMessage({
      user_audio_chunk: base64Audio,
    });
  }

  /**
   * Send text for the agent to speak (status announcement)
   * Uses user_message with [STATUS] prefix to trigger verbatim speech.
   * The agent's prompt must include instructions to speak [STATUS] messages verbatim.
   */
  sendTextForTTS(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ElevenLabsVoice] Cannot send text, WebSocket not connected');
      return;
    }

    // Use [STATUS] prefix - agent prompt should recognize this and speak verbatim
    const formattedText = `[STATUS] ${text}`;
    console.log('[ElevenLabsVoice] Sending status announcement:', formattedText);

    this.sendMessage({
      type: 'user_message',  // Correct type per ElevenLabs spec
      text: formattedText,
    });
  }

  /**
   * Send user activity signal to reset turn timeout timer
   * Prevents "are you there?" prompts during extended work periods
   */
  sendUserActivity(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.sendMessage({ type: 'user_activity' });
  }

  /**
   * Send contextual update (for informing the agent of state changes)
   */
  sendContextUpdate(context: string): void {
    console.log('[ElevenLabsVoice] sendContextUpdate called, length:', context.length);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ElevenLabsVoice] Cannot send context update - WebSocket not connected, readyState:', this.ws?.readyState);
      return;
    }
    this.sendMessage({
      type: 'contextual_update',
      text: context,
    });
    console.log('[ElevenLabsVoice] Context update sent successfully');
  }

  /**
   * Signal end of user input
   */
  endUserInput(): void {
    this.sendMessage({
      type: 'user_input_complete',
    });
  }

  /**
   * Send tool result back to ElevenLabs
   * Called after executing a client tool to provide the result
   */
  sendToolResult(toolCallId: string, result: string, isError = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ElevenLabsVoice] Cannot send tool result, WebSocket not connected');
      return;
    }

    console.log('[ElevenLabsVoice] Sending tool result for:', toolCallId, 'error:', isError);
    this.sendMessage({
      type: 'client_tool_result',
      tool_call_id: toolCallId,
      result: result,
      is_error: isError,
    });
  }

  /**
   * Disconnect from the service
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.reconnectAttempts = 0;

    if (this.ws) {
      console.log('[ElevenLabsVoice] Disconnecting...');
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.agentId = null;
    }
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let voiceServiceInstance: ElevenLabsVoiceService | null = null;

export function getElevenLabsVoiceService(): ElevenLabsVoiceService {
  if (!voiceServiceInstance) {
    voiceServiceInstance = new ElevenLabsVoiceService();
  }
  return voiceServiceInstance;
}
