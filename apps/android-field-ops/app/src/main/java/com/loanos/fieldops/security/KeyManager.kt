package com.loanos.fieldops.security

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import java.security.SecureRandom

/**
 * Handles the local database (SQLCipher) passphrase lifecycle.
 *
 * The passphrase is random, generated once per install, and stored only inside
 * EncryptedSharedPreferences whose master key lives in the Android Keystore
 * (hardware-backed TEE/StrongBox where available). Wiping the passphrase renders
 * the SQLCipher database permanently unreadable — this is the data-sanitization
 * lever required on agent logout, certification revocation or remote wipe.
 */
object KeyManager {
    private const val PREFS_NAME = "loanos_secure_db_prefs"
    private const val PASSPHRASE_KEY = "db_passphrase"
    private const val PASSPHRASE_BYTES = 32

    private fun securePrefs(context: Context) = EncryptedSharedPreferences.create(
        PREFS_NAME,
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    /**
     * Gets or generates the SQLCipher passphrase (hex-encoded 256-bit random value).
     */
    fun getDatabasePassphrase(context: Context): String {
        val prefs = securePrefs(context)
        var passphrase = prefs.getString(PASSPHRASE_KEY, null)
        if (passphrase == null) {
            val bytes = ByteArray(PASSPHRASE_BYTES).apply { SecureRandom().nextBytes(this) }
            passphrase = bytes.joinToString("") { "%02x".format(it) }
            prefs.edit().putString(PASSPHRASE_KEY, passphrase).apply()
        }
        return passphrase
    }

    /**
     * Data sanitization: wipes the database passphrase and deletes the encrypted
     * database files. After this call all locally cached field data is unrecoverable.
     * Invoke on agent logout, session expiry or emergency containment.
     */
    fun wipeLocalData(context: Context, databaseName: String = "loanos_field_ops.db") {
        securePrefs(context).edit().remove(PASSPHRASE_KEY).apply()
        context.deleteDatabase(databaseName)
    }
}
