import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';
import React from 'react';

/**
 * Mic-only speech recognition trigger.
 *
 * @remarks
 *   Whisper (Workers AI) was removed from the editor surface 2026-05-24.
 *   The component now wraps the browser SpeechRecognition path only; the
 *   parent owns the actual recognizer instance (see `BaseChat.tsx`).
 *   Re-enable Whisper via a debug flag if support workflows need server
 *   transcription — the `https://projectsites.dev/api/bolt/transcribe`
 *   route is still live (legacy `/admin-api/transcribe` blocked by WAF).
 */
interface SpeechRecognitionButtonProps {
  isListening: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;
  onTranscription?: (text: string) => void;
}

export const SpeechRecognitionButton: React.FC<SpeechRecognitionButtonProps> = ({
  isListening,
  onStart,
  onStop,
  disabled,
}) => {
  return (
    <IconButton
      title={isListening ? 'Stop speech recognition' : 'Start speech recognition'}
      disabled={disabled}
      className={classNames('transition-all', {
        'text-bolt-elements-item-contentAccent': isListening,
      })}
      onClick={() => (isListening ? onStop() : onStart())}
    >
      {isListening ? (
        <div className="i-ph:microphone-slash text-xl" />
      ) : (
        <div className="i-ph:microphone text-xl" />
      )}
    </IconButton>
  );
};
