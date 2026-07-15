package com.loanos.fieldops.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.loanos.fieldops.security.KeyManager
import net.sqlcipher.database.SupportFactory

@Database(
    entities = [OfflineEnvelopeEntity::class, AssignmentEntity::class],
    version = 1,
    exportSchema = false
)
abstract class FieldOpsDatabase : RoomDatabase() {

    abstract fun offlineEnvelopeDao(): OfflineEnvelopeDao
    abstract fun assignmentDao(): AssignmentDao

    companion object {
        private const val DB_NAME = "loanos_field_ops.db"

        @Volatile
        private var INSTANCE: FieldOpsDatabase? = null

        fun getDatabase(context: Context): FieldOpsDatabase {
            return INSTANCE ?: synchronized(this) {
                val passphrase = KeyManager.getDatabasePassphrase(context)
                val supportFactory = SupportFactory(passphrase.toByteArray())

                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    FieldOpsDatabase::class.java,
                    DB_NAME
                )
                .openHelperFactory(supportFactory) // Apply SQLCipher encryption hook
                .fallbackToDestructiveMigration()
                .build()

                INSTANCE = instance
                instance
            }
        }
    }
}
