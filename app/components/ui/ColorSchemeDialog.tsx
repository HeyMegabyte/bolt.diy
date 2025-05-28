import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogDescription, DialogRoot } from './Dialog';
import { Button } from './Button';
import { IconButton } from './IconButton';
import type { DesignScheme } from '~/types/design-scheme';
import { defaultDesignScheme, designFeatures, designFonts, paletteRoles } from '~/types/design-scheme';

export interface ColorSchemeDialogProps {
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
}

export const ColorSchemeDialog: React.FC<ColorSchemeDialogProps> = ({ setDesignScheme, designScheme }) => {
  const [palette, setPalette] = useState<{ [key: string]: string }>(() => {
    if (designScheme?.palette) {
      return { ...defaultDesignScheme.palette, ...designScheme.palette };
    }

    return defaultDesignScheme.palette;
  });

  const [features, setFeatures] = useState<string[]>(designScheme?.features || defaultDesignScheme.features);

  const [font, setFont] = useState<string[]>(designScheme?.font || defaultDesignScheme.font);

  useEffect(() => {
    if (designScheme) {
      setPalette(() => ({ ...defaultDesignScheme.palette, ...designScheme.palette }));
      setFeatures(designScheme.features || defaultDesignScheme.features);
      setFont(designScheme.font || defaultDesignScheme.font);
    } else {
      // Reset to defaults if no designScheme provided
      setPalette(defaultDesignScheme.palette);
      setFeatures(defaultDesignScheme.features);
      setFont(defaultDesignScheme.font);
    }
  }, [designScheme]);

  const handleColorChange = (role: string, value: string) => {
    setPalette((prev) => ({
      ...prev,
      [role]: value,
    }));
  };

  const handleFeatureToggle = (key: string) => {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const handleFontToggle = (key: string) => {
    setFont((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleSave = () => {
    setDesignScheme?.({ palette, features, font });
    setIsDialogOpen(false);
  };

  const handleReset = () => {
    setPalette(defaultDesignScheme.palette);
    setFeatures(defaultDesignScheme.features);
    setFont(defaultDesignScheme.font);
  };

  return (
    <div>
      <IconButton title="Upload file" className="transition-all" onClick={() => setIsDialogOpen(!isDialogOpen)}>
        <div className="i-ph:palette text-xl"></div>
      </IconButton>
      <DialogRoot open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <Dialog>
          <div className="p-8 min-w-[380px] max-w-[95vw]">
            <DialogTitle className="mb-2 text-lg font-bold">Design Palette & Features</DialogTitle>
            <DialogDescription className="mb-6 text-sm text-bolt-elements-textPrimary">
              Choose your color palette, typography, and key design features. These will be used as design instructions
              for the LLM.
            </DialogDescription>

            <div className="mb-5">
              <div className="w-full flex justify-between items-center mb-3">
                <span className="font-semibold text-sm text-bolt-elements-textPrimary">Color Palette</span>
                <button
                  onClick={handleReset}
                  className="text-xs bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary flex items-center gap-1 transition-colors"
                >
                  <span className="i-ph:arrow-clockwise" />
                  Reset to defaults
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 max-h-48 overflow-y-auto">
                {paletteRoles.map((role) => (
                  <div
                    key={role.key}
                    className="flex items-center gap-3 p-2 rounded-lg bg-bolt-elements-background-depth-3 hover:bg-bolt-elements-background-depth-2"
                  >
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-lg shadow-sm cursor-pointer hover:scale-105 transition-transform"
                        style={{ backgroundColor: palette[role.key] }}
                        onClick={() => document.getElementById(`color-input-${role.key}`)?.click()}
                      />
                      <input
                        id={`color-input-${role.key}`}
                        type="color"
                        value={palette[role.key]}
                        onChange={(e) => handleColorChange(role.key, e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        tabIndex={-1}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-bolt-elements-textPrimary">{role.label}</div>
                      <div className="text-xs text-bolt-elements-textSecondary truncate">{role.description}</div>
                      <div className="text-xs text-bolt-elements-textSecondary opacity-50 font-mono">
                        {palette[role.key]}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <div className="w-full flex justify-between items-center mb-3">
                <span className="font-semibold text-sm text-bolt-elements-textPrimary">Typography</span>
                <span className="text-xs text-bolt-elements-textSecondary flex items-center gap-1">
                  <span className="i-ph:arrow-right" />
                  Scroll for more
                </span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 px-0.5">
                {designFonts.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => handleFontToggle(f.key)}
                    className={`flex-shrink-0 px-4 py-2 rounded-lg border text-xs font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 flex items-center gap-2 min-w-[120px] ${font.includes(f.key) ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-blue-50 hover:border-blue-300'}`}
                    style={{ fontFamily: f.key }}
                  >
                    <span className="text-lg" style={{ fontFamily: f.key }}>
                      {f.preview}
                    </span>
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <div className="w-full flex justify-between items-center mb-3">
                <span className="font-semibold text-sm text-bolt-elements-textPrimary">Design Features</span>
                <span className="text-xs text-bolt-elements-textSecondary flex items-center gap-1">
                  <span className="i-ph:arrow-right" />
                  Scroll for more
                </span>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 px-0.5">
                {designFeatures.map((f) => {
                  const isSelected = features.includes(f.key);

                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => handleFeatureToggle(f.key)}
                      className={`
                        group relative px-4 py-2 text-xs font-medium transition-all duration-300 
                        focus:outline-none focus:ring-2 focus:ring-purple-300 cursor-pointer 
                        transform hover:scale-105 active:scale-95 flex-shrink-0 min-w-[140px]
                        ${
                          f.key === 'rounded'
                            ? isSelected
                              ? 'rounded-2xl'
                              : 'rounded-lg hover:rounded-xl'
                            : f.key === 'border'
                              ? 'rounded-md'
                              : 'rounded-lg'
                        }
                        ${
                          f.key === 'border'
                            ? isSelected
                              ? 'border-2 border-purple-400 bg-purple-50'
                              : 'border-2 border-gray-200 hover:border-purple-300 bg-white'
                            : f.key === 'gradient'
                              ? ''
                              : isSelected
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-gray-50 hover:bg-purple-50 text-gray-600 hover:text-purple-600'
                        }
                        ${
                          f.key === 'shadow'
                            ? isSelected
                              ? 'shadow-md shadow-purple-200'
                              : 'shadow-md hover:shadow-lg'
                            : 'shadow-sm hover:shadow-md'
                        }
                      `}
                      style={{
                        ...(f.key === 'gradient' && {
                          background: isSelected
                            ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                            : 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
                          color: isSelected ? 'white' : '#6b7280',
                        }),
                      }}
                    >
                      {/* Feature preview area */}
                      <div className="flex items-center gap-3">
                        {/* Visual preview */}
                        <div className="flex items-center justify-center w-6 h-6">
                          {f.key === 'rounded' && (
                            <div
                              className={`w-4 h-4 bg-current transition-all duration-300 ${
                                isSelected ? 'rounded-full' : 'rounded-sm group-hover:rounded-lg'
                              } opacity-70`}
                            ></div>
                          )}
                          {f.key === 'border' && (
                            <div
                              className={`w-4 h-4 rounded transition-all duration-300 ${
                                isSelected
                                  ? 'border-2 border-current opacity-80'
                                  : 'border border-current opacity-60 group-hover:border-2'
                              }`}
                            ></div>
                          )}
                          {f.key === 'gradient' && (
                            <div className="w-4 h-4 rounded-sm bg-gradient-to-br from-purple-400 via-pink-400 to-indigo-400 opacity-90 transition-all duration-300 group-hover:scale-110"></div>
                          )}
                          {f.key === 'shadow' && (
                            <div className="relative">
                              <div
                                className={`w-4 h-4 bg-current rounded transition-all duration-300 ${
                                  isSelected ? 'opacity-80' : 'opacity-60'
                                }`}
                              ></div>
                              <div
                                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-current rounded transition-all duration-300 ${
                                  isSelected ? 'opacity-30' : 'opacity-20'
                                }`}
                              ></div>
                            </div>
                          )}
                        </div>

                        {/* Label */}
                        <span className="transition-all duration-300">{f.label}</span>
                      </div>

                      {/* Hover effect overlay (might replace this) */}
                      <div className="absolute inset-0 bg-purple-400 opacity-0 group-hover:opacity-5 transition-opacity duration-300 rounded-inherit"></div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="ghost" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogRoot>
    </div>
  );
};
