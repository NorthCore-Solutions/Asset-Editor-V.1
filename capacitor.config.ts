import type { CapacitorConfig } from '@capacitor/cli';

const liveUpdatePublicKey = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAzlQ0cuzPL1a0aVttFOkG
5DkzNK1pW4/AiDNcYbiYx7DYSysKjPeGGvFTL/gI9MN7QyjOh4h00rCy6kKB+nQy
AC/yWEG3ipu6qH/Vqr+qBP+VEarqiz8qQFL5T14KZi5y/WoQE0p+qME7D3Mzwkg/
UwPBycOkDV89neoun2dcnACkT/YWkB4UGDBLmOK6vvN0PpCrK02R/6d3IweZf3PM
9QNIsP+7R/a8X2uqvjJOV9Rn6r/8IlKzsqiARJ8gj8Tt2ymQpTlO0e1Tp/yXEduB
V+xmr3UKp19NcxvomutMxyQrDBfCrci6n5KUbH/59QeIt7MVeM/nnVr+qPcO7Wlh
HbVEJSDndZupT9uG5fbXJxLEGD8waf/DnA8gZj9AyhaNqfy93IKh0KPdd4v+ZVKw
tsL62TweQYQf0Iqh240p+SlVkSYjFnOT+09uHoQRGItKBRGtr6ICBzCTFzrM1Atx
hBe8S5T48HIDCBlcmMyz5ODHoG0vC57SAj6QM86PliaxAgMBAAE=
-----END PUBLIC KEY-----`;

const config: CapacitorConfig = {
  appId: 'de.northcore.asseteditor',
  appName: 'NorthCore Asset Editor',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  },
  plugins: {
    LiveUpdate: {
      autoBlockRolledBackBundles: true,
      autoDeleteBundles: true,
      autoUpdateStrategy: 'none',
      publicKey: liveUpdatePublicKey,
      readyTimeout: 10_000
    }
  }
};

export default config;
