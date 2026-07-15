package com.loanos.fieldops.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import java.util.UUID

/**
 * Handles hardware-backed cryptographic key lifecycle for local database (SQLCipher) encryption.
 * Integrates with Android Keystore System to ensure keys never leave the secure hardware (TEE/StrongBox).
 */
object KeyManager {
    private const val KEY_PROVIDER = "AndroidKeyStore"
    private const val DB_KEY_ALIAS = "loanos_db_encryption_key"

    init {
        // Ensure the db key is created on initialization
        getOrCreateDatabaseKey()
    }

    /**
     * Retrieves the existing database encryption key from Keystore, or generates a new one.
     */
    fun getOrCreateDatabaseKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEY_PROVIDER).apply { load(null) }
        
        if (keyStore.containsAlias(DB_KEY_ALIAS)) {
            val entry = keyStore.getEntry(DB_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
            if (entry != null) {
                return entry.secretKey
            }
        }

        // Generate a new hardware-backed AES-256 key
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEY_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            DB_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        ).run {
            setKeySize(256)
            setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            setUserAuthenticationRequired(true) // Requires device screen lock
            setUserAuthenticationValidityDurationSeconds(300) // Valid for 5 mins after authentication
            build()
        }

        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    /**
     * Securely wipes the database key entry from Keystore memory (e.g. on emergency containment or agent logout).
     */
    fun revokeKeys() {
        val keyStore = KeyStore.getInstance(KEY_PROVIDER).apply { load(null) }
        if (keyStore.containsAlias(DB_KEY_ALIAS)) {
            keyStore.deleteEntry(DB_KEY_ALIAS)
        }
    }

    /**
     * Gets or generates a secure database passphrase stored in EncryptedSharedPreferences.
     */
    fun getDatabasePassphrase(context: Context): String {
        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        val sharedPreferences = EncryptedSharedPreferences.create(
            "loanos_secure_db_prefs",
            masterKeyAlias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        var passphrase = sharedPreferences.getString("db_passphrase", null)
        if (passphrase == null) {
            passphrase = UUID.randomUUID().toString() + UUID.randomUUID().toString()
            sharedPreferences.edit().putString("db_passphrase", passphrase).apply()
        }
        return passphrase
    }
}
