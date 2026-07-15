package com.loanos.fieldops

import android.app.Application
import net.sqlcipher.database.SQLiteDatabase

class FieldOpsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize SQLCipher library
        SQLiteDatabase.loadLibs(this)
    }
}
