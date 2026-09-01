export interface CredentialKey {
  issuer: string;
  clientId: string;
}

export interface StoredCredential {
  schemaVersion: 1;
  refreshToken: string;
}

export interface CredentialStore {
  read(key: CredentialKey): Promise<StoredCredential | undefined>;
  write(key: CredentialKey, credential: StoredCredential): Promise<void>;
  delete(key: CredentialKey): Promise<void>;
}
