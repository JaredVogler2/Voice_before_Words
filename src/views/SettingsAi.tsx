import { useState } from 'react';
import { listModels, PROVIDER_ORDER, PROVIDERS, testConnection, type ConnectionTest, type ProviderId } from '../llm';
import { useSettings } from '../state/settings';
import { useTalk } from '../state/talk';
import { PageHeader, Row, Segmented, Stepper, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { go } from '../ui/hooks';

/**
 * "Smart sentences": connecting a language model with the person's own key.
 *
 * The page has to be honest about three things at the moment of choice: it is
 * optional, it sends the chosen symbols to a company, and the key is theirs and
 * stays in this browser.
 */
export function AiSettingsPage() {
  const settings = useSettings();
  const ai = settings.ai;
  const provider = PROVIDERS[ai.provider];
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);

  const set = (change: Partial<typeof ai>) => {
    settings.patch('ai', change);
    setResult(null);
  };

  const chooseProvider = (id: ProviderId) => {
    // A key belongs to one provider, so it is not carried over to another.
    set({ provider: id, model: PROVIDERS[id].defaultModel, apiKey: '', baseUrl: id === 'compatible' ? ai.baseUrl : '' });
    setModels([]);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const outcome = await testConnection(useSettings.getState().ai);
    if (outcome.model) settings.patch('ai', { model: outcome.model });
    if (outcome.ok) {
      settings.patch('ai', { enabled: true });
      useTalk.getState().refresh();
    }
    setResult(outcome);
    setTesting(false);
  };

  const find = async () => {
    setFinding(true);
    try {
      setModels(await listModels(useSettings.getState().ai));
    } catch {
      setModels([]);
    }
    setFinding(false);
  };

  const canTest = provider.needsBaseUrl ? !!ai.baseUrl.trim() : !!ai.apiKey.trim();

  return (
    <>
      <PageHeader title="Smart sentences" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="note">
          <strong>Optional.</strong> Without this, sentences are built on the device by a grammar engine: private, instant and free, but it only understands common patterns. With an AI model
          connected, far more of what you mean is understood. You always choose which sentence is spoken.
        </div>

        <div className="card">
          <Toggle
            id="ai-on"
            title="Use AI for sentence suggestions"
            help={ai.enabled ? 'On. If the AI is slow or offline, the on-device suggestions are used.' : 'Off. Everything stays on this device.'}
            value={ai.enabled}
            onChange={(enabled) => { set({ enabled }); useTalk.getState().refresh(); }}
          />
        </div>

        <div className="card pad stack">
          <div className="row-title">Provider</div>
          <Segmented id="provider" label="AI provider" wrap value={ai.provider} choices={PROVIDER_ORDER.map((id) => ({ value: id, label: PROVIDERS[id].label }))} onChange={chooseProvider} />

          {provider.needsBaseUrl ? (
            <label className="stack" style={{ gap: 6 }}>
              <span className="row-title">Server address</span>
              <input className="field" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={ai.baseUrl} onChange={(event) => set({ baseUrl: event.target.value })} placeholder="https://openrouter.ai/api/v1  or  http://localhost:11434/v1" />
              <span className="row-help">Any service that speaks the OpenAI chat format. A model running on this device (Ollama, LM Studio) keeps every word on your own hardware.</span>
            </label>
          ) : null}

          <label className="stack" style={{ gap: 6 }}>
            <span className="row-title">API key</span>
            <span className="field-row">
              <input
                className="field"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={ai.apiKey}
                onChange={(event) => set({ apiKey: event.target.value })}
                placeholder={provider.keyHint}
                aria-label="API key"
              />
              <button type="button" className="btn" onClick={() => setShowKey(!showKey)} aria-pressed={showKey}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </span>
            <span className="row-help">
              {provider.keyUrl ? (
                <>
                  Get one at <a href={provider.keyUrl} target="_blank" rel="noreferrer">{provider.keyUrl.replace(/^https:\/\//, '')}</a>.{' '}
                </>
              ) : null}
              The key is kept in this browser and sent only to {provider.needsBaseUrl ? 'the server above' : provider.label}. It never passes through any server of ours, because there isn’t one.
            </span>
          </label>

          <label className="stack" style={{ gap: 6 }}>
            <span className="row-title">Model</span>
            {provider.models.length > 0 ? (
              <span className="options" role="radiogroup" aria-label="Model">
                {provider.models.map((model) => (
                  <button key={model.id} type="button" className="option" role="radio" aria-checked={ai.model === model.id} data-access={`model:${model.id}`} onClick={() => set({ model: model.id })}>
                    <span>
                      <span className="row-title" style={{ display: 'block' }}>{model.label}</span>
                      <span className="row-help" style={{ display: 'block' }}>{model.note}</span>
                    </span>
                  </button>
                ))}
              </span>
            ) : (
              <>
                <span className="field-row">
                  <input className="field" list="model-list" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={ai.model} onChange={(event) => set({ model: event.target.value })} placeholder="Chosen for you when you test" aria-label="Model name" />
                  <button type="button" className="btn" disabled={!canTest || finding} onClick={() => void find()}>
                    {finding ? 'Looking…' : 'Find models'}
                  </button>
                </span>
                <datalist id="model-list">
                  {models.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
                {models.length > 0 ? (
                  <span className="inline">
                    {models.slice(0, 6).map((id) => (
                      <button key={id} type="button" className="btn quiet" style={{ minHeight: 40, padding: '6px 12px', fontSize: 14 }} onClick={() => set({ model: id })}>
                        {id}
                      </button>
                    ))}
                  </span>
                ) : null}
                <span className="row-help">Leave empty and press Test: the app looks up which models your key can use and picks a quick one.</span>
              </>
            )}
          </label>

          <button type="button" className="btn primary" disabled={!canTest || testing} data-access="ai:test" onClick={() => void test()}>
            <Icon name="spark" />
            {testing ? 'Testing…' : 'Test and turn on'}
          </button>
          {result ? (
            <div className={result.ok ? 'note ok' : 'note bad'} role="status">
              <strong>{result.ok ? 'It works.' : 'That didn’t work.'}</strong> {result.message}
              {result.sample ? (
                <>
                  <br />
                  It suggested: “{result.sample}”
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>What is shared</h2>
          <div className="row">
            <div className="row-text">
              <div className="row-title">Always, when AI is on</div>
              <div className="row-help">The symbols in your message, as words, each time you add one (from the second word on). Nothing else on the screen, no pictures, no camera.</div>
            </div>
          </div>
          <Toggle id="share-history" title="The last few things I said" help="Helps it choose the right tense and work out what “it” means." value={ai.shareHistory} onChange={(shareHistory) => set({ shareHistory })} />
          <Toggle id="share-profile" title="My “About me” notes" help="Helps it sound like me and know the people and things in my life." value={ai.shareProfile} onChange={(shareProfile) => set({ shareProfile })} />
          <Toggle id="remember-key" title="Remember my key on this device" help="When off, the key is forgotten as soon as this tab is closed." value={settings.rememberKey} onChange={(rememberKey) => settings.set({ rememberKey })} />
          <Row title="Give up waiting after" help="If the AI takes longer, the on-device suggestions stay.">
            <Stepper id="timeout" label="Time to wait for the AI" value={ai.timeoutMs} min={3000} max={20000} step={1000} format={(ms) => `${ms / 1000} s`} onChange={(timeoutMs) => set({ timeoutMs })} />
          </Row>
        </div>

        <div className="card pad stack">
          <div>
            <div className="row-title">About me</div>
            <div className="row-help">Optional. A few plain sentences: age, how you like to talk, the names of people, pets and favourite things.</div>
          </div>
          <input className="field" value={settings.profile.name} maxLength={60} onChange={(event) => settings.patch('profile', { name: event.target.value })} placeholder="First name" aria-label="First name" />
          <textarea className="field" value={settings.profile.about} maxLength={600} onChange={(event) => settings.patch('profile', { about: event.target.value })} placeholder="I am 9. My dog is Biscuit. I like trains and I say things in a short, jokey way." aria-label="About me" />
        </div>

        <div className="note warn">
          <strong>Cost.</strong> The AI company charges your account for each suggestion, and the model you choose makes a very large difference. As a rough guide, someone who
          says a hundred sentences a day would spend a dollar or two a month with a small fast model such as Claude Haiku 5.5, and fifty dollars or more with the largest ones.
          Check your provider’s prices, and set a spending limit on your account there. Repeated phrases are remembered on this device and not asked for twice.
        </div>
      </div>
    </>
  );
}
