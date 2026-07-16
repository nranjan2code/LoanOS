package com.loanos.fieldops.security

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings

/** Stable per-install device identifier used as `deviceId` across certification and sync. */
object DeviceIdentity {
    @SuppressLint("HardwareIds")
    fun get(context: Context): String {
        return Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown-device"
    }
}
