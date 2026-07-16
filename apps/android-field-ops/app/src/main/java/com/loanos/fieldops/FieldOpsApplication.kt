package com.loanos.fieldops

import android.app.Application
import com.loanos.fieldops.network.NetworkModule

class FieldOpsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize SQLCipher native library (net.zetetic:sqlcipher-android)
        System.loadLibrary("sqlcipher")
        NetworkModule.init(this)
    }
}
