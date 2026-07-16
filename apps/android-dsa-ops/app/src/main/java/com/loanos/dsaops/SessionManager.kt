package com.loanos.dsaops

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.loanos.dsaops.network.PersistentCookieJar

data class DsaSession(
    val tenantId: String,
    val userId: String,
    val displayName: String,
    val partnerId: String?,
    val expiresAt: String
)

/**
 * Tracks the signed-in DSA's non-secret session metadata. The actual credential
 * is the session cookie set by /auth/federated/exchange, held only in
 * [PersistentCookieJar] — this class never sees it, matching the Zero-Local-Data
 * posture (session key lives in EncryptedSharedPreferences, capped at ~1 hour by
 * the server-issued expiresAt, never a long-lived refresh token).
 */
class SessionManager(private val context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        "loanos_dsa_session_prefs",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context.applicationContext,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveSession(session: DsaSession) {
        prefs.edit()
            .putString(KEY_TENANT, session.tenantId)
            .putString(KEY_USER, session.userId)
            .putString(KEY_NAME, session.displayName)
            .putString(KEY_PARTNER, session.partnerId)
            .putString(KEY_EXPIRES, session.expiresAt)
            .apply()
    }

    fun getSession(): DsaSession? {
        val userId = prefs.getString(KEY_USER, null) ?: return null
        val expiresAt = prefs.getString(KEY_EXPIRES, null) ?: return null
        if (java.time.Instant.parse(expiresAt).isBefore(java.time.Instant.now())) {
            clearSession()
            return null
        }
        return DsaSession(
            tenantId = prefs.getString(KEY_TENANT, "") ?: "",
            userId = userId,
            displayName = prefs.getString(KEY_NAME, "") ?: "",
            partnerId = prefs.getString(KEY_PARTNER, null),
            expiresAt = expiresAt
        )
    }

    fun clearSession() {
        prefs.edit().clear().apply()
        PersistentCookieJar(context).clear()
    }

    companion object {
        private const val KEY_TENANT = "tenantId"
        private const val KEY_USER = "userId"
        private const val KEY_NAME = "displayName"
        private const val KEY_PARTNER = "partnerId"
        private const val KEY_EXPIRES = "expiresAt"
    }
}
