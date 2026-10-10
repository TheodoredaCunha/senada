export class AuthManager {
  constructor(providers) {
    this.providers = providers;
  }

  async login(provider) {
    return this.providers[provider].login();
  }

  async logout(provider) {
    return this.providers[provider].logout();
  }

  isConnected(provider) {
    return this.providers[provider].isConnected();
  }

  async getAccessToken(provider) {
    return this.providers[provider].getAccessToken?.();
  }

  async getCurrentUser(provider) {
    return this.providers[provider].getCurrentUser?.();
  }

  async handleCallback(provider, params) {
    return this.providers[provider].handleCallback?.(params);
  }
}