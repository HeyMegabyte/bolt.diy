/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { JSONValue, Message } from 'ai';
import React, { lazy, Suspense, type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
/**
 * Items 2 + 3 (perf): Code-split the Workbench (CodeMirror + Preview +
 * lazy-loaded TerminalTabs) into its own chunk. The chat surface paints
 * first; the workbench shell only fetches when a chat session starts. Cuts
 * ~500KB off the chat route's initial bundle so the chat box appears
 * faster on cold loads.
 */
const Workbench = lazy(() =>
  import('~/components/workbench/Workbench.client').then((m) => ({ default: m.Workbench })),
);
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { Messages } from './Messages.client';
import { getApiKeysFromCookies } from './APIKeyManager';
import Cookies from 'js-cookie';
import * as Tooltip from '@radix-ui/react-tooltip';
import styles from './BaseChat.module.scss';
import { ImportButtons } from '~/components/chat/chatExportAndImport/ImportButtons';
import GitCloneButton from './GitCloneButton';
import type { ProviderInfo } from '~/types/model';
import type { ActionAlert, SupabaseAlert, DeployAlert, LlmErrorAlertType } from '~/types/actions';
import DeployChatAlert from '~/components/deploy/DeployAlert';
import ChatAlert from './ChatAlert';
import type { ModelInfo } from '~/lib/modules/llm/types';
import ProgressCompilation from './ProgressCompilation';
import type { ProgressAnnotation } from '~/types/context';
import { SupabaseChatAlert } from '~/components/chat/SupabaseAlert';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { useStore } from '@nanostores/react';
import { StickToBottom, useStickToBottomContext } from '~/lib/hooks';
import { ChatBox } from './ChatBox';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import LlmErrorAlert from './LLMApiAlert';
import { FileMentionMenu } from './FileMentionMenu';
import { PromptSuggestions } from './PromptSuggestions';
import { CostEstimateBadge } from './CostEstimateBadge';
import { startChatStateMirror } from '~/lib/chat/chat-state-mirror';
import { chatId } from '~/lib/persistence/useChatHistory';
import { describeImage } from '~/lib/chat/voice-vision';

// Single-line default for the cinematic-persona input redesign (2026-05-24);
// the textarea expands on focus/content up to TEXTAREA_MAX_HEIGHT.
const TEXTAREA_MIN_HEIGHT = 52;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  supabaseAlert?: SupabaseAlert;
  clearSupabaseAlert?: () => void;
  deployAlert?: DeployAlert;
  clearDeployAlert?: () => void;
  llmErrorAlert?: LlmErrorAlertType;
  clearLlmErrorAlert?: () => void;
  data?: JSONValue[] | undefined;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  append?: (message: Message) => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: (element: ElementInfo | null) => void;
  addToolResult?: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  onWebSearchResult?: (result: string) => void;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,

      // promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      actionAlert,
      clearAlert,
      deployAlert,
      clearDeployAlert,
      supabaseAlert,
      clearSupabaseAlert,
      llmErrorAlert,
      clearLlmErrorAlert,
      data,
      chatMode,
      setChatMode,
      append,
      designScheme,
      setDesignScheme,
      selectedElement,
      setSelectedElement,
      addToolResult = () => {
        throw new Error('addToolResult not implemented');
      },
      onWebSearchResult,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [apiKeys, setApiKeys] = useState<Record<string, string>>(getApiKeysFromCookies());
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isModelSettingsCollapsed, setIsModelSettingsCollapsed] = useState(true);
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const expoUrl = useStore(expoUrlAtom);
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const currentChatId = useStore(chatId);

    // Start IDB→D1 mirror (item 12)
    useEffect(() => {
      if (!chatStarted || !currentChatId) {
        return;
      }

      // Derive a stable slug from chat id; admin worker accepts any slug-shape
      const slug = `bolt-${currentChatId}`;
      const dispose = startChatStateMirror({
        slug,
        chatId: currentChatId,
        getMessages: () => messages ?? [],
      });

      return dispose;
    }, [chatStarted, currentChatId, messages]);

    // Detect `@<query>` at the end of the input → open file mention menu (item 15)
    useEffect(() => {
      if (!input) {
        setMentionQuery(null);
        return;
      }

      const match = input.match(/(?:^|\s)@([\w./\-]*)$/);

      if (match) {
        setMentionQuery(match[1] ?? '');
      } else {
        setMentionQuery(null);
      }
    }, [input]);

    const pickMention = (path: string) => {
      if (!handleInputChange) {
        return;
      }

      const next = input.replace(/(^|\s)@([\w./\-]*)$/, (_, lead) => `${lead}@${path} `);
      handleInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
      setMentionQuery(null);
    };

    const pickSuggestion = (prompt: string) => {
      if (!handleInputChange) {
        return;
      }

      handleInputChange({
        target: { value: input ? `${input}\n\n${prompt}` : prompt },
      } as React.ChangeEvent<HTMLTextAreaElement>);
    };

    /*
     * Listen for `ps:send-to-chat` — emitted by the FileTree "Send to AI"
     * context-menu action. Appends a fenced code block of the target file
     * into the composer + focuses the textarea so the user can hit Enter.
     */
    useEffect(() => {
      const onSendToChat = (e: Event) => {
        const detail = (e as CustomEvent<{ text?: string }>).detail;

        if (!detail?.text || !handleInputChange) {
          return;
        }

        handleInputChange({
          target: { value: input ? `${input}\n\n${detail.text}` : detail.text },
        } as React.ChangeEvent<HTMLTextAreaElement>);
        requestAnimationFrame(() => textareaRef?.current?.focus({ preventScroll: true }));
      };

      window.addEventListener('ps:send-to-chat', onSendToChat as EventListener);

      return () => window.removeEventListener('ps:send-to-chat', onSendToChat as EventListener);
    }, [input, handleInputChange, textareaRef]);

    /*
     * Items 31 — hero copy. When standalone (NOT embedded in admin), show a
     * heading. When `?slug=X` is supplied, render `Build for {slug}` instead
     * of the generic "Where ideas begin". When `?embedded=true` the parent
     * admin owns onboarding — render nothing here.
     */
    const heroState = (() => {
      if (typeof window === 'undefined') return { embedded: false, slug: null as string | null };
      const params = new URLSearchParams(window.location.search);
      return {
        embedded: params.get('embedded') === 'true',
        slug: params.get('slug'),
      };
    })();

    useEffect(() => {
      if (expoUrl) {
        setQrModalOpen(true);
      }
    }, [expoUrl]);

    useEffect(() => {
      if (data) {
        const progressList = data.filter(
          (x) => typeof x === 'object' && (x as any).type === 'progress',
        ) as ProgressAnnotation[];
        setProgressAnnotations(progressList);
      }
    }, [data]);
    useEffect(() => {
      console.log(transcript);
    }, [transcript]);

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        setRecognition(recognition);
      }
    }, []);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        let parsedApiKeys: Record<string, string> | undefined = {};

        try {
          parsedApiKeys = getApiKeysFromCookies();
          setApiKeys(parsedApiKeys);
        } catch (error) {
          console.error('Error loading API keys from cookies:', error);
          Cookies.remove('apiKeys');
        }

        setIsModelLoading('all');
        fetch('/api/models')
          .then((response) => (response.ok ? response.json() : { modelList: [] }))
          .then((data) => {
            const typedData = data as { modelList?: ModelInfo[] };
            // /api/models can 404 (e.g. when the route isn't served on a given
            // deploy). Never let an undefined modelList reach the render path —
            // it cascades into `.length`/`.filter`/`.some` crashes across the
            // model UI (caught by the React Router error boundary).
            setModelList(Array.isArray(typedData.modelList) ? typedData.modelList : []);
          })
          .catch((error) => {
            console.error('Error fetching model list:', error);
            setModelList([]);
          })
          .finally(() => {
            setIsModelLoading(undefined);
          });
      }
    }, [providerList, provider]);

    const onApiKeysChange = async (providerName: string, apiKey: string) => {
      const newApiKeys = { ...apiKeys, [providerName]: apiKey };
      setApiKeys(newApiKeys);
      Cookies.set('apiKeys', JSON.stringify(newApiKeys));

      setIsModelLoading(providerName);

      let providerModels: ModelInfo[] = [];

      try {
        const response = await fetch(`/api/models/${encodeURIComponent(providerName)}`);
        const data = response.ok ? await response.json() : { modelList: [] };
        providerModels = (data as { modelList?: ModelInfo[] }).modelList ?? [];
      } catch (error) {
        console.error('Error loading dynamic models for:', providerName, error);
      }

      // Only update models for the specific provider
      setModelList((prevModels) => {
        const otherModels = prevModels.filter((model) => model.provider !== providerName);
        return [...otherModels, ...providerModels];
      });
      setIsModelLoading(undefined);
    };

    const startListening = () => {
      if (recognition) {
        recognition.start();
        setIsListening(true);
      }
    };

    const stopListening = () => {
      if (recognition) {
        recognition.stop();
        setIsListening(false);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        sendMessage(event, messageInput);
        setSelectedElement?.(null);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript
          setIsListening(false);

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = (e) => {
            const base64Image = e.target?.result as string;
            setUploadedFiles?.([...uploadedFiles, file]);
            setImageDataList?.([...imageDataList, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = async (ev) => {
              const base64Image = ev.target?.result as string;
              setUploadedFiles?.([...uploadedFiles, file]);
              setImageDataList?.([...imageDataList, base64Image]);

              // Item 16: OCR + caption via Workers AI vision; prepend extracted text to input
              try {
                const vision = await describeImage(base64Image);
                const extracted = [vision.ocrText, vision.caption].filter(Boolean).join('\n').trim();

                if (extracted && handleInputChange) {
                  const prefix = `[Pasted image — extracted]: ${extracted}\n\n`;
                  handleInputChange({
                    target: { value: prefix + (input ?? '') },
                  } as React.ChangeEvent<HTMLTextAreaElement>);
                }
              } catch (err) {
                console.warn('vision OCR failed', err);
              }
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <div className="flex flex-col lg:flex-row overflow-y-auto w-full h-full">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full')}>
            <StickToBottom
              className="pt-0 px-2 sm:px-6 relative h-full flex flex-col modern-scrollbar"
              resize="smooth"
              initial="smooth"
            >
              <StickToBottom.Content className="flex flex-col gap-4 relative ">
                {!chatStarted && !heroState.embedded && (
                  <div className="ps-hero mx-auto max-w-chat text-center pt-10 pb-2">
                    <h1 className="ps-hero-title">
                      {heroState.slug ? `Build for ${heroState.slug}` : 'Where ideas begin'}
                    </h1>
                    <p className="ps-hero-sub">
                      Describe what you want to make and the AI will scaffold it.
                    </p>
                  </div>
                )}
                <ClientOnly>
                  {() => {
                    return chatStarted ? (
                      <Messages
                        className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                        messages={messages}
                        isStreaming={isStreaming}
                        append={append}
                        chatMode={chatMode}
                        setChatMode={setChatMode}
                        provider={provider}
                        model={model}
                        addToolResult={addToolResult}
                      />
                    ) : null;
                  }}
                </ClientOnly>
                <ScrollToBottom />
              </StickToBottom.Content>
              <div
                className="my-auto flex flex-col gap-2 w-full max-w-chat mx-auto z-prompt mb-6 sticky bottom-2"
              >
                <div className="flex flex-col gap-2">
                  {deployAlert && (
                    <DeployChatAlert
                      alert={deployAlert}
                      clearAlert={() => clearDeployAlert?.()}
                      postMessage={(message: string | undefined) => {
                        sendMessage?.({} as any, message);
                        clearSupabaseAlert?.();
                      }}
                    />
                  )}
                  {supabaseAlert && (
                    <SupabaseChatAlert
                      alert={supabaseAlert}
                      clearAlert={() => clearSupabaseAlert?.()}
                      postMessage={(message) => {
                        sendMessage?.({} as any, message);
                        clearSupabaseAlert?.();
                      }}
                    />
                  )}
                  {actionAlert && (
                    <ChatAlert
                      alert={actionAlert}
                      clearAlert={() => clearAlert?.()}
                      postMessage={(message) => {
                        sendMessage?.({} as any, message);
                        clearAlert?.();
                      }}
                    />
                  )}
                  {llmErrorAlert && (
                    <div style={{ display: 'none' }}>
                      <LlmErrorAlert alert={llmErrorAlert} clearAlert={() => clearLlmErrorAlert?.()} />
                    </div>
                  )}
                </div>
                {progressAnnotations && <ProgressCompilation data={progressAnnotations} />}
                {chatStarted && messages && messages.length > 0 && (
                  <PromptSuggestions
                    messages={messages}
                    isStreaming={isStreaming}
                    onPick={pickSuggestion}
                  />
                )}
                <div className="relative">
                  <FileMentionMenu
                    query={mentionQuery}
                    onSelect={pickMention}
                    onClose={() => setMentionQuery(null)}
                  />
                  {input && input.length > 0 && (
                    <div className="flex justify-end mb-1 px-1">
                      <CostEstimateBadge input={input} model={model} />
                    </div>
                  )}
                </div>
                <ChatBox
                  isModelSettingsCollapsed={isModelSettingsCollapsed}
                  setIsModelSettingsCollapsed={setIsModelSettingsCollapsed}
                  provider={provider}
                  setProvider={setProvider}
                  providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                  model={model}
                  setModel={setModel}
                  modelList={modelList}
                  apiKeys={apiKeys}
                  isModelLoading={isModelLoading}
                  onApiKeysChange={onApiKeysChange}
                  uploadedFiles={uploadedFiles}
                  setUploadedFiles={setUploadedFiles}
                  imageDataList={imageDataList}
                  setImageDataList={setImageDataList}
                  textareaRef={textareaRef}
                  input={input}
                  handleInputChange={handleInputChange}
                  handlePaste={handlePaste}
                  TEXTAREA_MIN_HEIGHT={TEXTAREA_MIN_HEIGHT}
                  TEXTAREA_MAX_HEIGHT={TEXTAREA_MAX_HEIGHT}
                  isStreaming={isStreaming}
                  handleStop={handleStop}
                  handleSendMessage={handleSendMessage}
                  enhancingPrompt={enhancingPrompt}
                  enhancePrompt={enhancePrompt}
                  isListening={isListening}
                  startListening={startListening}
                  stopListening={stopListening}
                  chatStarted={chatStarted}
                  exportChat={exportChat}
                  qrModalOpen={qrModalOpen}
                  setQrModalOpen={setQrModalOpen}
                  handleFileUpload={handleFileUpload}
                  chatMode={chatMode}
                  setChatMode={setChatMode}
                  designScheme={designScheme}
                  setDesignScheme={setDesignScheme}
                  selectedElement={selectedElement}
                  setSelectedElement={setSelectedElement}
                  onWebSearchResult={onWebSearchResult}
                />
              </div>
            </StickToBottom>
          </div>
          <ClientOnly>
            {() => (
              // Item 3: Suspense boundary lets the chat surface paint while
              // the workbench chunk downloads. Empty fallback because the
              // workbench is offscreen until `chatStarted` flips true.
              <Suspense fallback={null}>
                <Workbench chatStarted={chatStarted} isStreaming={isStreaming} setSelectedElement={setSelectedElement} />
              </Suspense>
            )}
          </ClientOnly>
        </div>
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  return (
    !isAtBottom && (
      <>
        <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-bolt-elements-background-depth-1 to-transparent h-20 z-10" />
        <button
          className="sticky z-50 bottom-0 left-0 right-0 text-4xl rounded-lg px-1.5 py-0.5 flex items-center justify-center mx-auto gap-2 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm"
          onClick={() => scrollToBottom()}
        >
          Go to last message
          <span className="i-ph:arrow-down animate-bounce" />
        </button>
      </>
    )
  );
}
