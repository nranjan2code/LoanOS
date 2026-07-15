package com.loanos.dsaops

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * Manages short-lived, encrypted session credentials for the DSA Lead app.
 * Adheres to the Zero-Local-Data compliance pattern by restricting local storage to transient session tokens.
 */
class SessionManager(context: Context) {
    private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)

    private val sharedPreferences = EncryptedSharedPreferences.create(
        "loanos_dsa_session_prefs",
        masterKeyAlias,
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    companion object {
        private const val TOKEN_KEY = "oidc_access_token"
        private const val TOKEN_EXPIRY_KEY = "token_expiry_timestamp"
        private const val MOCK_EXPIRY_DURATION_MS = 3600000L // 1 hour token validity limit
    }

    /**
     * Stores a new short-lived session token.
     */
    fun saveSessionToken(token: String) {
        val expiryTime = System.currentTimeMillis() + MOCK_EXPIRY_DURATION_MS
        sharedPreferences.edit()
            .putString(TOKEN_KEY, token)
            .putLong(TOKEN_EXPIRY_KEY, expiryTime)
            .apply()
    }

    /**
     * Retrieves the session token, ensuring it hasn't expired.
     */
    fun getSessionToken(): String? {
        val expiryTime = sharedPreferences.getLong(TOKEN_EXPIRY_KEY, 0L)
        if (System.currentTimeMillis() > expiryTime) {
            clearSession() // Auto-wipe expired session
            return null
        }
        return sharedPreferences.getString(TOKEN_KEY, null)
    }

    /**
     * Wipes active session credentials immediately.
     */
    fun clearSession() {
        sharedPreferences.edit()
            .remove(TOKEN_KEY)
            .remove(TOKEN_EXPIRY_KEY)
            .apply()
    }
}
