package com.loanos.dsaops.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

data class PendingLogin(val state: String, val codeVerifier: String, val tenantId: String)

/**
 * Holds the PKCE code_verifier and opaque `state` between launching the Custom
 * Tabs authorization request and receiving the redirect back into the app.
 * The backend's challenge itself expires in 5 minutes, so this is cleared
 * immediately after a successful or failed exchange.
 */
object PendingLoginStore {
    private const val PREFS = "loanos_dsa_pending_login"
    private const val KEY_STATE = "state"
    private const val KEY_VERIFIER = "verifier"
    private const val KEY_TENANT = "tenantId"

    private fun prefs(context: Context) = EncryptedSharedPreferences.create(
        PREFS,
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context.applicationContext,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun save(context: Context, pending: PendingLogin) {
        prefs(context).edit()
            .putString(KEY_STATE, pending.state)
            .putString(KEY_VERIFIER, pending.codeVerifier)
            .putString(KEY_TENANT, pending.tenantId)
            .apply()
    }

    fun consume(context: Context): PendingLogin? {
        val p = prefs(context)
        val state = p.getString(KEY_STATE, null)
        val verifier = p.getString(KEY_VERIFIER, null)
        val tenantId = p.getString(KEY_TENANT, null)
        p.edit().clear().apply()
        if (state == null || verifier == null || tenantId == null) return null
        return PendingLogin(state, verifier, tenantId)
    }
}
