import { parseVoiceCommand } from '../service.js';

describe('parseVoiceCommand', () => {
  test('change hero headline', () => {
    const r = parseVoiceCommand('change the hero headline to Best Pizza in Brooklyn');
    expect(r.action).toBe('change_text');
    expect(r.target).toBe('hero');
    expect(r.value).toContain('Best Pizza');
    expect(r.needsConfirmation).toBe(false);
  });
  test('update phone number', () => {
    const r = parseVoiceCommand('update my phone number to 555-0123');
    expect(r.action).toBe('update_info');
    expect(r.target).toBe('phone');
  });
  test('change address', () => {
    const r = parseVoiceCommand('change our address to 456 Main Street');
    expect(r.action).toBe('update_info');
    expect(r.target).toBe('address');
  });
  test('add testimonial section', () => {
    const r = parseVoiceCommand('add a testimonial section');
    expect(r.action).toBe('add_section');
    expect(r.target).toBe('testimonial');
  });
  test('remove banner', () => {
    const r = parseVoiceCommand('remove the banner');
    expect(r.action).toBe('remove_section');
    expect(r.needsConfirmation).toBe(true);
  });
  test('publish site', () => {
    const r = parseVoiceCommand('publish the site');
    expect(r.action).toBe('publish_site');
    expect(r.needsConfirmation).toBe(true);
  });
  test('check health', () => {
    const r = parseVoiceCommand('check my site health');
    expect(r.action).toBe('check_health');
  });
  test('filters filler words', () => {
    const r = parseVoiceCommand('um can you please change the heading to Hello World thanks');
    expect(r.action).toBe('change_text');
    expect(r.value).toBe('Hello World');
  });
  test('unknown command needs confirmation', () => {
    const r = parseVoiceCommand('make it look better');
    expect(r.action).toBe('unknown');
    expect(r.needsConfirmation).toBe(true);
    expect(r.verbalConfirmation).toBeTruthy();
  });
  test('empty transcript', () => {
    const r = parseVoiceCommand('');
    expect(r.action).toBe('unknown');
  });
});
