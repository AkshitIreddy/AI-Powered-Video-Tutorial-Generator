use crate::error::CommandError;
use crate::types::{ProviderSecretRef, SecretAvailability, SetProviderSecretRequest};
use crate::validation;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use std::collections::BTreeMap;
use zeroize::{Zeroize, Zeroizing};

const KEYRING_SERVICE: &str = "Alystria Studio";

pub trait SecretStore: Send + Sync {
    fn put(&self, account: &str, value: &str) -> Result<(), SecretStoreError>;
    fn contains(&self, account: &str) -> Result<bool, SecretStoreError>;
    fn get(&self, account: &str) -> Result<Zeroizing<String>, SecretStoreError>;
    fn delete(&self, account: &str) -> Result<(), SecretStoreError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretStoreError {
    Unavailable,
    AccessDenied,
    Failed,
}

#[derive(Debug, Default)]
pub struct OsKeyringSecretStore;

impl OsKeyringSecretStore {
    fn entry(account: &str) -> Result<keyring::Entry, SecretStoreError> {
        keyring::Entry::new(KEYRING_SERVICE, account).map_err(map_keyring_error)
    }
}

impl SecretStore for OsKeyringSecretStore {
    fn put(&self, account: &str, value: &str) -> Result<(), SecretStoreError> {
        Self::entry(account)?
            .set_password(value)
            .map_err(map_keyring_error)
    }

    fn contains(&self, account: &str) -> Result<bool, SecretStoreError> {
        let entry = Self::entry(account)?;
        match entry.get_password() {
            Ok(mut secret) => {
                secret.zeroize();
                Ok(true)
            }
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(map_keyring_error(error)),
        }
    }

    fn get(&self, account: &str) -> Result<Zeroizing<String>, SecretStoreError> {
        Self::entry(account)?
            .get_password()
            .map(Zeroizing::new)
            .map_err(map_keyring_error)
    }

    fn delete(&self, account: &str) -> Result<(), SecretStoreError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error)),
        }
    }
}

fn map_keyring_error(error: keyring::Error) -> SecretStoreError {
    match error {
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
            SecretStoreError::Unavailable
        }
        keyring::Error::Ambiguous(_) => SecretStoreError::AccessDenied,
        _ => SecretStoreError::Failed,
    }
}

pub struct CredentialManager {
    store: Box<dyn SecretStore>,
    updated_at: Mutex<BTreeMap<String, DateTime<Utc>>>,
}

impl std::fmt::Debug for CredentialManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CredentialManager")
            .field("store", &"<redacted>")
            .finish_non_exhaustive()
    }
}

impl CredentialManager {
    pub fn os_keyring() -> Self {
        Self {
            store: Box::new(OsKeyringSecretStore),
            updated_at: Mutex::new(BTreeMap::new()),
        }
    }

    #[cfg(test)]
    fn with_store(store: Box<dyn SecretStore>) -> Self {
        Self {
            store,
            updated_at: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn put(
        &self,
        mut input: SetProviderSecretRequest,
    ) -> Result<ProviderSecretRef, CommandError> {
        let provider = validation::provider_id(&input.provider_id)?;
        let kind = validation::credential_kind(&input.credential_kind)?;
        if let Err(error) = validation::secret(&input.secret) {
            input.secret.zeroize();
            return Err(error);
        }
        let account = account(&provider, &kind);
        let result = self.store.put(&account, &input.secret);
        input.secret.zeroize();
        result.map_err(secret_error)?;
        let now = Utc::now();
        self.updated_at.lock().insert(account, now);
        Ok(secret_ref(
            provider,
            kind,
            SecretAvailability::Present,
            Some(now),
        ))
    }

    pub fn status(
        &self,
        provider_id: &str,
        credential_kind: &str,
    ) -> Result<ProviderSecretRef, CommandError> {
        let provider = validation::provider_id(provider_id)?;
        let kind = validation::credential_kind(credential_kind)?;
        let account = account(&provider, &kind);
        let availability = match self.store.contains(&account) {
            Ok(true) => SecretAvailability::Present,
            Ok(false) => SecretAvailability::Missing,
            Err(SecretStoreError::Unavailable) => SecretAvailability::KeyringUnavailable,
            Err(error) => return Err(secret_error(error)),
        };
        let updated_at = self.updated_at.lock().get(&account).copied();
        Ok(secret_ref(provider, kind, availability, updated_at))
    }

    pub fn delete(
        &self,
        provider_id: &str,
        credential_kind: &str,
    ) -> Result<ProviderSecretRef, CommandError> {
        let provider = validation::provider_id(provider_id)?;
        let kind = validation::credential_kind(credential_kind)?;
        let account = account(&provider, &kind);
        self.store.delete(&account).map_err(secret_error)?;
        self.updated_at.lock().remove(&account);
        Ok(secret_ref(
            provider,
            kind,
            SecretAvailability::Missing,
            None,
        ))
    }

    pub fn lease_reference(&self, reference: &str) -> Result<Zeroizing<String>, CommandError> {
        const PREFIX: &str = "keyring://alystria/";
        let suffix = reference.strip_prefix(PREFIX).ok_or_else(|| {
            CommandError::invalid("credentialRef", "must be an Alystria keyring reference")
        })?;
        let (provider, kind) = suffix.split_once('/').ok_or_else(|| {
            CommandError::invalid(
                "credentialRef",
                "must identify a provider and credential kind",
            )
        })?;
        if kind.contains('/') {
            return Err(CommandError::invalid(
                "credentialRef",
                "must identify exactly one credential kind",
            ));
        }
        let provider = validation::provider_id(provider)?;
        let kind = validation::credential_kind(kind)?;
        self.store
            .get(&account(&provider, &kind))
            .map_err(secret_error)
    }
}

fn account(provider: &str, kind: &str) -> String {
    format!("provider/{provider}/{kind}")
}

fn secret_ref(
    provider_id: String,
    credential_kind: String,
    availability: SecretAvailability,
    updated_at: Option<DateTime<Utc>>,
) -> ProviderSecretRef {
    ProviderSecretRef {
        reference: format!("keyring://alystria/{provider_id}/{credential_kind}"),
        provider_id,
        credential_kind,
        availability,
        updated_at,
    }
}

fn secret_error(error: SecretStoreError) -> CommandError {
    match error {
        SecretStoreError::Unavailable => CommandError::new(
            "KEYRING_UNAVAILABLE",
            "The operating-system credential vault is unavailable. Alystria Studio will not fall back to plaintext storage.",
            true,
        ),
        SecretStoreError::AccessDenied => CommandError::new(
            "KEYRING_ACCESS_DENIED",
            "The operating-system credential vault denied access.",
            true,
        ),
        SecretStoreError::Failed => CommandError::new(
            "KEYRING_OPERATION_FAILED",
            "The credential vault operation failed. No plaintext fallback was used.",
            true,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryStore(Mutex<HashMap<String, String>>);

    impl SecretStore for MemoryStore {
        fn put(&self, account: &str, value: &str) -> Result<(), SecretStoreError> {
            self.0.lock().insert(account.into(), value.into());
            Ok(())
        }
        fn contains(&self, account: &str) -> Result<bool, SecretStoreError> {
            Ok(self.0.lock().contains_key(account))
        }
        fn get(&self, account: &str) -> Result<Zeroizing<String>, SecretStoreError> {
            self.0
                .lock()
                .get(account)
                .cloned()
                .map(Zeroizing::new)
                .ok_or(SecretStoreError::Failed)
        }
        fn delete(&self, account: &str) -> Result<(), SecretStoreError> {
            self.0.lock().remove(account);
            Ok(())
        }
    }

    #[test]
    fn returns_opaque_refs_and_never_secret_values() {
        let manager = CredentialManager::with_store(Box::new(MemoryStore::default()));
        let reference = manager
            .put(SetProviderSecretRequest {
                provider_id: "OpenAI".into(),
                credential_kind: "api_key".into(),
                secret: "top-secret-value".into(),
            })
            .unwrap();
        let serialized = serde_json::to_string(&reference).unwrap();
        assert!(!serialized.contains("top-secret-value"));
        assert_eq!(reference.availability, SecretAvailability::Present);
        let leased = manager.lease_reference(&reference.reference).unwrap();
        assert_eq!(leased.as_str(), "top-secret-value");
    }
}
