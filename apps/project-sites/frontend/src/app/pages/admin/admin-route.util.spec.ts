import { isEditorPath } from './admin-route.util';

describe('isEditorPath', () => {
  it('is FALSE for the dashboard (/admin) so app-admin-dashboard shows over the parked iframe', () => {
    expect(isEditorPath('/admin')).toBe(false);
    expect(isEditorPath('/admin?x=1')).toBe(false);
  });

  it('is TRUE for the editor host + its sub-paths', () => {
    expect(isEditorPath('/admin/editor')).toBe(true);
    expect(isEditorPath('/admin/editor/foo')).toBe(true);
    expect(isEditorPath('/admin/editor?tab=code')).toBe(true);
  });

  it('is FALSE for every other admin section', () => {
    for (const u of ['/admin/snapshots', '/admin/analytics', '/admin/forms', '/admin/settings', '/admin/logs']) {
      expect(isEditorPath(u)).toBe(false);
    }
  });

  it('does not match a route that merely starts with "editor" elsewhere', () => {
    expect(isEditorPath('/admin/editor-x')).toBe(false);
  });
});
