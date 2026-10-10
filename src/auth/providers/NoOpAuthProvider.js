export class NoOpAuthProvider {
  constructor(name) {
    this.name = name;
    this.connected = false;
  }

  async login() {
    this.connected = true;
    return { provider: this.name, connected: true, demo: true };
  }

  async logout() {
    this.connected = false;
    return { provider: this.name, connected: false };
  }

  isConnected() {
    return this.connected;
  }
}