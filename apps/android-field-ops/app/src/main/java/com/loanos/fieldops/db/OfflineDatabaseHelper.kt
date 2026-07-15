package com.loanos.fieldops.db

import android.content.Context
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper
import android.content.ContentValues
import com.loanos.fieldops.security.KeyManager

class OfflineDatabaseHelper private constructor(private val appContext: Context) : SQLiteOpenHelper(
    appContext,
    DATABASE_NAME,
    null,
    DATABASE_VERSION
) {
    companion object {
        private const val DATABASE_NAME = "offline_ops.db"
        private const val DATABASE_VERSION = 1

        @Volatile
        private var instance: OfflineDatabaseHelper? = null

        fun getInstance(context: Context): OfflineDatabaseHelper {
            return instance ?: synchronized(this) {
                instance ?: OfflineDatabaseHelper(context.applicationContext).also { instance = it }
            }
        }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE assignments (
                id TEXT PRIMARY KEY,
                tenant_id TEXT,
                type TEXT,
                title TEXT,
                subtitle TEXT,
                status TEXT,
                base_version TEXT,
                payload_json TEXT,
                scheduled_at TEXT
            )
        """)

        db.execSQL("""
            CREATE TABLE offline_queue (
                envelope_id TEXT PRIMARY KEY,
                device_id TEXT,
                payload_type TEXT,
                encrypted_data TEXT,
                iv TEXT,
                signature TEXT,
                status TEXT,
                created_at TEXT
            )
        """)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS assignments")
        db.execSQL("DROP TABLE IF EXISTS offline_queue")
        onCreate(db)
    }

    fun getWritableEncryptedDb(): SQLiteDatabase {
        SQLiteDatabase.loadLibs(appContext)
        val passphrase = KeyManager.getDatabasePassphrase(appContext)
        return getWritableDatabase(passphrase)
    }

    fun getReadableEncryptedDb(): SQLiteDatabase {
        SQLiteDatabase.loadLibs(appContext)
        val passphrase = KeyManager.getDatabasePassphrase(appContext)
        return getReadableDatabase(passphrase)
    }
}
