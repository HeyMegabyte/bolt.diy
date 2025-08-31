import { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { getApiKeysFromCookies } from '~/components/chat/APIKeyManager';
import Cookies from 'js-cookie';

interface BugReportFormData {
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  contactEmail: string;
  includeEnvironmentInfo: boolean;
}

interface FormErrors {
  title?: string;
  description?: string;
  stepsToReproduce?: string;
  expectedBehavior?: string;
  contactEmail?: string;
  includeEnvironmentInfo?: string;
}

interface EnvironmentInfo {
  browser: string;
  os: string;
  screenResolution: string;
  boltVersion: string;
  aiProviders: string;
  projectType: string;
  currentModel: string;
}

const BugReportTab = () => {
  const fetcher = useFetcher();
  const [formData, setFormData] = useState<BugReportFormData>({
    title: '',
    description: '',
    stepsToReproduce: '',
    expectedBehavior: '',
    contactEmail: '',
    includeEnvironmentInfo: false,
  });

  const [environmentInfo, setEnvironmentInfo] = useState<EnvironmentInfo>({
    browser: '',
    os: '',
    screenResolution: '',
    boltVersion: '1.0.0',
    aiProviders: '',
    projectType: '',
    currentModel: '',
  });

  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  // Auto-detect environment info with real data
  useEffect(() => {
    const detectEnvironment = () => {
      const userAgent = navigator.userAgent;
      let browser = 'Unknown';
      let os = 'Unknown';

      // Detect browser
      if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
        browser = `Chrome ${userAgent.match(/Chrome\/(\d+\.\d+)/)?.[1] || 'Unknown'}`;
      } else if (userAgent.includes('Firefox')) {
        browser = `Firefox ${userAgent.match(/Firefox\/(\d+\.\d+)/)?.[1] || 'Unknown'}`;
      } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        browser = `Safari ${userAgent.match(/Version\/(\d+\.\d+)/)?.[1] || 'Unknown'}`;
      } else if (userAgent.includes('Edg')) {
        browser = `Edge ${userAgent.match(/Edg\/(\d+\.\d+)/)?.[1] || 'Unknown'}`;
      }

      // Detect OS
      if (userAgent.includes('Windows NT 10.0')) {
        os = 'Windows 10/11';
      } else if (userAgent.includes('Windows NT 6.3')) {
        os = 'Windows 8.1';
      } else if (userAgent.includes('Windows NT 6.1')) {
        os = 'Windows 7';
      } else if (userAgent.includes('Windows')) {
        os = 'Windows';
      } else if (userAgent.includes('Mac OS X')) {
        const version = userAgent.match(/Mac OS X (\d+_\d+(?:_\d+)?)/)?.[1]?.replace(/_/g, '.');
        os = version ? `macOS ${version}` : 'macOS';
      } else if (userAgent.includes('Linux')) {
        os = 'Linux';
      }

      const screenResolution = `${screen.width}x${screen.height}`;

      // Get real AI provider information
      const getActiveProviders = () => {
        const apiKeys = getApiKeysFromCookies();
        const activeProviders: string[] = [];

        // Check which providers have API keys
        if (apiKeys.OPENAI_API_KEY) {
          activeProviders.push('OpenAI');
        }

        if (apiKeys.ANTHROPIC_API_KEY) {
          activeProviders.push('Anthropic');
        }

        if (apiKeys.GOOGLE_GENERATIVE_AI_API_KEY) {
          activeProviders.push('Google');
        }

        if (apiKeys.GROQ_API_KEY) {
          activeProviders.push('Groq');
        }

        if (apiKeys.MISTRAL_API_KEY) {
          activeProviders.push('Mistral');
        }

        if (apiKeys.COHERE_API_KEY) {
          activeProviders.push('Cohere');
        }

        if (apiKeys.DEEPSEEK_API_KEY) {
          activeProviders.push('DeepSeek');
        }

        if (apiKeys.XAI_API_KEY) {
          activeProviders.push('xAI');
        }

        if (apiKeys.OPEN_ROUTER_API_KEY) {
          activeProviders.push('OpenRouter');
        }

        if (apiKeys.TOGETHER_API_KEY) {
          activeProviders.push('Together');
        }

        if (apiKeys.PERPLEXITY_API_KEY) {
          activeProviders.push('Perplexity');
        }

        if (apiKeys.OLLAMA_API_BASE_URL) {
          activeProviders.push('Ollama');
        }

        if (apiKeys.LMSTUDIO_API_BASE_URL) {
          activeProviders.push('LMStudio');
        }

        if (apiKeys.OPENAI_LIKE_API_BASE_URL) {
          activeProviders.push('OpenAI-Compatible');
        }

        return activeProviders.length > 0 ? activeProviders.join(', ') : 'None configured';
      };

      // Get current model and provider from cookies
      const getCurrentModel = () => {
        try {
          const savedModel = Cookies.get('selectedModel');
          const savedProvider = Cookies.get('selectedProvider');

          if (savedModel && savedProvider) {
            const provider = JSON.parse(savedProvider);
            return `${savedModel} (${provider.name})`;
          }
        } catch (error) {
          console.debug('Could not parse model/provider from cookies:', error);
        }
        return 'Default model';
      };

      // Detect project type based on current context
      const getProjectType = () => {
        const url = window.location.href;

        if (url.includes('/chat/')) {
          return 'AI Chat Session';
        }

        if (url.includes('/git')) {
          return 'Git Repository';
        }

        return 'Web Application';
      };

      // Get bolt.diy version
      const getBoltVersion = () => {
        // Try to get version from meta tags or global variables
        const metaVersion = document.querySelector('meta[name="version"]')?.getAttribute('content');
        return metaVersion || '1.0.0';
      };

      setEnvironmentInfo({
        browser,
        os,
        screenResolution,
        boltVersion: getBoltVersion(),
        aiProviders: getActiveProviders(),
        projectType: getProjectType(),
        currentModel: getCurrentModel(),
      });
    };

    // Initial detection
    detectEnvironment();

    // Listen for storage changes to update when model/provider changes
    const handleStorageChange = () => {
      detectEnvironment();
    };

    // Listen for cookie changes (model/provider selection)
    const originalSetItem = Storage.prototype.setItem;

    Storage.prototype.setItem = function (key, value) {
      originalSetItem.apply(this, [key, value]);

      if (key === 'selectedModel' || key === 'selectedProvider') {
        setTimeout(detectEnvironment, 100);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Detect changes every 30 seconds to catch any updates
    const interval = setInterval(detectEnvironment, 30000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
      Storage.prototype.setItem = originalSetItem;
    };
  }, []);

  // Handle form submission response
  useEffect(() => {
    if (fetcher.data) {
      const data = fetcher.data as any;

      if (data.success) {
        toast.success(`Bug report submitted successfully! Issue #${data.issueNumber} created.`);

        // Reset form
        setFormData({
          title: '',
          description: '',
          stepsToReproduce: '',
          expectedBehavior: '',
          contactEmail: '',
          includeEnvironmentInfo: false,
        });
        setShowPreview(false);
      } else if (data.error) {
        toast.error(data.error);
      }

      setIsSubmitting(false);
    }
  }, [fetcher.data]);

  // Validation functions
  const validateField = (
    field: keyof BugReportFormData,
    value: string | boolean | File[] | undefined,
  ): string | undefined => {
    switch (field) {
      case 'title': {
        const titleValue = value as string;

        if (!titleValue.trim()) {
          return 'Title is required';
        }

        if (titleValue.length < 5) {
          return 'Title must be at least 5 characters long';
        }

        if (titleValue.length > 100) {
          return 'Title must be 100 characters or less';
        }

        if (!/^[a-zA-Z0-9\s\-_.,!?()[\]{}]+$/.test(titleValue)) {
          return 'Title contains invalid characters. Please use only letters, numbers, spaces, and basic punctuation';
        }

        return undefined;
      }

      case 'description': {
        const descValue = value as string;

        if (!descValue.trim()) {
          return 'Description is required';
        }

        if (descValue.length < 10) {
          return 'Description must be at least 10 characters long';
        }

        if (descValue.length > 2000) {
          return 'Description must be 2000 characters or less';
        }

        if (descValue.trim().split(/\s+/).length < 3) {
          return 'Please provide more details in the description (at least 3 words)';
        }

        return undefined;
      }

      case 'stepsToReproduce': {
        const stepsValue = value as string;

        if (stepsValue.length > 1000) {
          return 'Steps to reproduce must be 1000 characters or less';
        }

        return undefined;
      }

      case 'expectedBehavior': {
        const behaviorValue = value as string;

        if (behaviorValue.length > 1000) {
          return 'Expected behavior must be 1000 characters or less';
        }

        return undefined;
      }

      case 'contactEmail': {
        const emailValue = value as string;

        if (emailValue && emailValue.trim()) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

          if (!emailRegex.test(emailValue)) {
            return 'Please enter a valid email address';
          }
        }

        return undefined;
      }

      default:
        return undefined;
    }
  };

  const validateForm = (): FormErrors => {
    const newErrors: FormErrors = {};

    // Only validate required fields
    const requiredFields: (keyof BugReportFormData)[] = ['title', 'description'];

    requiredFields.forEach((field) => {
      const error = validateField(field, formData[field]);

      if (error) {
        newErrors[field] = error;
      }
    });

    // Validate optional fields only if they have values

    if (formData.stepsToReproduce.trim()) {
      const error = validateField('stepsToReproduce', formData.stepsToReproduce);

      if (error) {
        newErrors.stepsToReproduce = error;
      }
    }

    if (formData.expectedBehavior.trim()) {
      const error = validateField('expectedBehavior', formData.expectedBehavior);

      if (error) {
        newErrors.expectedBehavior = error;
      }
    }

    if (formData.contactEmail.trim()) {
      const error = validateField('contactEmail', formData.contactEmail);

      if (error) {
        newErrors.contactEmail = error;
      }
    }

    return newErrors;
  };

  // Re-validate form when form data changes to ensure errors are cleared
  useEffect(() => {
    const newErrors = validateForm();
    setErrors(newErrors);
  }, [formData]);

  const handleInputChange = useCallback((field: keyof BugReportFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Real-time validation for text fields (only for fields that can have errors)
    if (typeof value === 'string' && field !== 'includeEnvironmentInfo') {
      const error = validateField(field, value);
      setErrors((prev) => {
        const newErrors = { ...prev };

        if (error) {
          newErrors[field as keyof FormErrors] = error;
        } else {
          delete newErrors[field as keyof FormErrors]; // Clear the error if validation passes
        }

        return newErrors;
      });
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Validate entire form
      const formErrors = validateForm();
      setErrors(formErrors);

      // Check if there are any errors
      if (Object.keys(formErrors).length > 0) {
        const errorMessages = Object.values(formErrors).join(', ');
        toast.error(`Please fix the following errors: ${errorMessages}`);

        return;
      }

      setIsSubmitting(true);

      const submitData = new FormData();
      submitData.append('title', formData.title);
      submitData.append('description', formData.description);
      submitData.append('stepsToReproduce', formData.stepsToReproduce);
      submitData.append('expectedBehavior', formData.expectedBehavior);
      submitData.append('contactEmail', formData.contactEmail);
      submitData.append('includeEnvironmentInfo', formData.includeEnvironmentInfo.toString());

      if (formData.includeEnvironmentInfo) {
        submitData.append('environmentInfo', JSON.stringify(environmentInfo));
      }

      fetcher.submit(submitData, {
        method: 'post',
        action: '/api/bug-report',
      });
    },
    [formData, environmentInfo, fetcher],
  );

  const generatePreview = () => {
    let preview = `**Bug Report**\n\n`;
    preview += `**Title:** ${formData.title}\n\n`;
    preview += `**Description:**\n${formData.description}\n\n`;

    if (formData.stepsToReproduce) {
      preview += `**Steps to Reproduce:**\n${formData.stepsToReproduce}\n\n`;
    }

    if (formData.expectedBehavior) {
      preview += `**Expected Behavior:**\n${formData.expectedBehavior}\n\n`;
    }

    if (formData.includeEnvironmentInfo) {
      preview += `**Environment Info:**\n`;
      preview += `- Browser: ${environmentInfo.browser}\n`;
      preview += `- OS: ${environmentInfo.os}\n`;
      preview += `- Screen: ${environmentInfo.screenResolution}\n`;
      preview += `- bolt.diy: ${environmentInfo.boltVersion}\n`;
      preview += `- Current Model: ${environmentInfo.currentModel}\n`;
      preview += `- AI Providers: ${environmentInfo.aiProviders}\n`;
      preview += `- Project Type: ${environmentInfo.projectType}\n\n`;
    }

    if (formData.contactEmail) {
      preview += `**Contact:** ${formData.contactEmail}\n\n`;
    }

    return preview;
  };

  const InfoPanel = () => (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4"
    >
      <div className="flex items-start space-x-3">
        <div className="i-ph:info w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
            Important Information About Bug Reporting
          </h3>
          <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
            <div>
              <strong>🔧 Administrator Setup Required:</strong>
              <p className="mt-1">
                Bug reporting requires server-side configuration of GitHub API tokens. If you see a "not properly
                configured" error, please contact your administrator to set up the following environment variables:
              </p>
              <div className="mt-2 bg-blue-100 dark:bg-blue-800/30 p-3 rounded font-mono text-xs">
                <div>GITHUB_BUG_REPORT_TOKEN=ghp_xxxxxxxx</div>
                <div>BUG_REPORT_REPO=owner/repository</div>
              </div>
            </div>
            <div>
              <strong>🔒 Your Privacy:</strong>
              <p>
                We never collect your personal data. Environment information is only shared if you explicitly opt-in.
              </p>
            </div>
            <div>
              <strong>⚡ Rate Limits:</strong>
              <p>To prevent spam, you can submit up to 5 bug reports per hour.</p>
            </div>
            <div>
              <strong>📝 Good Bug Reports Include:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Clear, descriptive title (5-100 characters)</li>
                <li>Detailed description of what happened</li>
                <li>Steps to reproduce the issue</li>
                <li>What you expected to happen instead</li>
                <li>Environment info (browser, OS) if relevant</li>
              </ul>
            </div>
          </div>
          <button
            onClick={() => setShowInfoPanel(false)}
            className={classNames(
              'mt-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              'border border-blue-200 dark:border-blue-700',
              'text-blue-700 dark:text-blue-300',
              'bg-blue-50 dark:bg-blue-900/20',
              'hover:bg-blue-100 dark:hover:bg-blue-900/40',
              'hover:text-blue-800 dark:hover:text-blue-200',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
              'active:transform active:scale-95',
            )}
          >
            Got it, hide this info
          </button>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Bug Report</h2>
            <p className="text-gray-600 dark:text-gray-400">
              Help us improve bolt.diy by reporting bugs and issues. Your report will be automatically submitted to our
              GitHub repository.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setShowInfoPanel(!showInfoPanel)}
            className={classNames(
              'flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              'border border-blue-200 dark:border-blue-700',
              'text-blue-700 dark:text-blue-300',
              'bg-blue-50 dark:bg-blue-900/20',
              'hover:bg-blue-100 dark:hover:bg-blue-900/40',
              'hover:text-blue-800 dark:hover:text-blue-200',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
              'active:transform active:scale-95',
            )}
          >
            <div className="i-ph:info w-4 h-4" />
            <span>{showInfoPanel ? 'Hide Setup Info' : 'Setup Info'}</span>
            <div
              className={classNames(
                'i-ph:chevron-down w-3 h-3 transition-transform',
                showInfoPanel ? 'rotate-180' : '',
              )}
            />
          </button>
        </div>
      </div>

      {showInfoPanel && <InfoPanel />}

      {!showPreview ? (
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit}
          className="space-y-6"
        >
          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Bug Title <span className="text-red-500">*</span>
              <span className="font-normal text-xs text-gray-500 ml-2">
                (5-100 characters, letters, numbers, and basic punctuation only)
              </span>
            </label>
            <Input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder="Brief, clear description of the bug (e.g., 'Login button not working on mobile')"
              maxLength={100}
              className={classNames(
                'w-full',
                errors.title ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : '',
              )}
              required
            />
            <div className="flex justify-between items-start mt-1">
              <div className="flex-1">
                {errors.title && (
                  <p className="text-xs text-red-600 dark:text-red-400 flex items-center">
                    <div className="i-ph:warning w-3 h-3 mr-1" />
                    {errors.title}
                  </p>
                )}
              </div>
              <p
                className={classNames(
                  'text-xs mt-0 ml-2',
                  formData.title.length > 90 ? 'text-orange-500' : 'text-gray-500',
                )}
              >
                {formData.title.length}/100
              </p>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description <span className="text-red-500">*</span>
              <span className="font-normal text-xs text-gray-500 ml-2">(10-2000 characters, at least 3 words)</span>
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe the bug in detail:&#10;• What exactly happened?&#10;• What were you doing when it occurred?&#10;• What did you expect to happen instead?&#10;• Any error messages you saw?"
              maxLength={2000}
              rows={6}
              className={classNames(
                'w-full px-3 py-2 border border-gray-300 dark:border-gray-600',
                'rounded-md shadow-sm bg-white dark:bg-gray-800',
                'text-gray-900 dark:text-gray-100',
                'focus:ring-2 focus:ring-purple-500 focus:border-purple-500',
                'resize-y min-h-[120px]',
                errors.description ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : '',
              )}
              required
            />
            <div className="flex justify-between items-start mt-1">
              <div className="flex-1">
                {errors.description && (
                  <p className="text-xs text-red-600 dark:text-red-400 flex items-center">
                    <div className="i-ph:warning w-3 h-3 mr-1" />
                    {errors.description}
                  </p>
                )}
                {!errors.description && formData.description.length > 0 && formData.description.length < 10 && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center">
                    <div className="i-ph:info w-3 h-3 mr-1" />
                    Add more details to help us understand the issue
                  </p>
                )}
              </div>
              <p
                className={classNames(
                  'text-xs mt-0 ml-2',
                  formData.description.length > 1800 ? 'text-orange-500' : 'text-gray-500',
                )}
              >
                {formData.description.length}/2000
              </p>
            </div>
          </div>

          {/* Steps to Reproduce */}
          <div>
            <label
              htmlFor="stepsToReproduce"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Steps to Reproduce (Optional)
            </label>
            <textarea
              id="stepsToReproduce"
              value={formData.stepsToReproduce}
              onChange={(e) => handleInputChange('stepsToReproduce', e.target.value)}
              placeholder="1. Go to...\n2. Click on...\n3. See error..."
              maxLength={1000}
              rows={4}
              className={classNames(
                'w-full px-3 py-2 border border-gray-300 dark:border-gray-600',
                'rounded-md shadow-sm bg-white dark:bg-gray-800',
                'text-gray-900 dark:text-gray-100',
                'focus:ring-2 focus:ring-purple-500 focus:border-purple-500',
                'resize-y',
              )}
            />
            <p className="text-xs text-gray-500 mt-1">{formData.stepsToReproduce.length}/1000 characters</p>
          </div>

          {/* Expected Behavior */}
          <div>
            <label
              htmlFor="expectedBehavior"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Expected Behavior (Optional)
            </label>
            <textarea
              id="expectedBehavior"
              value={formData.expectedBehavior}
              onChange={(e) => handleInputChange('expectedBehavior', e.target.value)}
              placeholder="What should have happened instead?"
              maxLength={1000}
              rows={3}
              className={classNames(
                'w-full px-3 py-2 border border-gray-300 dark:border-gray-600',
                'rounded-md shadow-sm bg-white dark:bg-gray-800',
                'text-gray-900 dark:text-gray-100',
                'focus:ring-2 focus:ring-purple-500 focus:border-purple-500',
                'resize-y',
              )}
            />
            <p className="text-xs text-gray-500 mt-1">{formData.expectedBehavior.length}/1000 characters</p>
          </div>

          {/* Contact Email */}
          <div>
            <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Contact Email (Optional)
            </label>
            <Input
              id="contactEmail"
              type="email"
              value={formData.contactEmail}
              onChange={(e) => handleInputChange('contactEmail', e.target.value)}
              placeholder="your.email@example.com"
              className={classNames(
                'w-full',
                errors.contactEmail ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : '',
              )}
            />
            <div className="mt-1">
              {errors.contactEmail ? (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center">
                  <div className="i-ph:warning w-3 h-3 mr-1" />
                  {errors.contactEmail}
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  We may contact you for additional information about this bug (optional)
                </p>
              )}
            </div>
          </div>

          {/* Environment Info Checkbox */}
          <div className="flex items-start space-x-3">
            <input
              id="includeEnvironmentInfo"
              type="checkbox"
              checked={formData.includeEnvironmentInfo}
              onChange={(e) => handleInputChange('includeEnvironmentInfo', e.target.checked)}
              className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
            />
            <div>
              <label htmlFor="includeEnvironmentInfo" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Include Environment Information
              </label>
              <p className="text-xs text-gray-500 mt-1">
                This helps us reproduce and fix the bug faster. Includes browser, OS, screen resolution, and bolt.diy
                version.
              </p>
            </div>
          </div>

          {/* Environment Info Preview */}
          {formData.includeEnvironmentInfo && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border"
            >
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Environment Info Preview:</h4>
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <div>Browser: {environmentInfo.browser || 'Detecting...'}</div>
                <div>OS: {environmentInfo.os || 'Detecting...'}</div>
                <div>Screen: {environmentInfo.screenResolution || 'Detecting...'}</div>
                <div>bolt.diy: {environmentInfo.boltVersion || 'Detecting...'}</div>
                <div>Current Model: {environmentInfo.currentModel || 'Detecting...'}</div>
                <div>AI Providers: {environmentInfo.aiProviders || 'Detecting...'}</div>
                <div>Project Type: {environmentInfo.projectType || 'Detecting...'}</div>
              </div>
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
            <Button
              type="button"
              onClick={() => setShowPreview(true)}
              disabled={!formData.title.trim() || !formData.description.trim() || Object.keys(errors).length > 0}
              variant="secondary"
            >
              <div className="i-ph:eye w-4 h-4 mr-2" />
              Preview Report
            </Button>
            <div className="flex flex-col items-end">
              {Object.keys(errors).length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 mb-2">Please fix the validation errors above</p>
              )}
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  !formData.title.trim() ||
                  !formData.description.trim() ||
                  Object.keys(errors).length > 0
                }
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="i-svg-spinners:ring-resize w-4 h-4 mr-2" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <div className="i-ph:bug w-4 h-4 mr-2" />
                    Submit Bug Report
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.form>
      ) : (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg border">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Preview Your Bug Report</h3>
            <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{generatePreview()}</pre>
          </div>

          <div className="flex justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
            <Button type="button" onClick={() => setShowPreview(false)} variant="secondary">
              <div className="i-ph:pencil w-4 h-4 mr-2" />
              Edit Report
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-purple-600 hover:bg-purple-700">
              {isSubmitting ? (
                <>
                  <div className="i-svg-spinners:ring-resize w-4 h-4 mr-2" />
                  Submitting...
                </>
              ) : (
                <>
                  <div className="i-ph:bug w-4 h-4 mr-2" />
                  Submit Bug Report
                </>
              )}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default BugReportTab;
