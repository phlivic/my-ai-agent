import React, { useEffect, useMemo, useRef, useState } from 'react';

type ChatMessage = {
  role: string;
  content: string;
};

type RecommendationResponse = {
  recommendation?: {
    title?: string;
    prefilledPrompt?: string;
  };
};

type PreferenceField = 'interests' | 'keywords' | 'regions' | 'sources' | 'avoid';
type ReplyLanguage = 'English' | 'Chinese';

type PreferenceChange = {
  type: 'add' | 'remove';
  field: 'displayName' | PreferenceField | 'languages';
  value: string;
  reason: string;
  at: string;
  by: 'manual' | 'inferred';
};

type PreferenceProfile = {
  scopeKey: string;
  locked: boolean;
  displayName: string;
  interests: string[];
  keywords: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  avoid: string[];
  updatedAt: string;
  lastUpdatedBy: 'manual' | 'inferred';
  recentChanges: PreferenceChange[];
};

type ProfileResponse = {
  profile: PreferenceProfile;
};

const PREFERENCE_FIELDS: Array<{
  field: PreferenceField;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    field: 'interests',
    label: 'Interests',
    hint: 'Human-readable topics that should guide the agent.',
    placeholder: 'Add an interest',
  },
  {
    field: 'keywords',
    label: 'AI-generated keywords',
    hint: 'Search-friendly terms used by the recommendation workflow.',
    placeholder: 'Add a keyword',
  },
  {
    field: 'regions',
    label: 'Regions',
    hint: 'Geographic focus for recommendations.',
    placeholder: 'Add a region',
  },
  {
    field: 'sources',
    label: 'Sources',
    hint: 'Optional source preferences.',
    placeholder: 'Add a source',
  },
  {
    field: 'avoid',
    label: 'Avoid',
    hint: 'Topics or categories the system should deprioritize.',
    placeholder: 'Add an avoid term',
  },
];

const REPLY_LANGUAGE_OPTIONS: ReplyLanguage[] = ['English', 'Chinese'];

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('connecting');
  const [recommendationStatus, setRecommendationStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [recommendationTitle, setRecommendationTitle] = useState('');
  const [recommendationError, setRecommendationError] = useState('');
  const [isPreferencePanelOpen, setIsPreferencePanelOpen] = useState(false);
  const [profile, setProfile] = useState<PreferenceProfile | null>(null);
  const [draftProfile, setDraftProfile] = useState<PreferenceProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [profileError, setProfileError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const isComposingRef = useRef(false);

  const isProfileDirty = useMemo(() => {
    if (!profile || !draftProfile) {
      return false;
    }

    return JSON.stringify(serializeEditableProfile(profile)) !== JSON.stringify(serializeEditableProfile(draftProfile));
  }, [draftProfile, profile]);

  const selectedReplyLanguage = (draftProfile?.languages[0] as ReplyLanguage | undefined) || 'English';

  useEffect(() => {
    const configuredWsUrl = import.meta.env.VITE_AGENT_WS_URL?.trim();
    const wsUrl = configuredWsUrl || 'ws://localhost:8787/agents/my-agent/default';

    if (!configuredWsUrl && window.location.hostname !== 'localhost') {
      setStatus('error');
      setMessages([
        {
          role: 'system',
          content:
            'Missing VITE_AGENT_WS_URL. Set it at build time, e.g. wss://<your-worker>.workers.dev/agents/my-agent/default',
        },
      ]);
      return;
    }

    socket.current = new WebSocket(wsUrl);

    socket.current.onopen = () => setStatus('connected');
    socket.current.onclose = () => setStatus('disconnected');
    socket.current.onerror = () => setStatus('error');

    socket.current.onmessage = (event) => {
      if (typeof event.data === 'string' && event.data.startsWith('cf_agent_state:')) {
        return;
      }

      try {
        const data = JSON.parse(event.data) as { text?: string; type?: string };
        if (data.text) {
          const role = data.type === 'system' ? 'system' : 'assistant';
          setMessages((prev) => [...prev, { role, content: data.text! }]);
        }
      } catch {
        if (typeof event.data === 'string') {
          setMessages((prev) => [...prev, { role: 'assistant', content: event.data }]);
        }
      }
    };

    return () => socket.current?.close();
  }, []);

  useEffect(() => {
    if (isPreferencePanelOpen && !profile) {
      void loadPreferences();
    }
  }, [isPreferencePanelOpen, profile]);

  const handleSend = () => {
    if (socket.current?.readyState === WebSocket.OPEN && input.trim()) {
      socket.current.send(JSON.stringify({ type: 'chat', text: input }));
      setMessages((prev) => [...prev, { role: 'user', content: input }]);
      setInput('');
      setRecommendationError('');
    }
  };

  const handleRecommendationPrefill = async () => {
    setRecommendationStatus('loading');
    setRecommendationError('');

    try {
      const response = await fetch(getRecommendationApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = (await response.json()) as RecommendationResponse & {
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to load a recommendation.');
      }

      const prompt = data.recommendation?.prefilledPrompt?.trim();
      if (!prompt) {
        throw new Error('The recommendation response did not include a prompt.');
      }

      setInput(prompt);
      setRecommendationTitle(data.recommendation?.title?.trim() || '');
      setRecommendationStatus('idle');
    } catch (error) {
      setRecommendationStatus('error');
      setRecommendationError(error instanceof Error ? error.message : 'Failed to load a recommendation.');
    }
  };

  const loadPreferences = async () => {
    setProfileStatus('loading');
    setProfileError('');

    try {
      const response = await fetch(getPreferenceApiUrl(), {
        method: 'GET',
      });
      const data = (await response.json()) as ProfileResponse & {
        error?: { message?: string };
      };

      if (!response.ok || !data.profile) {
        throw new Error(data.error?.message || 'Failed to load preferences.');
      }

      setProfile(data.profile);
      setDraftProfile(data.profile);
      setProfileStatus('idle');
    } catch (error) {
      setProfileStatus('error');
      setProfileError(error instanceof Error ? error.message : 'Failed to load preferences.');
    }
  };

  const handleProfileSave = async () => {
    if (!draftProfile) {
      return;
    }

    setProfileStatus('saving');
    setProfileError('');

    try {
      const response = await fetch(getPreferenceApiUrl(), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: draftProfile.displayName,
          interests: draftProfile.interests,
          keywords: draftProfile.keywords,
          regions: draftProfile.regions,
          languages: draftProfile.languages,
          sources: draftProfile.sources,
          avoid: draftProfile.avoid,
        }),
      });

      const data = (await response.json()) as ProfileResponse & {
        error?: { message?: string };
      };

      if (!response.ok || !data.profile) {
        throw new Error(data.error?.message || 'Failed to save preferences.');
      }

      setProfile(data.profile);
      setDraftProfile(data.profile);
      setProfileStatus('idle');
    } catch (error) {
      setProfileStatus('error');
      setProfileError(error instanceof Error ? error.message : 'Failed to save preferences.');
    }
  };

  const handleLockToggle = async () => {
    if (!draftProfile) {
      return;
    }

    setProfileStatus('saving');
    setProfileError('');

    try {
      const response = await fetch(`${getPreferenceApiUrl()}/lock`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locked: !draftProfile.locked,
        }),
      });

      const data = (await response.json()) as ProfileResponse & {
        error?: { message?: string };
      };

      if (!response.ok || !data.profile) {
        throw new Error(data.error?.message || 'Failed to update the preference mode.');
      }

      setProfile(data.profile);
      setDraftProfile((prev) =>
        prev
          ? {
              ...prev,
              locked: data.profile.locked,
              updatedAt: data.profile.updatedAt,
              lastUpdatedBy: data.profile.lastUpdatedBy,
              recentChanges: data.profile.recentChanges,
            }
          : data.profile
      );
      setProfileStatus('idle');
    } catch (error) {
      setProfileStatus('error');
      setProfileError(error instanceof Error ? error.message : 'Failed to update the preference mode.');
    }
  };

  const handleReplyLanguageChange = (language: ReplyLanguage) => {
    setDraftProfile((prev) =>
      prev
        ? {
            ...prev,
            languages: [language],
          }
        : prev
    );
  };

  const addDraftTag = (field: PreferenceField, value: string) => {
    const normalized = normalizeTag(value);
    if (!normalized) {
      return;
    }

    setDraftProfile((prev) => {
      if (!prev) {
        return prev;
      }
      const values = prev[field];
      if (values.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        return prev;
      }
      return {
        ...prev,
        [field]: [...values, normalized],
      };
    });
  };

  const removeDraftTag = (field: PreferenceField, value: string) => {
    setDraftProfile((prev) =>
      prev
        ? {
            ...prev,
            [field]: prev[field].filter((item) => item.toLowerCase() !== value.toLowerCase()),
          }
        : prev
    );
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    if (isComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    handleSend();
  };

  return (
    <div className="app-shell">
      <div className="chat-card">
        <div className="chat-header">
          <div>
            <h1>Cloudflare AI Agent</h1>
            <p className="status-line">Status: {status}</p>
          </div>
          <div className="header-actions">
            <button
              className="idea-button"
              type="button"
              onClick={handleRecommendationPrefill}
              disabled={recommendationStatus === 'loading'}
              title="Prefill a recommended news question"
            >
              {recommendationStatus === 'loading' ? '…' : '💡'}
            </button>
            <button
              className={`preference-button ${isPreferencePanelOpen ? 'is-active' : ''}`}
              type="button"
              onClick={() => setIsPreferencePanelOpen(true)}
              title="Open preference drawer"
            >
              💗
            </button>
          </div>
        </div>

        {recommendationTitle ? (
          <div className="recommendation-banner">
            <span className="recommendation-label">Suggested topic</span>
            <span className="recommendation-title">{recommendationTitle}</span>
          </div>
        ) : null}

        {recommendationError ? <p className="recommendation-error">{recommendationError}</p> : null}

        <div className="message-list">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`message-row ${message.role === 'user' ? 'is-user' : 'is-other'}`}
            >
              <p>
                <strong>{message.role}:</strong> {message.content}
              </p>
            </div>
          ))}
        </div>

        <div className="composer">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder="Type a message..."
            className="composer-input"
          />
          <button type="button" onClick={handleSend} className="send-button">
            Send
          </button>
        </div>
      </div>

      <div
        className={`drawer-overlay ${isPreferencePanelOpen ? 'is-open' : ''}`}
        onClick={() => setIsPreferencePanelOpen(false)}
        aria-hidden={!isPreferencePanelOpen}
      />

      <aside className={`preference-drawer ${isPreferencePanelOpen ? 'is-open' : ''}`}>
        <div className="preference-panel-header">
          <div>
            <h2>Preferences</h2>
            <p className="preference-panel-copy">
              {draftProfile?.locked
                ? 'Locked mode keeps your profile stable until you edit it manually.'
                : 'Adaptive mode lets the backend update preferences from your messages.'}
            </p>
          </div>
          <div className="preference-panel-actions">
            <button
              type="button"
              className={`lock-button ${draftProfile?.locked ? 'is-locked' : 'is-adaptive'}`}
              onClick={handleLockToggle}
              disabled={profileStatus === 'saving' || !draftProfile}
            >
              {draftProfile?.locked ? '🔒 Locked' : '🔓 Adaptive'}
            </button>
            <button type="button" className="panel-link-button" onClick={() => setIsPreferencePanelOpen(false)}>
              Close
            </button>
          </div>
        </div>

        {profileError ? <p className="preference-error">{profileError}</p> : null}

        {!draftProfile || profileStatus === 'loading' ? (
          <div className="panel-loading">Loading preferences…</div>
        ) : (
          <div className="preference-panel-body">
            <label className="profile-name-field">
              <span>Display name</span>
              <input
                value={draftProfile.displayName}
                onChange={(event) =>
                  setDraftProfile((prev) =>
                    prev
                      ? {
                          ...prev,
                          displayName: event.target.value,
                        }
                      : prev
                  )
                }
                placeholder="How the agent should address you"
              />
            </label>

            <section className="tag-section">
              <div className="section-heading">
                <h3>Assistant reply language</h3>
                <span className="section-meta">
                  This setting only controls whether the assistant replies in English or Chinese. News search stays in
                  English.
                </span>
              </div>
              <div className="language-toggle">
                {REPLY_LANGUAGE_OPTIONS.map((language) => (
                  <button
                    key={language}
                    type="button"
                    className={`language-option ${selectedReplyLanguage === language ? 'is-selected' : ''}`}
                    onClick={() => handleReplyLanguageChange(language)}
                  >
                    {language}
                  </button>
                ))}
              </div>
            </section>

            {PREFERENCE_FIELDS.map((config) => (
              <TagEditorSection
                key={config.field}
                label={config.label}
                hint={config.hint}
                placeholder={config.placeholder}
                values={draftProfile[config.field]}
                onAdd={(value) => addDraftTag(config.field, value)}
                onRemove={(value) => removeDraftTag(config.field, value)}
              />
            ))}

            <div className="recent-changes">
              <div className="section-heading">
                <h3>Recent updates</h3>
                <span className="section-meta">Last updated by {draftProfile.lastUpdatedBy}</span>
              </div>
              {draftProfile.recentChanges.length ? (
                <ul>
                  {draftProfile.recentChanges.slice(0, 6).map((change, index) => (
                    <li key={`${change.at}-${change.field}-${change.value}-${index}`}>
                      <span className={`change-pill ${change.by}`}>{change.by}</span>
                      <strong>{change.type === 'add' ? 'Added' : 'Removed'}</strong> {change.value} in {change.field}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-copy">No preference changes have been recorded yet.</p>
              )}
            </div>

            <div className="panel-footer">
              <p className="panel-footer-copy">
                {draftProfile.locked
                  ? 'Only manual edits will change this profile.'
                  : 'The backend may add or remove profile items based on your messages.'}
              </p>
              <div className="panel-footer-actions">
                <button type="button" className="panel-link-button" onClick={() => void loadPreferences()}>
                  Refresh
                </button>
                <button
                  type="button"
                  className="save-button"
                  onClick={handleProfileSave}
                  disabled={!isProfileDirty || profileStatus === 'saving'}
                >
                  {profileStatus === 'saving' ? 'Saving…' : 'Save preferences'}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

type TagEditorSectionProps = {
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
};

function TagEditorSection({ label, hint, placeholder, values, onAdd, onRemove }: TagEditorSectionProps) {
  const [value, setValue] = useState('');

  const submitValue = () => {
    if (!value.trim()) {
      return;
    }
    onAdd(value);
    setValue('');
  };

  return (
    <section className="tag-section">
      <div className="section-heading">
        <h3>{label}</h3>
        <span className="section-meta">{hint}</span>
      </div>
      <div className="tag-list">
        {values.length ? (
          values.map((item) => (
            <button key={item} type="button" className="tag-chip" onClick={() => onRemove(item)}>
              <span>{item}</span>
              <span className="tag-chip-remove">×</span>
            </button>
          ))
        ) : (
          <p className="empty-copy">Nothing added yet.</p>
        )}
      </div>
      <div className="tag-composer">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submitValue()}
          placeholder={placeholder}
        />
        <button type="button" onClick={submitValue}>
          Add
        </button>
      </div>
    </section>
  );
}

function serializeEditableProfile(profile: PreferenceProfile) {
  return {
    displayName: profile.displayName,
    interests: profile.interests,
    keywords: profile.keywords,
    regions: profile.regions,
    languages: profile.languages,
    sources: profile.sources,
    avoid: profile.avoid,
  };
}

function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function getRecommendationApiUrl(): string {
  const configuredApiBase = import.meta.env.VITE_RECOMMENDATION_API_URL?.trim();
  if (configuredApiBase) {
    return configuredApiBase;
  }

  if (window.location.hostname === 'localhost') {
    return 'http://localhost:8787/api/recommendation-rules/daily-personal-news/next';
  }

  return `${window.location.origin}/api/recommendation-rules/daily-personal-news/next`;
}

function getPreferenceApiUrl(): string {
  const configuredApiBase = import.meta.env.VITE_PREFERENCE_API_URL?.trim();
  if (configuredApiBase) {
    return configuredApiBase;
  }

  if (window.location.hostname === 'localhost') {
    return 'http://localhost:8787/api/profile/preferences';
  }

  return `${window.location.origin}/api/profile/preferences`;
}

export default App;
