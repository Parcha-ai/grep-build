import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Check, AlertCircle, Save, Sparkles } from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import { useAudioStore } from '../../stores/audio.store';
import ReleaseNotes from '../common/ReleaseNotes';

export default function SettingsDialog() {
  const { isSettingsOpen, closeSettings } = useUIStore();
  const { settings: audioSettings, availableVoices, loadSettings, loadVoices, updateSettings } = useAudioStore();

  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const [elevenlabsApiKey, setElevenlabsApiKey] = useState('');
  const [showElevenlabsApiKey, setShowElevenlabsApiKey] = useState(false);

  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [showOpenaiApiKey, setShowOpenaiApiKey] = useState(false);

  const [selectedVoice, setSelectedVoice] = useState('');
  const [voiceTriggerWord, setVoiceTriggerWord] = useState('please');
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState('');
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [ralphLoopEnabled, setRalphLoopEnabled] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isLoading, setIsLoading] = useState(true);

  // Load all settings on open
  useEffect(() => {
    if (isSettingsOpen) {
      setIsLoading(true);
      Promise.all([
        window.electronAPI.settings.getApiKey(),
        window.electronAPI.audio.getElevenLabsKey(),
        window.electronAPI.audio.getOpenAiKey(),
        loadSettings(),
      ])
        .then(([anthropicKey, elevenLabsKey, openAiKey]) => {
          setApiKey(anthropicKey || '');
          setElevenlabsApiKey(elevenLabsKey || '');
          setOpenaiApiKey(openAiKey || '');
          setIsLoading(false);

          // Load voices after setting API key
          if (elevenLabsKey) {
            loadVoices();
          }
        })
        .catch((error) => {
          console.error('Failed to load settings:', error);
          setIsLoading(false);
        });
    }
  }, [isSettingsOpen, loadSettings, loadVoices]);

  // Update local state when audio settings load
  useEffect(() => {
    if (audioSettings) {
      setSelectedVoice(audioSettings.selectedVoice || '');
      setVoiceTriggerWord(audioSettings.voiceTriggerWord || 'please');
      setElevenLabsAgentId(audioSettings.elevenLabsAgentId || '');
      setVoiceModeEnabled(audioSettings.voiceModeEnabled || false);
      setRalphLoopEnabled(audioSettings.ralphLoopEnabled || false);
    }
  }, [audioSettings]);

  // Reset status after delay
  useEffect(() => {
    if (saveStatus !== 'idle') {
      const timer = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save all API keys
      await Promise.all([
        window.electronAPI.settings.setApiKey(apiKey),
        window.electronAPI.audio.setElevenLabsKey(elevenlabsApiKey),
        window.electronAPI.audio.setOpenAiKey(openaiApiKey),
      ]);

      // Save audio settings (voice selection, trigger word, agent ID, voice mode, ralph loop)
      if (audioSettings) {
        await updateSettings({
          selectedVoice,
          voiceTriggerWord,
          elevenLabsAgentId,
          voiceModeEnabled,
          ralphLoopEnabled,
          voiceSettings: {
            ...audioSettings.voiceSettings,
            voiceId: selectedVoice,
          },
        });
      }

      // Reload voices if ElevenLabs key was updated
      if (elevenlabsApiKey) {
        loadVoices();
      }

      setSaveStatus('success');
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
    }
    setIsSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSettings();
    }
  };

  if (!isSettingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={closeSettings}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto bg-claude-surface border border-claude-border"
        onClick={(e) => e.stopPropagation()}
        style={{ borderRadius: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border sticky top-0 bg-claude-surface z-10">
          <h2 className="text-sm font-mono font-bold text-claude-text uppercase tracking-wider">
            Settings
          </h2>
          <button
            onClick={closeSettings}
            className="p-1 text-claude-text-secondary hover:text-claude-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Anthropic API Key Section */}
          <div className="space-y-2">
            <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
              Anthropic API Key (Required)
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isLoading ? 'Loading...' : 'sk-ant-...'}
                disabled={isLoading}
                className="w-full px-3 py-2 pr-10 bg-claude-bg border border-claude-border text-claude-text font-mono text-sm placeholder:text-claude-text-secondary focus:outline-none focus:border-claude-accent disabled:opacity-50"
                style={{ borderRadius: 0 }}
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-claude-text-secondary hover:text-claude-text"
                type="button"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[10px] font-mono text-claude-text-secondary">
              Get your API key from{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  window.electronAPI.app?.openExternal?.('https://console.anthropic.com/settings/keys');
                }}
                className="text-claude-accent hover:underline"
              >
                console.anthropic.com
              </a>
            </p>
          </div>

          {/* Audio Settings Section */}
          <div className="space-y-4 pt-4 border-t border-claude-border">
            <h3 className="text-xs font-mono text-claude-text uppercase tracking-wider">
              Voice Features (Optional)
            </h3>

            {/* OpenAI API Key */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                OpenAI API Key (Speech-to-Text)
              </label>
              <div className="relative">
                <input
                  type={showOpenaiApiKey ? 'text' : 'password'}
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder={isLoading ? 'Loading...' : 'sk-...'}
                  disabled={isLoading}
                  className="w-full px-3 py-2 pr-10 bg-claude-bg border border-claude-border text-claude-text font-mono text-sm placeholder:text-claude-text-secondary focus:outline-none focus:border-claude-accent disabled:opacity-50"
                  style={{ borderRadius: 0 }}
                />
                <button
                  onClick={() => setShowOpenaiApiKey(!showOpenaiApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-claude-text-secondary hover:text-claude-text"
                  type="button"
                >
                  {showOpenaiApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] font-mono text-claude-text-secondary">
                For voice transcription using Whisper.{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.electronAPI.app?.openExternal?.('https://platform.openai.com/api-keys');
                  }}
                  className="text-claude-accent hover:underline"
                >
                  Get key
                </a>
              </p>
            </div>

            {/* ElevenLabs API Key */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                ElevenLabs API Key (Text-to-Speech)
              </label>
              <div className="relative">
                <input
                  type={showElevenlabsApiKey ? 'text' : 'password'}
                  value={elevenlabsApiKey}
                  onChange={(e) => setElevenlabsApiKey(e.target.value)}
                  placeholder={isLoading ? 'Loading...' : 'Enter ElevenLabs API key'}
                  disabled={isLoading}
                  className="w-full px-3 py-2 pr-10 bg-claude-bg border border-claude-border text-claude-text font-mono text-sm placeholder:text-claude-text-secondary focus:outline-none focus:border-claude-accent disabled:opacity-50"
                  style={{ borderRadius: 0 }}
                />
                <button
                  onClick={() => setShowElevenlabsApiKey(!showElevenlabsApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-claude-text-secondary hover:text-claude-text"
                  type="button"
                >
                  {showElevenlabsApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] font-mono text-claude-text-secondary">
                For voice playback of responses.{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.electronAPI.app?.openExternal?.('https://elevenlabs.io/api');
                  }}
                  className="text-claude-accent hover:underline"
                >
                  Get key
                </a>
              </p>
            </div>

            {/* Voice Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                Voice
              </label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={isLoading || availableVoices.length === 0}
                className="w-full px-3 py-2 bg-claude-bg border border-claude-border text-claude-text font-mono text-sm focus:outline-none focus:border-claude-accent disabled:opacity-50"
                style={{ borderRadius: 0 }}
              >
                {availableVoices.length === 0 ? (
                  <option value="">Add ElevenLabs API key to select voice</option>
                ) : (
                  availableVoices.map((voice) => (
                    <option key={voice.voice_id} value={voice.voice_id}>
                      {voice.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Voice Trigger Word */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                Voice Trigger Word
              </label>
              <input
                type="text"
                value={voiceTriggerWord}
                onChange={(e) => setVoiceTriggerWord(e.target.value.toLowerCase().trim())}
                placeholder="please"
                disabled={isLoading}
                className="w-full px-3 py-2 bg-claude-bg border border-claude-border text-claude-text font-mono text-sm placeholder:text-claude-text-secondary focus:outline-none focus:border-claude-accent disabled:opacity-50"
                style={{ borderRadius: 0 }}
              />
              <p className="text-[10px] font-mono text-claude-text-secondary">
                Say this word at the end of your message to auto-submit (e.g., "please", "send", "over")
              </p>
            </div>
          </div>

          {/* Grep It Mode Section */}
          <div className="space-y-4 pt-4 border-t border-claude-border">
            <h3 className="text-xs font-mono text-claude-text uppercase tracking-wider">
              Grep It Mode
            </h3>

            {/* Ralph Loop Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                  Ralph Loop (Persistent Work)
                </label>
                <p className="text-[10px] font-mono text-claude-text-secondary mt-1">
                  Agent keeps working until task is objectively complete
                </p>
              </div>
              <button
                onClick={() => setRalphLoopEnabled(!ralphLoopEnabled)}
                disabled={isLoading}
                className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                  ralphLoopEnabled ? 'bg-purple-500' : 'bg-claude-border'
                } disabled:opacity-50`}
                style={{ borderRadius: 0 }}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    ralphLoopEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Voice Conversation Mode Section */}
          <div className="space-y-4 pt-4 border-t border-claude-border">
            <h3 className="text-xs font-mono text-claude-text uppercase tracking-wider">
              Voice Conversation Mode (Experimental)
            </h3>

            {/* Voice Mode Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                  Enable Voice Conversation
                </label>
                <p className="text-[10px] font-mono text-claude-text-secondary mt-1">
                  Hands-free speech-to-speech conversations with Claude
                </p>
              </div>
              <button
                onClick={() => setVoiceModeEnabled(!voiceModeEnabled)}
                disabled={isLoading}
                className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                  voiceModeEnabled ? 'bg-claude-accent' : 'bg-claude-border'
                } disabled:opacity-50`}
                style={{ borderRadius: 0 }}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    voiceModeEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* ElevenLabs Agent ID */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                ElevenLabs Agent ID
              </label>
              <input
                type="text"
                value={elevenLabsAgentId}
                onChange={(e) => setElevenLabsAgentId(e.target.value.trim())}
                placeholder="Enter ElevenLabs Conversational AI agent ID"
                disabled={isLoading || !voiceModeEnabled}
                className="w-full px-3 py-2 bg-claude-bg border border-claude-border text-claude-text font-mono text-sm placeholder:text-claude-text-secondary focus:outline-none focus:border-claude-accent disabled:opacity-50"
                style={{ borderRadius: 0 }}
              />
              <p className="text-[10px] font-mono text-claude-text-secondary">
                Create a Conversational AI agent at{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.electronAPI.app?.openExternal?.('https://elevenlabs.io/conversational-ai');
                  }}
                  className="text-claude-accent hover:underline"
                >
                  elevenlabs.io/conversational-ai
                </a>
                {' '}and paste the agent ID here.
              </p>
            </div>
          </div>

          {/* Release Notes Section */}
          <div className="space-y-2 pt-4 border-t border-claude-border">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-purple-400" />
              <label className="text-xs font-mono text-claude-text-secondary uppercase tracking-wider">
                What's New
              </label>
            </div>
            <ReleaseNotes />
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t border-claude-border">
            <button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                saveStatus === 'success'
                  ? 'bg-green-600 text-white'
                  : saveStatus === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-claude-accent text-white hover:bg-claude-accent/80'
              }`}
              style={{ borderRadius: 0 }}
            >
              {isSaving ? (
                'Saving...'
              ) : saveStatus === 'success' ? (
                <>
                  <Check size={14} /> Saved
                </>
              ) : saveStatus === 'error' ? (
                <>
                  <AlertCircle size={14} /> Error
                </>
              ) : (
                <>
                  <Save size={14} /> Save Settings
                </>
              )}
            </button>
          </div>

          {/* Info */}
          <div className="pt-2">
            <p className="text-[10px] font-mono text-claude-text-secondary text-center">
              API keys are stored locally and encrypted. Voice features require external API keys.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
