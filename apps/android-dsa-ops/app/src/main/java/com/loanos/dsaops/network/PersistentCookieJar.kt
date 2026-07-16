package com.loanos.dsaops.network

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * The LoanOS API resolves staff sessions from the `Cookie` header only — the
 * session cookie set after `/auth/federated/exchange` succeeds IS the DSA's
 * one-hour credential, so it is persisted here (Keystore-backed) rather than
 * treated as a bearer token, matching how the backend actually authenticates
 * (apps/api/src/server.js:sessionTokenFromRequest).
 */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = EncryptedSharedPreferences.create(
        "loanos_dsa_cookie_prefs",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context.applicationContext,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val editor = prefs.edit()
        cookies.forEach { cookie -> editor.putString(cookie.name, cookie.toString()) }
        editor.apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        return prefs.all.values
            .mapNotNull { it as? String }
            .mapNotNull { Cookie.parse(url, it) }
            .filter { !it.expiresAt.let { exp -> exp in 1 until System.currentTimeMillis() } }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
