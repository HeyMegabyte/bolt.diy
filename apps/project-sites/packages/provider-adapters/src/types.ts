export type OAuthProvider = 'google'|'github'|'slack'|'discord'|'notion'|'airtable'|'hubspot'|'stripe'|'mailchimp'|'other';

export interface AuthorizationUrlInput { redirectUri: string; state: string; scopes: string[]; }
export interface AuthorizationUrlResult { url: string; codeVerifier?: string; }
export interface ExchangeCodeInput { code: string; codeVerifier?: string; redirectUri: string; }
export interface TokenResult { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[]; }
export interface RefreshTokenInput { refreshToken: string; }
export interface RevokeTokenInput { accessToken: string; }
export interface RevokeResult { success: boolean; }
export interface TestConnectionInput { accessToken: string; }
export interface TestConnectionResult { success: boolean; accountId?: string; accountEmail?: string; }
export interface ExecuteCapabilityInput { capability: string; params: Record<string,unknown>; }
export interface ExecuteCapabilityResult { success: boolean; data?: unknown; error?: string; }
export interface ProxyInput { url: string; method: string; headers: Record<string,string>; body?: string; }
export interface ProxyResult { status: number; headers: Record<string,string>; body: string; }
export interface ProviderCapability { slug: string; label: string; description: string; scopes: string[]; risk: 'read'|'write'|'admin'; }
export interface ProviderAdapter {
  provider: OAuthProvider;
  capabilities(): ProviderCapability[];
  getAuthorizationUrl(input: AuthorizationUrlInput): Promise<AuthorizationUrlResult>;
  exchangeCode(input: ExchangeCodeInput): Promise<TokenResult>;
  refreshToken(input: RefreshTokenInput): Promise<TokenResult>;
  revokeToken?(input: RevokeTokenInput): Promise<RevokeResult>;
  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>;
}
