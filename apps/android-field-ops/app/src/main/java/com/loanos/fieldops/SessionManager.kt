package com.loanos.fieldops

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.loanos.fieldops.network.PersistentCookieJar

data class FieldOpsSession(
    val tenantId: String,
    val userId: String,
    val displayName: String,
    val roles: List<String>,
    val expiresAt: String
)

/**
 * Tracks the signed-in officer's non-secret session metadata (used to drive UI and
 * to attribute local actions such as `createdBy` on offline envelopes). The actual
 * session credential lives in [PersistentCookieJar]; this class never sees it.
 */
class SessionManager(private val context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        "loanos_field_session_prefs",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context.applicationContext,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveSession(session: FieldOpsSession) {
        prefs.edit()
            .putString(KEY_TENANT, session.tenantId)
            .putString(KEY_USER, session.userId)
            .putString(KEY_NAME, session.displayName)
            .putString(KEY_ROLES, session.roles.joinToString(","))
            .putString(KEY_EXPIRES, session.expiresAt)
            .apply()
    }

    fun getSession(): FieldOpsSession? {
        val userId = prefs.getString(KEY_USER, null) ?: return null
        val expiresAt = prefs.getString(KEY_EXPIRES, null) ?: return null
        if (java.time.Instant.parse(expiresAt).isBefore(java.time.Instant.now())) {
            clearSession()
            return null
        }
        return FieldOpsSession(
            tenantId = prefs.getString(KEY_TENANT, "") ?: "",
            userId = userId,
            displayName = prefs.getString(KEY_NAME, "") ?: "",
            roles = prefs.getString(KEY_ROLES, "")?.split(",")?.filter { it.isNotBlank() } ?: emptyList(),
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
        private const val KEY_ROLES = "roles"
        private const val KEY_EXPIRES = "expiresAt"
    }
}
