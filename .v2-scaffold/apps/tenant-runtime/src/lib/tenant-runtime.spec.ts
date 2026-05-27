import { tenantRuntime } from './tenant-runtime';

describe('tenantRuntime', () => {
  it('should work', () => {
    expect(tenantRuntime()).toEqual('tenant-runtime');
  });
});
